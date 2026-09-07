import type { ThoughtOutboxItem } from './capture-store'
import type { Entry } from '@/src/server/repositories/entry-repository'
import type { ThoughtCheckpoint } from '@/src/server/repositories/checkpoint-repository'

export function localExportItems(
  userId: string,
  items: ThoughtOutboxItem[],
  currentDraft?: ThoughtOutboxItem,
) {
  const owned = new Map(items.filter((item) => item.userId === userId).map((item) => [item.entryId, item]))
  if (currentDraft?.userId === userId) {
    // The textarea may be newer than IndexedDB, including a just-cleared draft.
    const stored = owned.get(currentDraft.entryId)
    if (!stored || stored.state === 'draft') {
      if (currentDraft.content.length > 0) owned.set(currentDraft.entryId, currentDraft)
      else owned.delete(currentDraft.entryId)
    }
  }
  return [...owned.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.entryId.localeCompare(right.entryId),
  )
}

const localStateLabels = {
  draft: '本机草稿，尚未保存到想法中',
  pending: '等待同步，尚未确认保存到云端',
  failed: '同步失败，内容保留在本机',
}

function entryMarkdown(entry: Pick<Entry, 'id' | 'entryType' | 'sourceLabel' | 'createdAt' | 'content'>, localItem?: ThoughtOutboxItem) {
  const author = entry.entryType === 'ai' ? 'AI' : entry.entryType === 'import' ? '导入' : '用户'
  const source = entry.sourceLabel ? `\n- 来源：${entry.sourceLabel}` : ''
  const state = localItem ? `\n- 状态：${localStateLabels[localItem.state]}` : ''
  return `\n## ${localItem?.state === 'draft' ? '草稿 · ' : ''}${entry.createdAt}\n\n- 条目 ID：${entry.id}\n- 作者：${author}${source}${state}\n\n${entry.content}\n`
}

export function appendLocalThoughtMarkdown(cloudMarkdown: string, userId: string, thoughtId: string, items: ThoughtOutboxItem[], exportedAt: string) {
  const local = localExportItems(userId, items).filter((item) => item.thoughtId === thoughtId)
  if (local.length === 0) return cloudMarkdown
  return `${cloudMarkdown}\n\n---\n\n# 本机内容附录\n\n- 导出时间：${exportedAt}\n- 以下是此浏览器保留的草稿和未同步内容。草稿尚未提交。\n- 同步可能刚刚完成，相同条目 ID 的内容可能也已出现在云端正文中。两处记录的是同一条内容及其本机保存状态。\n${local.map((item) => entryMarkdown({ ...item, id: item.entryId }, item)).join('')}`
}

export function createLocalContentJson(
  userId: string,
  items: ThoughtOutboxItem[],
  currentDraft?: ThoughtOutboxItem,
  exportedAt = new Date().toISOString(),
  offline = false,
) {
  return JSON.stringify({
    format: 'retniw.local-content.v1',
    exportedAt,
    offline,
    scope: '当前账号在此浏览器的草稿和未同步内容；不包含全部云端想法。',
    stateLabels: localStateLabels,
    items: localExportItems(userId, items, currentDraft),
  }, null, 2)
}

export function createCurrentThoughtMarkdown({
  userId,
  thoughtId,
  entries,
  checkpoints,
  localItems,
  currentDraft,
  exportedAt = new Date().toISOString(),
  offline = false,
}: {
  userId: string
  thoughtId: string
  entries: Entry[]
  checkpoints: ThoughtCheckpoint[]
  localItems: ThoughtOutboxItem[]
  currentDraft?: ThoughtOutboxItem
  exportedAt?: string
  offline?: boolean
}) {
  const local = localExportItems(userId, localItems, currentDraft).filter((item) => item.thoughtId === thoughtId)
  const localById = new Map(local.map((item) => [item.entryId, item]))
  const combined = new Map(entries.filter((entry) => entry.thoughtId === thoughtId).map((entry) => [entry.id, entry]))
  for (const item of local) {
    combined.set(item.entryId, {
      id: item.entryId,
      thoughtId,
      clientRequestId: item.clientRequestId,
      entryType: item.entryType,
      content: item.content,
      sourceLabel: item.sourceLabel,
      aiAction: null,
      createdAt: item.createdAt,
    })
  }

  const timeline = [
    ...[...combined.values()].map((entry) => {
      const localItem = localById.get(entry.id)
      return {
        id: entry.id,
        createdAt: entry.createdAt,
        draft: localItem?.state === 'draft',
        text: entryMarkdown(entry, localItem),
      }
    }),
    ...checkpoints.filter((checkpoint) => checkpoint.thoughtId === thoughtId).map((checkpoint) => ({
      id: checkpoint.id,
      createdAt: checkpoint.createdAt,
      draft: false,
      text: `\n## 先到这里 · ${checkpoint.createdAt}\n\n${checkpoint.note || '（未留备注）'}\n`,
    })),
  ].sort((left, right) =>
    Number(left.draft) - Number(right.draft) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  )

  return `# retniw\n\n- 过程 ID：${thoughtId}\n- 导出时间：${exportedAt}\n- 范围：当前页面已加载的原文、检查点，以及此想法的本机草稿和未同步内容。\n${offline ? '- 联网状态：离线快照，未核对云端最新状态。\n' : ''}- 仍在生成的 AI 内容不包含在本次导出中。\n${timeline.map((item) => item.text).join('')}`
}
