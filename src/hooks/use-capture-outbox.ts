'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  claimLegacyThoughtOutboxItems,
  deleteThoughtOutboxDraft,
  deleteThoughtOutboxItem,
  discardThoughtOutboxItems,
  enqueueThoughtOutboxItem,
  isThoughtOutboxDiscarded,
  listDiscardedThoughtIds,
  thoughtOutboxDiscardEvent,
  thoughtOutboxDiscardStorageKey,
  withThoughtOutboxLock,
  listThoughtOutboxItems,
  putThoughtOutboxDraft,
  putThoughtOutboxItem,
  type ThoughtOutboxItem,
} from '@/src/lib/capture/capture-store'
import { authContextChangedEvent, userBoundFetch } from '@/src/lib/auth/user-bound-fetch'
import type { Entry } from '@/src/server/repositories/entry-repository'

export async function sendThoughtOutboxItem(item: ThoughtOutboxItem) {
  const path = item.createsThought
    ? '/api/thoughts'
    : `/api/thoughts/${item.thoughtId}/entries`
  const body = {
    ...(item.createsThought ? { thoughtId: item.thoughtId } : {}),
    entryId: item.entryId,
    clientRequestId: item.clientRequestId,
    content: item.content,
    entryType: item.entryType,
    sourceLabel: item.sourceLabel,
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await userBoundFetch(item.userId, path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => null) as {
      data?: { entry?: Entry }
      error?: { code?: string }
    } | null

    if (response.status === 409 && payload?.error?.code === 'AUTH_CONTEXT_CHANGED') {
      throw new Error('AUTH_CONTEXT_CHANGED')
    }

    if (
      (!item.createsThought && response.status === 404) ||
      (response.status === 409 && payload?.error?.code === 'THOUGHT_DELETED')
    ) {
      return { entry: null, targetMissing: true as const }
    }
    if (!response.ok) throw new Error('SAVE_FAILED')
    if (!payload?.data?.entry) throw new Error('SAVE_FAILED')
    return { entry: payload.data.entry, targetMissing: false as const }
  } finally {
    clearTimeout(timeout)
  }
}

type OutboxOperations = {
  send: (item: ThoughtOutboxItem) => Promise<void>
  remove: (entryId: string) => Promise<void>
  markFailed: (item: ThoughtOutboxItem) => Promise<void>
}

const thoughtOutboxSyncedEvent = 'retniw:thought-outbox-synced'
const recentlySyncedItems = new Map<string, ThoughtOutboxItem>()

function notifyThoughtOutboxSynced(item: ThoughtOutboxItem) {
  recentlySyncedItems.set(item.entryId, item)
  window.dispatchEvent(new CustomEvent(thoughtOutboxSyncedEvent, { detail: { item } }))
  window.setTimeout(() => recentlySyncedItems.delete(item.entryId), 30_000)
}

export async function flushThoughtOutboxItems(
  items: ThoughtOutboxItem[],
  operations: OutboxOperations,
) {
  const queued = items
    .filter((item) => item.state !== 'draft')
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.entryId.localeCompare(right.entryId),
    )
  const blockedThoughtIds = new Set<string>()
  let failedEntryId: string | null = null
  for (const item of queued) {
    if (blockedThoughtIds.has(item.thoughtId)) continue
    if (item.state === 'failed') {
      blockedThoughtIds.add(item.thoughtId)
      failedEntryId ??= item.entryId
      continue
    }

    try {
      await operations.send(item)
      await operations.remove(item.entryId)
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTH_CONTEXT_CHANGED') {
        return { failedEntryId, authContextChanged: true }
      }
      await operations.markFailed(item)
      blockedThoughtIds.add(item.thoughtId)
      failedEntryId ??= item.entryId
    }
  }
  return { failedEntryId, authContextChanged: false }
}

