import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import {
  decodeSearchCursor,
  encodeSearchCursor,
  escapeSearchPattern,
  makeSearchExcerpt,
  parseSearchQuery,
  SEARCH_PAGE_SIZE,
  ThoughtSearchRepository,
} from '@/src/server/repositories/thought-search-repository'

const userId = '018f6f3a-a1c2-47a8-8f1e-800000000001'
const thoughtId = '018f6f3a-a1c2-47a8-8f1e-800000000002'
const entryId = '018f6f3a-a1c2-47a8-8f1e-800000000003'
const createdAt = '2026-09-07T01:00:00.123456+00:00'

function row(index: number, content = '记下一段原文') {
  return {
    id: `018f6f3a-a1c2-47a8-8f1e-${String(index).padStart(12, '0')}`,
    thought_id: thoughtId,
    entry_type: 'user',
    content,
    source_label: null,
    created_at: createdAt,
    thought: { archived_at: null },
  }
}

function setup(rows: unknown[] = [], failed = false) {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(failed ? { message: 'unavailable' } : rows), {
    status: failed ? 500 : 200,
    headers: { 'content-type': 'application/json' },
  }))
  const client = createClient('https://search-fixture.invalid', 'fixture-key', {
    global: { fetch: fetcher },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return { repository: new ThoughtSearchRepository(client), fetcher }
}

describe('literal thought search', () => {
  it('queries the complete entry body with owner, deletion and original-text boundaries before pagination', async () => {
    const { repository, fetcher } = setup()
    const query = '100%_\\notes* [想法] (a|b).'
    await repository.search(userId, query)

    const request = new URL(String(fetcher.mock.calls[0][0]))
    expect(request.pathname).toBe('/rest/v1/entries')
    expect(request.searchParams.get('select')).toContain('thoughts!entries_thought_owner_fk!inner(archived_at)')
    expect(request.searchParams.get('user_id')).toBe(`eq.${userId}`)
    expect(request.searchParams.get('thought.user_id')).toBe(`eq.${userId}`)
    expect(request.searchParams.get('thought.deleted_at')).toBe('is.null')
    expect(request.searchParams.get('entry_type')).toBe('in.(user,import)')
    expect(request.searchParams.get('content')).toBe(`imatch.${escapeSearchPattern(query)}`)
    expect(request.searchParams.get('order')).toBe('created_at.desc,id.desc')
    expect(request.searchParams.get('limit')).toBe(String(SEARCH_PAGE_SIZE + 1))
    expect(request.searchParams.has('thought.archived_at')).toBe(false)
    expect(request.searchParams.has('thought_id')).toBe(false)
    expect(request.searchParams.has('offset')).toBe(false)
  })

  it.each(['100%', 'under_score', '\\notes\\', '**bold**', '(a|b)', '[draft]', 'a+b?', '^first.$', '你好', '"quoted",test'])('matches %s literally', (query) => {
    const pattern = new RegExp(escapeSearchPattern(query), 'iu')
    expect(pattern.test(`前面的内容 ${query} 后面的内容`)).toBe(true)
    expect(makeSearchExcerpt(`前面的内容 ${query} 后面的内容`, query).match).toBe(query)
  })

  it('does not interpret wildcard or regular-expression input as a broader match', () => {
    for (const [query, unrelated] of [['100%', '1000'], ['under_score', 'under-score'], ['a.*b', 'axxxb'], ['a|b', 'a'], ['\\d+', '123']]) {
      expect(new RegExp(escapeSearchPattern(query), 'iu').test(unrelated)).toBe(false)
    }
  })

  it('returns a bounded matched excerpt deep in a later archived import entry', async () => {
    const content = '第一段只是背景。'.repeat(300) + '\n\n这里继续写 Reconnect。' + '后面的补充。'.repeat(200)
    const { repository } = setup([{ ...row(1, content), entry_type: 'import', source_label: '本地笔记', thought: { archived_at: createdAt } }])
    const page = await repository.search(userId, 'reconnect')
    expect(page.results).toHaveLength(1)
    expect(page.results[0]).toMatchObject({
      entryType: 'import',
      sourceLabel: '本地笔记',
      archivedAt: createdAt,
      thoughtId,
      excerpt: { match: 'Reconnect' },
    })
    const excerpt = page.results[0].excerpt
    expect(excerpt.before.startsWith('…')).toBe(true)
    expect(excerpt.after.endsWith('…')).toBe(true)
    expect(`${excerpt.before}${excerpt.match}${excerpt.after}`.length).toBeLessThanOrEqual(266)
    expect(page.results[0]).not.toHaveProperty('content')
  })

  it('uses a stable two-column cursor after the twentieth result without rounding timestamp precision', async () => {
    const { repository, fetcher } = setup(Array.from({ length: 21 }, (_, index) => row(21 - index)))
    const first = await repository.search(userId, '原文')
    expect(first.results).toHaveLength(20)
    expect(first.results.at(-1)?.entryId).toBe(row(2).id)
    expect(decodeSearchCursor(first.nextCursor!, '原文')).toEqual({ query: '原文', createdAt, id: row(2).id })

    await repository.search(userId, '原文', first.nextCursor!)
    const request = new URL(String(fetcher.mock.calls[1][0]))
    expect(request.searchParams.get('or')).toBe(`(created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${row(2).id}))`)
  })

  it('stops pagination on a full last page and returns an empty page cleanly', async () => {
    const full = await setup(Array.from({ length: 20 }, (_, index) => row(index))).repository.search(userId, '原文')
    expect(full.nextCursor).toBeNull()
    await expect(setup().repository.search(userId, '原文')).resolves.toEqual({ results: [], nextCursor: null })
  })

  it('rejects invalid query and cursor inputs before touching the database', async () => {
    const { repository, fetcher } = setup()
    for (const query of ['', '  ', 'a'.repeat(121), 'a\0b']) {
      await expect(repository.search(userId, query)).rejects.toMatchObject({ status: 400 })
    }
    const valid = { query: '原文', createdAt, id: entryId }
    for (const cursor of [
      '',
      'not-json',
      'x'.repeat(2049),
      encodeSearchCursor({ ...valid, query: '另一个词' }),
      encodeSearchCursor({ ...valid, createdAt: `${createdAt},id.neq.null` }),
      encodeSearchCursor({ ...valid, id: 'bad-id' }),
    ]) {
      await expect(repository.search(userId, '原文', cursor)).rejects.toMatchObject({ status: 400 })
    }
    expect(fetcher).not.toHaveBeenCalled()
    expect(parseSearchQuery('  原文  ')).toBe('原文')
  })

  it('surfaces database failures without exposing database error details', async () => {
    await expect(setup([], true).repository.search(userId, '原文')).rejects.toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: '暂时无法搜索，请重试',
      retryable: true,
    })
  })
})
