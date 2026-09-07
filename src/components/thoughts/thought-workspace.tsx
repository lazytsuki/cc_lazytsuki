'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ThinkingAssist } from './thinking-assist'
import { StreamingAiEntry } from './streaming-ai-entry'
import { ThoughtComposer } from './thought-composer'
import { SyncStatus } from './sync-status'
import { useAiAction } from '@/src/hooks/use-ai-action'
import { useCaptureOutbox } from '@/src/hooks/use-capture-outbox'
import { authContextChangedEvent, currentPageUserId, userBoundFetch } from '@/src/lib/auth/user-bound-fetch'
import { isThoughtOutboxDiscarded, listThoughtOutboxItems, type ThoughtOutboxItem } from '@/src/lib/capture/capture-store'
import { draftRecoveryKey, findRecoverableItem, listLocalDrafts, loadDraftForRecovery } from '@/src/lib/capture/local-drafts'
import type { Entry } from '@/src/server/repositories/entry-repository'
import type { Thought } from '@/src/server/repositories/thought-repository'
import { EntryActions } from './entry-actions'
import { ImportTextDialog, type ImportRequestIds, type ImportSubmission } from './import-text-dialog'
import { useThoughtPosition } from '@/src/hooks/use-thought-position'
import { EntryContent } from './entry-content'
import { isMarkdownContent } from '@/src/lib/markdown'
import { hasNewUserContext } from '@/src/lib/ai-context'
import { aiOutputForDisplay } from '@/src/lib/ai-output'
import { requestHistoryAfterCheckpoint, ThoughtNavigation } from './thought-navigation'
import { ThoughtMenu } from './thought-menu'
import { CheckpointDialog } from './checkpoint-dialog'
import { ThoughtLayout } from './thought-layout'
import { LocalDrafts } from './local-drafts'
import type { ThoughtCheckpoint } from '@/src/server/repositories/checkpoint-repository'
import type { ThoughtCollection } from '@/src/server/repositories/collection-repository'
import { useOverlayController } from '@/src/components/overlay-provider'

export type ThoughtSummary = Thought & { firstEntry: Entry | null }

type ThoughtWorkspaceProps = {
  userId: string
  initialThought: Thought | null
  initialEntries: Entry[]
  initialCheckpoints: ThoughtCheckpoint[]
  initialCollections: ThoughtCollection[] | null
  initialThoughts: ThoughtSummary[]
  initialNextCursor: string | null
}

function nextIds() {
  return { entryId: crypto.randomUUID(), clientRequestId: crypto.randomUUID() }
}

const explicitNewThoughtKey = 'retniw:explicit-new-thought'