export function useCaptureOutbox(userId: string, onSynced?: (item: ThoughtOutboxItem) => void) {
  const [items, setItems] = useState<ThoughtOutboxItem[]>([])
  const [legacyItemCount, setLegacyItemCount] = useState(0)
  const [ready, setReady] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [authContextChanged, setAuthContextChanged] = useState(false)
  const [discardedThoughtIds, setDiscardedThoughtIds] = useState(
    () => new Set(listDiscardedThoughtIds(userId)),
  )
  const flushRef = useRef<Promise<void> | null>(null)
  const flushRequestedRef = useRef(false)
  const onSyncedRef = useRef(onSynced)
  const discardedThoughtIdsRef = useRef(new Set(listDiscardedThoughtIds(userId)))

  useEffect(() => {
    const stopForAccountChange = () => setAuthContextChanged(true)
    window.addEventListener(authContextChangedEvent, stopForAccountChange)
    return () => window.removeEventListener(authContextChangedEvent, stopForAccountChange)
  }, [])

  const itemIsDiscarded = useCallback((thoughtId: string) => {
    return discardedThoughtIdsRef.current.has(thoughtId) || isThoughtOutboxDiscarded(userId, thoughtId)
  }, [userId])

  useEffect(() => {
    onSyncedRef.current = onSynced
  }, [onSynced])

  useEffect(() => {
    const handleSynced = (event: Event) => {
      const item = (event as CustomEvent<{ item?: ThoughtOutboxItem }>).detail?.item
      if (item?.userId === userId) onSyncedRef.current?.(item)
    }
    window.addEventListener(thoughtOutboxSyncedEvent, handleSynced)
    for (const item of recentlySyncedItems.values()) {
      if (item.userId === userId) onSyncedRef.current?.(item)
    }
    return () => window.removeEventListener(thoughtOutboxSyncedEvent, handleSynced)
  }, [userId])

  useEffect(() => {
    const applyDiscarded = (thoughtIds: string[]) => {
      for (const thoughtId of thoughtIds) discardedThoughtIdsRef.current.add(thoughtId)
      setDiscardedThoughtIds(new Set(discardedThoughtIdsRef.current))
      setItems((current) => current.filter((item) => !discardedThoughtIdsRef.current.has(item.thoughtId)))
    }
    const handleDiscard = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: unknown; thoughtId?: unknown }>).detail
      if (detail?.userId === userId && typeof detail.thoughtId === 'string') applyDiscarded([detail.thoughtId])
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === thoughtOutboxDiscardStorageKey(userId)) applyDiscarded(listDiscardedThoughtIds(userId))
    }
    applyDiscarded(listDiscardedThoughtIds(userId))
    window.addEventListener(thoughtOutboxDiscardEvent, handleDiscard)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(thoughtOutboxDiscardEvent, handleDiscard)
      window.removeEventListener('storage', handleStorage)
    }
  }, [userId])

  const reload = useCallback(async () => {
    const stored = await listThoughtOutboxItems()
    setLegacyItemCount(stored.filter((item) => typeof item.userId !== 'string').length)
    const visible = stored.filter((item) => item.userId === userId && !itemIsDiscarded(item.thoughtId))
    setItems(visible)
    return visible
  }, [itemIsDiscarded, userId])

  const flush = useCallback(() => {
    flushRequestedRef.current = true
    if (flushRef.current) return flushRef.current

    const operation = (async () => {
      setSyncing(true)
      try {
        await withThoughtOutboxLock(userId, async () => {
          while (flushRequestedRef.current) {
            flushRequestedRef.current = false
            const stored = (await listThoughtOutboxItems()).filter((item) => item.userId === userId)
            const savedEntries = new Map<string, Entry>()
            const result = await flushThoughtOutboxItems(stored, {
              send: async (item) => {
                if (itemIsDiscarded(item.thoughtId)) return
                const sendResult = await sendThoughtOutboxItem(item)
                if (sendResult.targetMissing) {
                  await discardThoughtOutboxItems(userId, item.thoughtId)
                  return
                }
                if (sendResult.entry) savedEntries.set(item.entryId, sendResult.entry)
              },
              remove: async (entryId) => {
                await deleteThoughtOutboxItem(userId, entryId)
                const item = stored.find((candidate) => candidate.entryId === entryId)
                if (item && !itemIsDiscarded(item.thoughtId)) {
                  const savedEntry = savedEntries.get(item.entryId)
                  notifyThoughtOutboxSynced(
                    savedEntry ? { ...item, createdAt: savedEntry.createdAt } : item,
                  )
                }
              },
              markFailed: async (item) => {
                if (itemIsDiscarded(item.thoughtId)) {
                  await deleteThoughtOutboxItem(userId, item.entryId)
                  return
                }
                await putThoughtOutboxItem({
                  ...item,
                  state: 'failed',
                  updatedAt: new Date().toISOString(),
                })
                if (itemIsDiscarded(item.thoughtId)) {
                  await deleteThoughtOutboxItem(userId, item.entryId)
                }
              },
            })
            await reload()
            if (result.authContextChanged) {
              setAuthContextChanged(true)
              break
            }
            if (result.failedEntryId && !flushRequestedRef.current) break
          }
        })
      } finally {
        flushRef.current = null
        setSyncing(false)
      }
    })()

    flushRef.current = operation
    return operation
  }, [itemIsDiscarded, reload, userId])

  useEffect(() => {
    listThoughtOutboxItems()
      .then((stored) => {
        setLegacyItemCount(stored.filter((item) => typeof item.userId !== 'string').length)
        const owned = stored.filter((item) => item.userId === userId)
        const discarded = owned.filter((item) => itemIsDiscarded(item.thoughtId))
        setItems(owned.filter((item) => !itemIsDiscarded(item.thoughtId)))
        return Promise.all(discarded.map((item) => deleteThoughtOutboxItem(userId, item.entryId)))
      })
      .catch(() => undefined)
      .finally(() => setReady(true))
  }, [itemIsDiscarded, userId])

  useEffect(() => {
    const failedThoughtIds = new Set(
      items.filter((item) => item.state === 'failed').map((item) => item.thoughtId),
    )
    const hasSendablePending = items.some(
      (item) => item.state === 'pending' && !failedThoughtIds.has(item.thoughtId),
    )
    if (!ready || authContextChanged || !hasSendablePending) return
    const timer = window.setTimeout(() => void flush(), 0)
    return () => window.clearTimeout(timer)
  }, [authContextChanged, flush, items, ready])

  const saveDraft = useCallback(async (item: ThoughtOutboxItem) => {
    if (item.userId !== userId) return
    if (itemIsDiscarded(item.thoughtId)) return
    const stored = await putThoughtOutboxDraft(item)
    if (!stored) {
      await reload()
      return
    }
    if (itemIsDiscarded(item.thoughtId)) {
      await deleteThoughtOutboxItem(userId, item.entryId)
      return
    }
    await reload()
  }, [itemIsDiscarded, reload, userId])

  const remove = useCallback(async (entryId: string) => {
    await deleteThoughtOutboxDraft(userId, entryId)
    await reload()
  }, [reload, userId])

  const enqueue = useCallback(
    async (item: ThoughtOutboxItem) => {
      if (item.userId !== userId) throw new Error('OUTBOX_OWNER_MISMATCH')
      if (itemIsDiscarded(item.thoughtId)) throw new Error('THOUGHT_DISCARDED')
      if (authContextChanged) throw new Error('AUTH_CONTEXT_CHANGED')
      const queued = await enqueueThoughtOutboxItem(item)
      if (!queued) throw new Error('OUTBOX_ALREADY_QUEUED')
      if (itemIsDiscarded(item.thoughtId)) {
        await deleteThoughtOutboxItem(userId, item.entryId)
        throw new Error('THOUGHT_DISCARDED')
      }
      await reload()
      queueMicrotask(() => void flush())
    },
    [authContextChanged, flush, itemIsDiscarded, reload, userId],
  )

  const retry = useCallback(async () => {
    if (authContextChanged) return
    const stored = await listThoughtOutboxItems()
    await Promise.all(
      stored
        .filter((item) => item.userId === userId && item.state === 'failed' && !itemIsDiscarded(item.thoughtId))
        .map(async (item) => {
          await putThoughtOutboxItem({ ...item, state: 'pending', updatedAt: new Date().toISOString() })
          if (itemIsDiscarded(item.thoughtId)) await deleteThoughtOutboxItem(userId, item.entryId)
        }),
    )
    await reload()
    await flush()
  }, [authContextChanged, flush, itemIsDiscarded, reload, userId])

  const recoverLegacy = useCallback(async () => {
    await claimLegacyThoughtOutboxItems(userId)
    setLegacyItemCount(0)
    window.location.reload()
  }, [userId])

  useEffect(() => {
    const handleOnline = () => void retry()
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [retry])

  return {
    items,
    legacyItemCount,
    ready,
    syncing,
    authContextChanged,
    discardedThoughtIds,
    saveDraft,
    remove,
    enqueue,
    retry,
    recoverLegacy,
  }
}
