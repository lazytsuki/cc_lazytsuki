import type { ThoughtOutboxItem } from './capture-store'

export function draftRecoveryKey(userId: string, thoughtId: string) {
  return `retniw:restore-draft:${userId}:${thoughtId}`
}

export function listLocalDrafts(items: ThoughtOutboxItem[], userId: string, activeEntryId: string) {
  return items.filter((item) =>
    item.userId === userId && item.state === 'draft' && item.entryId !== activeEntryId && item.content.length > 0,
  ).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.entryId.localeCompare(right.entryId))
}

export function findRecoverableItem(
  items: ThoughtOutboxItem[],
  userId: string,
  thoughtId: string | null,
  requestedEntryId?: string | null,
) {
  const candidates = items.filter((item) =>
    item.userId === userId && (thoughtId ? item.thoughtId === thoughtId : item.createsThought),
  )
  if (requestedEntryId) {
    return candidates.find((item) => item.entryId === requestedEntryId && item.state === 'draft') ?? null
  }
  return candidates.sort((left, right) =>
    left.updatedAt.localeCompare(right.updatedAt) || left.entryId.localeCompare(right.entryId),
  ).at(-1) ?? null
}

export async function loadDraftForRecovery({
  pendingWrite,
  readItems,
  stillCurrent,
  userId,
  thoughtId,
  entryId,
}: {
  pendingWrite: Promise<void>
  readItems: () => Promise<ThoughtOutboxItem[]>
  stillCurrent: () => boolean
  userId: string
  thoughtId: string
  entryId: string
}) {
  await pendingWrite
  if (!stillCurrent()) return null
  const stored = await readItems()
  if (!stillCurrent()) return null
  return findRecoverableItem(stored, userId, thoughtId, entryId)
}