export function ThoughtWorkspace({
  userId,
  initialThought,
  initialEntries,
  initialCheckpoints,
  initialCollections,
  initialThoughts,
  initialNextCursor,
}: ThoughtWorkspaceProps) {
  const router = useRouter()
  const overlay = useOverlayController()
  const [thoughtId, setThoughtId] = useState(() => initialThought?.id ?? crypto.randomUUID())
  const thoughtIdRef = useRef(thoughtId)
  const [ids, setIds] = useState(nextIds)
  const [content, setContent] = useState('')
  const inputRevision = useRef(0)
  const draftWriteRef = useRef<Promise<void>>(Promise.resolve())
  const accountChangedRef = useRef(false)
  const workspaceMountedRef = useRef(true)
  const [localEntries, setLocalEntries] = useState<Entry[]>([])
  const [started, setStarted] = useState(Boolean(initialThought))
  const [serverReady, setServerReady] = useState(Boolean(initialThought))
  const [importPending, setImportPending] = useState(false)
  const [checkpointPending, setCheckpointPending] = useState(false)
  const [queueingEntry, setQueueingEntry] = useState(false)
  const [queueError, setQueueError] = useState('')
  const [targetEntryId, setTargetEntryId] = useState<string | null>(null)
  const importPendingRef = useRef(false)
  const checkpointPendingRef = useRef(false)
  const queueingEntryRef = useRef(false)
  const [localCheckpoints, setLocalCheckpoints] = useState<ThoughtCheckpoint[]>([])
  const checkpoints = useMemo(
    () => [...initialCheckpoints, ...localCheckpoints].sort(
      (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    ),
    [initialCheckpoints, localCheckpoints],
  )
  const lastCheckpoint = checkpoints.at(-1)
  const textareaRef = useThoughtPosition(
    thoughtId,
    content,
    lastCheckpoint ? `checkpoint-${lastCheckpoint.id}` : undefined,
    lastCheckpoint?.createdAt,
  )
  const handleEntrySynced = useCallback(
    (item: ThoughtOutboxItem) => {
      if (item.thoughtId !== thoughtIdRef.current) return
      if (item.createsThought) setServerReady(true)
      setLocalEntries((current) => {
        const syncedEntry: Entry = {
          id: item.entryId,
          thoughtId: item.thoughtId,
          clientRequestId: item.clientRequestId,
          entryType: item.entryType,
          content: item.content,
          sourceLabel: item.sourceLabel,
          aiAction: null,
          createdAt: item.createdAt,
        }
        return current.some((entry) => entry.id === item.entryId)
          ? current.map((entry) => entry.id === item.entryId ? syncedEntry : entry)
          : [...current, syncedEntry]
      })
    },
    [],
  )
  const outbox = useCaptureOutbox(userId, handleEntrySynced)
  useEffect(() => {
    workspaceMountedRef.current = true
    const stopForAccountChange = () => { accountChangedRef.current = true }
    window.addEventListener(authContextChangedEvent, stopForAccountChange)
    return () => {
      workspaceMountedRef.current = false
      window.removeEventListener(authContextChangedEvent, stopForAccountChange)
    }
  }, [])
  const restoredDraft = useRef(false)
  const waitingForFirstSync = useRef<string | null>(null)
  const firstSyncObserved = useRef(false)
  const handleAiSaved = useCallback((entry: Entry) => {
    setLocalEntries((current) => [...current.filter((item) => item.id !== entry.id), entry])
  }, [])
  const ai = useAiAction(userId, handleAiSaved)

  const activeOutbox = useMemo(
    () => outbox.items.filter((item) => item.thoughtId === thoughtId),
    [outbox.items, thoughtId],
  )
  const activeEntryIds = useMemo(
    () => new Set(activeOutbox.filter((item) => item.state !== 'draft').map((item) => item.entryId)),
    [activeOutbox],
  )
  const hasUnsettledEntry = activeOutbox.some(
    (item) => item.state === 'pending' || item.state === 'failed',
  )
  const thoughtDiscarded = outbox.discardedThoughtIds.has(thoughtId)
  const entryWritePending = queueingEntry || hasUnsettledEntry || thoughtDiscarded || outbox.authContextChanged
  const visibleQueueError = thoughtDiscarded
    ? '这个想法已在其他页面删除，请复制需要保留的内容。'
    : queueError

  useEffect(() => {
    if (!outbox.ready || restoredDraft.current) return
    restoredDraft.current = true
    if (!initialThought) {
      try {
        const explicitlyStartedNewThought = sessionStorage.getItem(explicitNewThoughtKey) === '1'
        sessionStorage.removeItem(explicitNewThoughtKey)
        if (explicitlyStartedNewThought) return
      } catch {
        // Fall through to normal draft recovery when browser storage is unavailable.
      }
    }
    let requestedEntryId: string | null = null
    if (initialThought) {
      try {
        const key = draftRecoveryKey(userId, initialThought.id)
        requestedEntryId = sessionStorage.getItem(key)
        sessionStorage.removeItem(key)
      } catch {
        // The latest draft for this thought remains recoverable without sessionStorage.
      }
    }
    const restored = findRecoverableItem(outbox.items, userId, initialThought?.id ?? null, requestedEntryId)
    if (!restored) return
    queueMicrotask(() => {
      // IndexedDB may finish loading after the user has already started writing.
      if (inputRevision.current > 0 || accountChangedRef.current || !workspaceMountedRef.current) return
      thoughtIdRef.current = restored.thoughtId
      setThoughtId(restored.thoughtId)
      setIds(
        restored.state === 'draft'
          ? { entryId: restored.entryId, clientRequestId: restored.clientRequestId }
          : nextIds(),
      )
      setContent(restored.state === 'draft' ? restored.content : '')
      setStarted(restored.state !== 'draft' || !restored.createsThought)
      if (restored.createsThought && restored.state !== 'draft') {
        waitingForFirstSync.current = restored.entryId
        firstSyncObserved.current = true
      }
    })
  }, [initialThought, outbox.items, outbox.ready, userId])

  useEffect(() => {
    if (!waitingForFirstSync.current) return
    const firstStillLocal = activeOutbox.some((item) => item.entryId === waitingForFirstSync.current)
    if (firstStillLocal) {
      firstSyncObserved.current = true
      return
    }
    if (!firstSyncObserved.current) return
    waitingForFirstSync.current = null
    firstSyncObserved.current = false
    router.replace(`/thoughts/${thoughtId}`, { scroll: false })
  }, [activeOutbox, router, thoughtId])

  const entries = useMemo(() => {
    const combined = new Map<string, Entry>()
    for (const entry of initialEntries) combined.set(entry.id, entry)
    for (const entry of localEntries) combined.set(entry.id, entry)
    for (const item of activeOutbox) {
      if (item.state === 'draft') continue
      combined.set(item.entryId, {
        id: item.entryId,
        thoughtId: item.thoughtId,
        clientRequestId: item.clientRequestId,
        entryType: item.entryType,
        content: item.content,
        sourceLabel: item.sourceLabel,
        aiAction: null,
        createdAt: item.createdAt,
      })
    }
    return Array.from(combined.values()).sort(
      (left, right) => {
        const leftPending = activeEntryIds.has(left.id)
        const rightPending = activeEntryIds.has(right.id)
        if (leftPending !== rightPending) return leftPending ? 1 : -1
        return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      },
    )
  }, [activeEntryIds, activeOutbox, initialEntries, localEntries])

  useEffect(() => {
    let frame = 0
    function revealLinkedEntry() {
      let targetId = ''
      try {
        targetId = decodeURIComponent(window.location.hash.slice(1))
      } catch {
        setTargetEntryId(null)
        return
      }
      const target = targetId.startsWith('entry-')
        ? document.getElementById(targetId)
        : null
      setTargetEntryId(target?.id ?? null)
      if (!target) return
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        target.focus({ preventScroll: true })
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' })
      }))
    }

    revealLinkedEntry()
    window.addEventListener('hashchange', revealLinkedEntry)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('hashchange', revealLinkedEntry)
    }
  }, [thoughtId])

  const directWritePending = importPending || checkpointPending
  const aiWritePending = ai.state.status === 'streaming'
  const otherDrafts = useMemo(() => listLocalDrafts(outbox.items, userId, ids.entryId)
    .filter((item) => !initialThought || item.thoughtId === initialThought.id),
  [initialThought, outbox.items, userId, ids.entryId])
  const canUseAi = serverReady && !entryWritePending && !directWritePending && !aiWritePending && entries.length > 0 && hasNewUserContext(entries)
  const displayThoughts = useMemo(() => {
    if (!serverReady || !started || entries.length === 0 || initialThought?.archivedAt) return initialThoughts
    const firstEntry = entries[0]
    const lastActivityAt = entries.at(-1)?.createdAt ?? firstEntry.createdAt
    const current: ThoughtSummary = {
      ...(initialThought ?? {
        id: thoughtId,
        createdAt: firstEntry.createdAt,
        relationCheckedAt: null,
        collectionId: null,
        archivedAt: null,
        deletedAt: null,
      }),
      lastActivityAt,
      firstEntry,
    }
    return [current, ...initialThoughts.filter((thought) => thought.id !== thoughtId)]
      .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))
  }, [entries, initialThought, initialThoughts, serverReady, started, thoughtId])

  function draftItem(nextContent: string): ThoughtOutboxItem {
    const now = new Date().toISOString()
    return {
      userId,
      thoughtId,
      entryId: ids.entryId,
      clientRequestId: ids.clientRequestId,
      content: nextContent,
      entryType: 'user',
      sourceLabel: null,
      createsThought: !started,
      state: 'draft',
      createdAt: activeOutbox.find((item) => item.entryId === ids.entryId)?.createdAt ?? now,
      updatedAt: now,
    }
  }

  function handleChange(nextContent: string) {
    inputRevision.current += 1
    setContent(nextContent)
    if (thoughtDiscarded) {
      setQueueError('这个想法已在其他页面删除，请复制需要保留的内容。')
      return
    }
    setQueueError('')
    const persist = nextContent
      ? outbox.saveDraft(draftItem(nextContent))
      : outbox.remove(ids.entryId)
    draftWriteRef.current = persist
    void persist.catch(() => setQueueError('没有保存到本机，请先保留这段内容。'))
  }

  async function handleRestoreDraft(item: ThoughtOutboxItem) {
    if (outbox.authContextChanged || directWritePending || aiWritePending || queueingEntryRef.current) return
    const revision = ++inputRevision.current
    try {
      const restored = await loadDraftForRecovery({
        pendingWrite: draftWriteRef.current,
        readItems: listThoughtOutboxItems,
        stillCurrent: () => workspaceMountedRef.current && inputRevision.current === revision && !accountChangedRef.current &&
          !queueingEntryRef.current && !importPendingRef.current && !checkpointPendingRef.current && currentPageUserId() === userId,
        userId, thoughtId: item.thoughtId, entryId: item.entryId,
      })
      if (!restored || isThoughtOutboxDiscarded(userId, restored.thoughtId)) return
      if (!restored.createsThought && restored.thoughtId !== initialThought?.id) {
        sessionStorage.setItem(draftRecoveryKey(userId, restored.thoughtId), restored.entryId)
        router.push(`/thoughts/${restored.thoughtId}`)
        return
      }
      inputRevision.current += 1
      thoughtIdRef.current = restored.thoughtId
      setThoughtId(restored.thoughtId)
      setIds({ entryId: restored.entryId, clientRequestId: restored.clientRequestId })
      setContent(restored.content)
      setStarted(!restored.createsThought)
      setServerReady(!restored.createsThought)
      setQueueError('')
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus({ preventScroll: true })
        textareaRef.current?.setSelectionRange(restored.content.length, restored.content.length)
        textareaRef.current?.scrollIntoView({ block: 'center' })
      })
    } catch {
      setQueueError('草稿没有打开，当前输入已保留，请重试。')
    }
  }

  function handleSubmit() {
    const trimmed = content.trim()
    if (
      !trimmed ||
      directWritePending ||
      aiWritePending ||
      thoughtDiscarded ||
      outbox.authContextChanged ||
      accountChangedRef.current ||
      queueingEntryRef.current
    ) return
    inputRevision.current += 1
    queueingEntryRef.current = true
    setQueueingEntry(true)
    setQueueError('')
    const item = { ...draftItem(trimmed), state: 'pending' as const }
    const optimistic: Entry = {
      id: item.entryId,
      thoughtId: item.thoughtId,
      clientRequestId: item.clientRequestId,
      entryType: item.entryType,
      content: item.content,
      sourceLabel: item.sourceLabel,
      aiAction: null,
      createdAt: item.createdAt,
    }

    setLocalEntries((current) => [...current, optimistic])
    setContent('')
    setIds(nextIds())
    if (!started) {
      setStarted(true)
      waitingForFirstSync.current = item.entryId
      firstSyncObserved.current = false
    }
    void outbox.enqueue(item).catch((error: unknown) => {
      setLocalEntries((current) => current.filter((entry) => entry.id !== item.entryId))
      setContent(item.content)
      setIds({ entryId: item.entryId, clientRequestId: item.clientRequestId })
      if (item.createsThought) {
        setStarted(false)
        waitingForFirstSync.current = null
        firstSyncObserved.current = false
      }
      setQueueError(
        error instanceof Error && error.message === 'THOUGHT_DISCARDED'
          ? '这个想法已在其他页面删除，内容没有保存。'
          : error instanceof Error && error.message === 'AUTH_CONTEXT_CHANGED'
            ? '账号已切换，内容仍保留在本机，请刷新后继续。'
            : '没有保存到本机，请再次保存。',
      )
    }).finally(() => {
      queueingEntryRef.current = false
      setQueueingEntry(false)
    })
  }

  async function handleImport(submission: ImportSubmission, requestIds: ImportRequestIds) {
    if (importPendingRef.current) throw new Error('正在导入，请稍候。')
    inputRevision.current += 1
    importPendingRef.current = true
    setImportPending(true)
    const createsThought = submission.target === 'new'
    const targetThoughtId = createsThought ? requestIds.thoughtId : thoughtId
    try {
      const response = await userBoundFetch(
        userId,
        createsThought ? '/api/thoughts' : `/api/thoughts/${targetThoughtId}/entries`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...(createsThought ? { thoughtId: targetThoughtId } : {}),
            entryId: requestIds.entryId,
            clientRequestId: requestIds.clientRequestId,
            content: submission.content,
            entryType: 'import',
            sourceLabel: submission.sourceLabel,
          }),
        },
      )
      const payload = (await response.json().catch(() => null)) as
        | { data?: { entry?: Entry }; error?: { message?: string } }
        | null
      if (!response.ok || !payload?.data?.entry) {
        throw new Error(payload?.error?.message ?? '导入失败，请重试')
      }

      if (createsThought) {
        router.push(`/thoughts/${targetThoughtId}`)
        return
      }

      setLocalEntries((current) => [...current, payload.data!.entry!])
    } finally {
      importPendingRef.current = false
      setImportPending(false)
    }
  }

  async function handleCheckpoint(
    note: string,
    requestIds: { entryId: string; clientRequestId: string },
  ) {
    if (checkpointPendingRef.current) throw new Error('CHECKPOINT_PENDING')
    inputRevision.current += 1
    checkpointPendingRef.current = true
    setCheckpointPending(true)
    try {
      const response = await userBoundFetch(userId, `/api/thoughts/${thoughtId}/checkpoints`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entryId: requestIds.entryId,
          clientRequestId: requestIds.clientRequestId,
          note,
        }),
      })
      const payload = await response.json().catch(() => null) as
        | { data?: { checkpoint?: ThoughtCheckpoint } }
        | null
      if (!response.ok || !payload?.data?.checkpoint) throw new Error('CHECKPOINT_FAILED')
      setLocalCheckpoints((current) => [...current, payload.data!.checkpoint!])
      requestHistoryAfterCheckpoint()
      router.push('/')
    } finally {
      checkpointPendingRef.current = false
      setCheckpointPending(false)
    }
  }

  const timeline = useMemo(() => [
    ...entries.map((entry) => ({
      kind: 'entry' as const,
      createdAt: entry.createdAt,
      id: entry.id,
      entry,
    })),
    ...checkpoints.map((checkpoint) => ({
      kind: 'checkpoint' as const,
      createdAt: checkpoint.createdAt,
      id: checkpoint.id,
      checkpoint,
    })),
  ].sort(
    (left, right) => {
      const leftPending = left.kind === 'entry' && activeEntryIds.has(left.id)
      const rightPending = right.kind === 'entry' && activeEntryIds.has(right.id)
      if (leftPending !== rightPending) return leftPending ? 1 : -1
      return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    },
  ), [activeEntryIds, checkpoints, entries])

  return (
    <ThoughtLayout>
      <ThoughtNavigation
        userId={userId}
        activeThoughtId={thoughtId}
        currentStarted={started}
        initialCollections={initialCollections}
        initialNextCursor={initialNextCursor}
        thoughts={displayThoughts}
      />
      <section className="thought-main" id="current-thought" aria-label="当前想法">
        <header className="workspace-heading">
          {started ? (
            <h1 className="workspace-kicker">当前想法</h1>
          ) : (
            <div className="workspace-heading-copy">
              <h1>写下你正在想的。</h1>
              <p className="workspace-intro">先留下一句，以后可以接着写。</p>
            </div>
          )}
          <div className="workspace-heading-actions">
            {!serverReady && !started && (
              <button
                className="workspace-import-action"
                type="button"
                disabled={importPending}
                onClick={(event) => overlay.open('import', event.currentTarget)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" />
                  <path d="M5 20h14" />
                </svg>
                导入文字
              </button>
            )}
            <ThoughtMenu
              userId={userId}
              thoughtId={thoughtId}
              organizeDisabled={!canUseAi}
              organizeRunning={ai.state.status === 'streaming' && ai.state.action === 'organize'}
              importDisabled={directWritePending || aiWritePending || entryWritePending}
              onImport={() => overlay.open('import')}
              onOrganize={() => { inputRevision.current += 1; void ai.run(thoughtId, 'organize') }}
              exportSnapshot={{ entries, checkpoints, localItems: outbox.items, currentDraft: draftItem(content), authContextChanged: outbox.authContextChanged, cloudThoughtReady: serverReady, localWritePending: queueingEntry }}
            />
          </div>
        </header>
        {timeline.length > 0 && (
          <div className="thought-entries">
            {timeline.map((item) => {
              if (item.kind === 'checkpoint') {
                return (
                  <div className="thought-checkpoint" id={`checkpoint-${item.checkpoint.id}`} key={item.id}>
                    <span>先到这里</span>
                    {item.checkpoint.note && <p>{item.checkpoint.note}</p>}
                  </div>
                )
              }
              const entry = item.entry
              const displayContent = entry.entryType === 'ai'
                ? aiOutputForDisplay(entry.content, entry.aiAction)
                : entry.content
              return (
                <article
                  className={`${entry.entryType === 'ai' ? 'thought-entry thought-entry--assist' : 'thought-entry'}${targetEntryId === `entry-${entry.id}` ? ' thought-entry--target' : ''}`}
                  id={`entry-${entry.id}`}
                  key={entry.id}
                  tabIndex={-1}
                >
                  {entry.entryType === 'import' && <p className="entry-source">来自 {entry.sourceLabel}</p>}
                  {entry.entryType === 'ai' && (
                    <p className="entry-source entry-source--assist">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6 5v5a4 4 0 0 0 4 4h8" />
                        <path d="m15 11 3 3-3 3" />
                        <circle cx="6" cy="5" r="2" />
                      </svg>
                      {entry.aiAction === 'organize' ? '整理结果' : '帮我接着想'}
                    </p>
                  )}
                  <EntryContent
                    content={displayContent}
                    markdown={isMarkdownContent(entry.entryType, entry.sourceLabel)}
                  />
                  <EntryActions content={displayContent} />
                </article>
              )
            })}
          </div>
        )}
        <StreamingAiEntry state={ai.state} onClear={ai.clear} />
        <ThoughtComposer
          autoFocus={!started}
          content={content}
          disabled={queueingEntry}
          saveDisabled={thoughtDiscarded || outbox.authContextChanged || directWritePending || aiWritePending}
          saveDisabledReason={aiWritePending ? '可以继续写，AI结束后再保存。' : directWritePending ? '可以继续写，当前操作完成后再保存。' : undefined}
          hasEntries={entries.length > 0}
          onChange={handleChange}
          onSubmit={handleSubmit}
          textareaRef={textareaRef}
        />
        {visibleQueueError && <p className="sync-status sync-status--failed" role="alert">{visibleQueueError}</p>}
        <SyncStatus
          authContextChanged={outbox.authContextChanged}
          items={activeOutbox}
          hasGlobalFailure={outbox.items.some((item) => item.state === 'failed')}
          legacyItemCount={outbox.legacyItemCount}
          ready={outbox.ready}
          syncing={outbox.syncing}
          onRecoverLegacy={outbox.recoverLegacy}
          onRetry={() => void outbox.retry()}
        />
        {(!started || initialThought) && <LocalDrafts
          drafts={otherDrafts}
          disabled={outbox.authContextChanged || directWritePending || aiWritePending || queueingEntry}
          onRestore={(item) => void handleRestoreDraft(item)}
        />}
        {serverReady && entries.length > 0 && (
          <button
            className="checkpoint-action"
            type="button"
            disabled={directWritePending || aiWritePending || entryWritePending || Boolean(content.trim())}
            onClick={(event) => overlay.open('checkpoint', event.currentTarget)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4v16M7 5h10l-2.5 4L17 13H7" /></svg>
            {checkpointPending ? '正在保存检查点' : '先到这里'}
          </button>
        )}
        {serverReady && entries.length > 0 && (
          <ThinkingAssist
            disabled={!canUseAi}
            waitingForInput={!canUseAi}
            running={ai.state.status === 'streaming' && ai.state.action === 'advance'}
            onContinue={() => { inputRevision.current += 1; void ai.run(thoughtId, 'advance') }}
          />
        )}
        {overlay.isOpen('import') && (
          <ImportTextDialog
            open
            currentAllowed={serverReady}
            onClose={() => overlay.close('import')}
            onImport={handleImport}
          />
        )}
        {overlay.isOpen('checkpoint') && <CheckpointDialog open onSave={handleCheckpoint} />}
      </section>
    </ThoughtLayout>
  )
}
