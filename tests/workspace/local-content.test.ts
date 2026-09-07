import { afterEach, describe, expect, it, vi } from 'vitest'
import { draftRecoveryKey, findRecoverableItem, listLocalDrafts, loadDraftForRecovery } from '@/src/lib/capture/local-drafts'
import { appendLocalThoughtMarkdown, createCurrentThoughtMarkdown, createLocalContentJson, localExportItems } from '@/src/lib/capture/local-export'
import { readCloudThoughtMarkdown, verifyExportOwner } from '@/src/lib/capture/export-download'
import type { ThoughtOutboxItem } from '@/src/lib/capture/capture-store'
import type { Entry } from '@/src/server/repositories/entry-repository'

const userId = 'owner-a'
const thoughtId = 'thought-a'

function item(id: string, changes: Partial<ThoughtOutboxItem> = {}): ThoughtOutboxItem {
  return {
    userId, thoughtId, entryId: id, clientRequestId: `request-${id}`,
    content: `草稿 ${id}`, entryType: 'user', sourceLabel: null,
    createsThought: true, state: 'draft',
    createdAt: '2026-09-07T10:00:00.000Z', updatedAt: '2026-09-07T10:00:00.000Z',
    ...changes,
  }
}

function entry(id: string, content: string, changes: Partial<Entry> = {}): Entry {
  return {
    id, thoughtId, content, clientRequestId: `request-${id}`,
    entryType: 'user', sourceLabel: null, aiAction: null,
    createdAt: '2026-09-07T09:00:00.000Z', ...changes,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('discovering and recovering local drafts', () => {
  it('keeps multiple new-thought drafts discoverable without showing another account or submitted entries', () => {
    const drafts = [
      item('active'), item('older'),
      item('newer', { thoughtId: 'thought-b', updatedAt: '2026-09-07T11:00:00.000Z' }),
      item('other-owner', { userId: 'owner-b' }),
      item('submitted', { state: 'pending' }),
      item('failed', { state: 'failed' }),
      item('empty', { content: '' }),
    ]
    expect(listLocalDrafts(drafts, userId, 'active').map((draft) => draft.entryId)).toEqual(['newer', 'older'])
    expect(drafts.find((draft) => draft.entryId === 'older')?.state).toBe('draft')
  })

  it('restores the selected continuation only within its account and thought, never substituting another draft', () => {
    const selected = item('selected', { createsThought: false })
    const drafts = [selected, item('latest', { updatedAt: '2026-09-07T12:00:00.000Z' })]
    expect(findRecoverableItem(drafts, userId, thoughtId, 'selected')).toEqual(selected)
    expect(findRecoverableItem(drafts, 'owner-b', thoughtId, 'selected')).toBeNull()
    expect(findRecoverableItem(drafts, userId, 'thought-b', 'selected')).toBeNull()
    expect(findRecoverableItem(drafts, userId, thoughtId, 'missing')).toBeNull()
    expect(findRecoverableItem(drafts, userId, null)?.entryId).toBe('latest')
    expect(draftRecoveryKey(userId, thoughtId)).not.toBe(draftRecoveryKey('owner-b', thoughtId))
  })

  it.each(['typing', 'saving', 'another restore', 'AI or import'])('ignores a late recovery after %s changes the active operation', async () => {
    let finishRead!: (items: ThoughtOutboxItem[]) => void
    const readItems = vi.fn(() => new Promise<ThoughtOutboxItem[]>((resolve) => { finishRead = resolve }))
    let revision = 1
    const restore = loadDraftForRecovery({
      pendingWrite: Promise.resolve(), readItems, stillCurrent: () => revision === 1,
      userId, thoughtId, entryId: 'saved-draft',
    })
    await Promise.resolve()
    expect(readItems).toHaveBeenCalledOnce()
    revision += 1
    finishRead([item('saved-draft')])
    await expect(restore).resolves.toBeNull()
  })

  it('does not recover or redirect after the workspace was unmounted during its IndexedDB read', async () => {
    let finishRead!: (items: ThoughtOutboxItem[]) => void
    let mounted = true
    const restore = loadDraftForRecovery({
      pendingWrite: Promise.resolve(),
      readItems: () => new Promise((resolve) => { finishRead = resolve }),
      stillCurrent: () => mounted,
      userId, thoughtId, entryId: 'continuation',
    })
    await Promise.resolve()
    mounted = false
    finishRead([item('continuation', { createsThought: false })])
    await expect(restore).resolves.toBeNull()
  })
})

describe('taking away original and local content', () => {
  it('preserves the complete cloud export, including entries from another tab, and appends local state without guessing IDs from prose', () => {
    const cloud = '# retniw\n\n其他设备刚保存的第501段\n\n- 条目 ID：draft\n这是用户原文中出现的ID格式。\n'
    const local = item('draft', { content: '本机还有一段草稿' })
    const markdown = appendLocalThoughtMarkdown(cloud, userId, thoughtId, [local], '2026-09-07T12:00:00.000Z')
    expect(markdown.startsWith(cloud)).toBe(true)
    expect(markdown).toContain('其他设备刚保存的第501段')
    expect(markdown).toContain('本机还有一段草稿')
    expect(markdown).toContain('相同条目 ID 的内容可能也已出现在云端正文中')
    expect(markdown.match(/条目 ID：draft/g)).toHaveLength(2)
  })

  it('uses the live textarea over a stale draft, preserves original whitespace, and respects a just-cleared draft', () => {
    const stored = item('live', { content: '旧内容' })
    const current = item('live', { content: '  新的一行\n\n下一行，“原样”  \n' })
    expect(localExportItems(userId, [stored], current)[0].content).toBe(current.content)
    expect(localExportItems(userId, [stored], { ...current, content: '' })).toEqual([])
  })

  it('never downgrades a submitted item to a draft or deletes it due to stale textarea state', () => {
    const submitted = item('submitted', { state: 'pending', content: '已入队原文' })
    expect(localExportItems(userId, [submitted], item('submitted'))).toEqual([submitted])
    expect(localExportItems(userId, [submitted], item('submitted', { content: '' }))).toEqual([submitted])
  })

  it('exports loaded original entries, pending, failed, all drafts and checkpoints exactly once', () => {
    const pending = item('pending', { state: 'pending', content: '  待同步原文\n' })
    const failed = item('failed', { state: 'failed', content: '同步失败原文' })
    const draft = item('draft', { content: '尚未提交的文字' })
    const markdown = createCurrentThoughtMarkdown({
      userId, thoughtId,
      entries: [
        entry('original', '  原文，“标点”\n第二行\n'),
        entry('pending', pending.content),
        entry('ai', '可以继续写：保持原始AI输出', { entryType: 'ai', aiAction: 'advance' }),
        entry('unrelated', '其他想法不能混入', { thoughtId: 'thought-b' }),
      ],
      checkpoints: [{ id: 'checkpoint', thoughtId, clientRequestId: 'request-checkpoint', note: '下次接着写', createdAt: '2026-09-07T09:30:00.000Z' }],
      localItems: [pending, failed, draft, item('other-owner', { userId: 'owner-b', content: '别人的内容' })],
      currentDraft: item('draft', { content: '尚未提交的文字\n刚写下的新一句' }),
      exportedAt: '2026-09-07T12:00:00.000Z',
    })
    expect(markdown).toContain('  原文，“标点”\n第二行\n')
    expect(markdown).toContain('可以继续写：保持原始AI输出')
    expect(markdown.match(/条目 ID：pending/g)).toHaveLength(1)
    expect(markdown).toContain('等待同步，尚未确认保存到云端')
    expect(markdown).toContain('同步失败，内容保留在本机')
    expect(markdown).toContain('尚未提交的文字\n刚写下的新一句')
    expect(markdown).toContain('本机草稿，尚未保存到想法中')
    expect(markdown).toContain('先到这里')
    expect(markdown).not.toContain('其他想法不能混入')
    expect(markdown).not.toContain('别人的内容')
  })

  it('exports all owned local states across thoughts with an explicit offline scope and parseable original text', () => {
    const originals = [item('one'), item('two', { thoughtId: 'thought-b', state: 'failed', content: '  原文\n' })]
    const json = JSON.parse(createLocalContentJson(userId, [...originals, item('secret', { userId: 'owner-b' })], undefined, '2026-09-07T12:00:00.000Z', true))
    expect(json.items).toEqual(originals)
    expect(json.offline).toBe(true)
    expect(json.scope).toContain('不包含全部云端想法')
    const markdown = createCurrentThoughtMarkdown({ userId, thoughtId, entries: [], checkpoints: [], localItems: originals, offline: true })
    expect(markdown).toContain('离线快照，未核对云端最新状态')
  })
})

describe('export account and network boundaries', () => {
  function page(owner = userId, online = true) {
    vi.stubGlobal('document', { querySelector: () => ({ dataset: { retniwUserId: owner } }) })
    vi.stubGlobal('navigator', { onLine: online })
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    return dispatchEvent
  }

  it('allows local snapshots offline without contacting the server', async () => {
    page(userId, false)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(verifyExportOwner(userId, true)).resolves.toBe('offline')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows local fallback for a network failure while cloud export still fails', async () => {
    page()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(verifyExportOwner(userId, true)).resolves.toBe('offline')
    await expect(verifyExportOwner(userId)).rejects.toThrow('Failed to fetch')
  })

  it.each([401, 403, 409, 500])('does not turn an explicit HTTP %i rejection into offline permission', async (status) => {
    const dispatch = page()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))
    await expect(verifyExportOwner(userId, true)).rejects.toThrow()
    if (status === 409) expect(dispatch.mock.calls[0]?.[0].type).toBe('retniw:auth-context-changed')
  })

  it('rejects local content under a different account page even when offline', async () => {
    page('owner-b', false)
    await expect(verifyExportOwner(userId, true)).rejects.toThrow('AUTH_CONTEXT_CHANGED')
  })

  it('reads the full existing cloud Markdown endpoint with owner binding', async () => {
    const markdown = '# retniw\n' + Array.from({ length: 501 }, (_, index) => `\n第${index}段`).join('')
    const fetchMock = vi.fn().mockResolvedValue(new Response(markdown, { headers: { 'content-type': 'text/markdown; charset=utf-8' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(readCloudThoughtMarkdown(userId, thoughtId)).resolves.toBe(markdown)
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/thoughts/${thoughtId}/export.md`)
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('x-retniw-expected-user-id')).toBe(userId)
  })

  it('discards a partial cloud stream instead of returning it as a complete export', async () => {
    let reads = 0
    const partial = new ReadableStream({
      pull(controller) {
        if (reads++ === 0) controller.enqueue(new TextEncoder().encode('# retniw\n只有开头'))
        else controller.error(new Error('stream interrupted'))
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(partial, { headers: { 'content-type': 'text/markdown' } })))
    await expect(readCloudThoughtMarkdown(userId, thoughtId)).resolves.toBeNull()
  })

  it('does not silently fall back to a page snapshot for an explicit cloud server error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('server failed', { status: 500 })))
    await expect(readCloudThoughtMarkdown(userId, thoughtId)).rejects.toThrow('EXPORT_FAILED')
  })
})
