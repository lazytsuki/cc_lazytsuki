'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { ThoughtSummary } from './thought-workspace'
import type { ThoughtCollection } from '@/src/server/repositories/collection-repository'
import { ThoughtListItem } from './thought-list-item'
import { ThoughtSearch } from './thought-search'
import type { ThoughtAction } from './thought-action-menu'
import { useOverlayController } from '@/src/components/overlay-provider'
import { userBoundFetch } from '@/src/lib/auth/user-bound-fetch'
import { useWorkspaceSidebar } from '@/src/components/workspace-sidebar-provider'
import { discardThoughtOutboxItems } from '@/src/lib/capture/capture-store'

type ThoughtNavigationProps = {
  userId: string
  activeThoughtId: string
  activeView?: 'review'
  currentStarted: boolean
  initialCollections: ThoughtCollection[] | null
  initialNextCursor: string | null
  thoughts: ThoughtSummary[]
}

type View = { kind: 'recent' | 'archived' } | { kind: 'collection'; id: string; name: string }

const explicitNewThoughtKey = 'retniw:explicit-new-thought'
const openHistoryAfterCheckpointKey = 'retniw:open-history-after-checkpoint'
const openHistoryAfterCheckpointEvent = 'retniw:open-history-after-checkpoint'

function markExplicitNewThought() {
  try {
    sessionStorage.setItem(explicitNewThoughtKey, '1')
  } catch {
    // Navigation still works when browser storage is unavailable.
  }
}

export function requestHistoryAfterCheckpoint() {
  try {
    if (window.matchMedia('(max-width: 900px)').matches) {
      sessionStorage.setItem(openHistoryAfterCheckpointKey, '1')
      window.setTimeout(() => window.dispatchEvent(new Event(openHistoryAfterCheckpointEvent)), 0)
    }
  } catch {
    // Returning home still works when browser storage is unavailable.
  }
}

export function mergeThoughts(primary: ThoughtSummary[], additional: ThoughtSummary[]) {
  const merged = new Map<string, ThoughtSummary>()
  for (const thought of [...primary, ...additional]) {
    if (!merged.has(thought.id)) merged.set(thought.id, thought)
  }
  return Array.from(merged.values()).sort(
    (left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt),
  )
}

function viewTitle(view: View) {
  if (view.kind === 'collection') return view.name
  if (view.kind === 'archived') return '归档'
  return '以前的想法'
}

function NewThoughtIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 8v8M8 12h8" /></svg>
}

function ThoughtListIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7.5h14M5 12h14M5 16.5h9" /></svg>
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
}

function ArchiveIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v13H4zM3 4h18v4H3zM9 12h6" /></svg>
}

function ReviewIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="8" r="2.5" /><circle cx="18" cy="16" r="2.5" /><path d="M8.4 9.2 15.6 14.8" /></svg>
}

function ChevronIcon() {
  return <svg className="thought-navigation__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
}

export function ThoughtNavigation({
  userId,
  activeThoughtId,
  activeView,
  currentStarted,
  initialCollections,
  initialNextCursor,
  thoughts,
}: ThoughtNavigationProps) {
  const router = useRouter()
  const overlay = useOverlayController()
  const closeOverlay = overlay.close
  const sidebar = useWorkspaceSidebar()
  const expandedArchiveRef = useRef<HTMLButtonElement>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const deleteOpen = overlay.isOpen('delete-confirm')
  const collectionDeleteOpen = overlay.isOpen('collection-delete-confirm')
  const [view, setView] = useState<View>({ kind: 'recent' })
  const [additionalThoughts, setAdditionalThoughts] = useState<ThoughtSummary[]>([])
  const [viewThoughts, setViewThoughts] = useState<ThoughtSummary[]>([])
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [collectionOverrides, setCollectionOverrides] = useState<Map<string, string | null>>(new Map())
  const [collections, setCollections] = useState<ThoughtCollection[]>(initialCollections ?? [])
  const [nextCursor, setNextCursor] = useState(initialNextCursor)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [navigatingThoughtId, setNavigatingThoughtId] = useState<string | null>(null)
  const [navigatingNew, setNavigatingNew] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ThoughtSummary | null>(null)
  const [deletingThought, setDeletingThought] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [pendingCollectionDelete, setPendingCollectionDelete] = useState<ThoughtCollection | null>(null)
  const [deletingCollection, setDeletingCollection] = useState(false)
  const [collectionDeleteError, setCollectionDeleteError] = useState('')
  const [revealedThoughtId, setRevealedThoughtId] = useState<string | null>(null)
  const historyTriggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const deleteDialogRef = useRef<HTMLDialogElement>(null)
  const collectionDeleteDialogRef = useRef<HTMLDialogElement>(null)
  const pendingDeleteFocusRef = useRef<HTMLElement | null>(null)
  const deleteCancelFocusRef = useRef<HTMLElement | null>(null)
  const deleteDialogDismissedRef = useRef(false)
  const pendingCollectionDeleteFocusRef = useRef<HTMLElement | null>(null)
  const collectionDeleteCancelFocusRef = useRef<HTMLElement | null>(null)
  const collectionDeleteDialogDismissedRef = useRef(false)
  const viewRequestEpochRef = useRef(0)
  const recentThoughts = useMemo(
    () => mergeThoughts(thoughts, additionalThoughts).filter((thought) => !removedIds.has(thought.id)),
    [additionalThoughts, removedIds, thoughts],
  )
  const visibleThoughts = (view.kind === 'recent' ? recentThoughts : viewThoughts)
    .filter((thought) => !removedIds.has(thought.id))
    .map((thought) => collectionOverrides.has(thought.id)
      ? { ...thought, collectionId: collectionOverrides.get(thought.id) ?? null }
      : thought)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (historyOpen && !dialog.open) dialog.showModal()
    if (!historyOpen && dialog.open) dialog.close()
  }, [historyOpen])

  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 900px)')
    const openAfterCheckpoint = () => {
      if (mobileQuery.matches) setHistoryOpen(true)
    }
    const closeOnDesktop = () => {
      if (mobileQuery.matches) return
      if (overlay.activeId?.includes(':history:')) closeOverlay()
      historyTriggerRef.current = null
      setHistoryOpen(false)
    }
    window.addEventListener(openHistoryAfterCheckpointEvent, openAfterCheckpoint)
    window.addEventListener('resize', closeOnDesktop)
    mobileQuery.addEventListener('change', closeOnDesktop)
    closeOnDesktop()
    try {
      if (sessionStorage.getItem(openHistoryAfterCheckpointKey) === '1') {
        sessionStorage.removeItem(openHistoryAfterCheckpointKey)
        queueMicrotask(openAfterCheckpoint)
      }
    } catch {
      // The desktop sidebar remains available without browser storage.
    }
    return () => {
      window.removeEventListener(openHistoryAfterCheckpointEvent, openAfterCheckpoint)
      window.removeEventListener('resize', closeOnDesktop)
      mobileQuery.removeEventListener('change', closeOnDesktop)
    }
  }, [closeOverlay, overlay.activeId])

  useEffect(() => {
    const dialog = deleteDialogRef.current
    if (!dialog) return
    if (deleteOpen && !dialog.open) dialog.showModal()
    if (!deleteOpen && dialog.open) dialog.close()
  }, [deleteOpen])

  useEffect(() => {
    const dialog = collectionDeleteDialogRef.current
    if (!dialog) return
    if (collectionDeleteOpen && !dialog.open) dialog.showModal()
    if (!collectionDeleteOpen && dialog.open) dialog.close()
  }, [collectionDeleteOpen])

  useEffect(() => {
    if (!revealedThoughtId) return
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return setRevealedThoughtId(null)
      if (target.closest('.thought-list-item')?.getAttribute('data-thought-id') === revealedThoughtId) return
      setRevealedThoughtId(null)
    }
    const closeFromScroll = () => setRevealedThoughtId(null)
    document.addEventListener('pointerdown', closeFromOutside)
    window.addEventListener('scroll', closeFromScroll, true)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside)
      window.removeEventListener('scroll', closeFromScroll, true)
    }
  }, [revealedThoughtId])

  useEffect(() => {
    if (overlay.activeId) queueMicrotask(() => setRevealedThoughtId(null))
  }, [overlay.activeId])

  useEffect(() => {
    if (initialCollections !== null) return
    void userBoundFetch(userId, '/api/collections')
      .then(async (response) => {
        const payload = await response.json() as { data?: { collections?: ThoughtCollection[] } }
        if (response.ok) setCollections(payload.data?.collections ?? [])
      })
      .catch(() => undefined)
  }, [initialCollections, userId])

  function thoughtFocusTarget(thoughtId: string, trigger?: HTMLElement | null) {
    const activeScope = overlay.activeId?.includes(':history:') ? 'history' : 'sidebar'
    const actionTrigger = trigger?.closest('.thought-list-item')
      ? trigger
      : document.getElementById(`thought-action-trigger:${activeScope}:${thoughtId}`)
    const item = actionTrigger?.closest<HTMLElement>('.thought-list-item')
    const siblings = item?.parentElement
      ? Array.from(item.parentElement.children).filter(
          (element): element is HTMLElement => element instanceof HTMLElement && element.classList.contains('thought-list-item'),
        )
      : []
    const index = item ? siblings.indexOf(item) : -1
    const adjacent = index >= 0
      ? siblings[index + 1] ?? siblings[index - 1]
      : null
    return adjacent?.querySelector<HTMLElement>('.thought-link')
      ?? (thoughtId === activeThoughtId
        ? document.querySelector<HTMLTextAreaElement>('.thought-composer textarea')
        : null)
      ?? (activeScope === 'history'
        ? document.querySelector<HTMLButtonElement>('.thought-history-dialog__close')
        : document.querySelector<HTMLAnchorElement>('.new-thought-action'))
  }

  function collectionFocusTarget(trigger: HTMLElement) {
    const row = trigger.closest<HTMLElement>('.collection-link')
    const rows = row?.parentElement
      ? Array.from(row.parentElement.querySelectorAll<HTMLElement>(':scope > .collection-link'))
      : []
    const index = row ? rows.indexOf(row) : -1
    const adjacent = index >= 0 ? rows[index + 1] ?? rows[index - 1] : null
    return adjacent?.querySelector<HTMLElement>('button')
      ?? document.querySelector<HTMLAnchorElement>('.new-thought-action')
  }

  function focusAfterMutation(target: HTMLElement | null, fallbackToComposer = false) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (target?.isConnected && target.getClientRects().length > 0) {
        target.focus({ preventScroll: true })
        return
      }
      if (fallbackToComposer) {
        document.querySelector<HTMLTextAreaElement>('.thought-composer textarea')?.focus({ preventScroll: true })
      }
    }))
  }

  function openHistory(trigger: HTMLButtonElement) {
    overlay.close()
    historyTriggerRef.current = trigger
    setHistoryOpen(true)
  }

  function closeHistory() {
    if (overlay.activeId?.includes(':history:')) overlay.close()
    setHistoryOpen(false)
    queueMicrotask(() => {
      const trigger = historyTriggerRef.current
      if (trigger?.isConnected && trigger.getClientRects().length > 0) trigger.focus()
    })
  }

  function openNewThought(event: MouseEvent<HTMLAnchorElement>) {
    if (!currentStarted && activeView !== 'review') {
      event.preventDefault()
      overlay.close()
      document.querySelector<HTMLTextAreaElement>('.thought-composer textarea')?.focus()
      return
    }
    markExplicitNewThought()
    setNavigatingNew(true)
  }

  function queryFor(nextView: View, cursor?: string | null) {
    const params = new URLSearchParams()
    if (cursor) params.set('cursor', cursor)
    if (nextView.kind === 'archived') params.set('scope', 'archived')
    if (nextView.kind === 'collection') params.set('collectionId', nextView.id)
    return `/api/thoughts?${params.toString()}`
  }

  async function loadView(nextView: View) {
    const requestEpoch = ++viewRequestEpochRef.current
    setRevealedThoughtId(null)
    setView(nextView)
    setViewThoughts([])
    setNextCursor(null)
    setLoading(true)
    setLoadError('')
    try {
      const response = await userBoundFetch(userId, queryFor(nextView))
      const payload = await response.json() as { data?: { thoughts?: ThoughtSummary[]; nextCursor?: string | null } }
      if (requestEpoch !== viewRequestEpochRef.current) return
      if (!response.ok || !payload.data?.thoughts) throw new Error('LOAD_FAILED')
      setViewThoughts(payload.data.thoughts)
      setNextCursor(payload.data.nextCursor ?? null)
      setRemovedIds(new Set())
    } catch {
      if (requestEpoch !== viewRequestEpochRef.current) return
      setLoadError('没有加载完成，可以重试。')
      setViewThoughts([])
    } finally {
      if (requestEpoch === viewRequestEpochRef.current) setLoading(false)
    }
  }

  async function loadMore() {
    if (!nextCursor || loading) return
    const requestEpoch = ++viewRequestEpochRef.current
    const requestedView = view
    setLoading(true)
    setLoadError('')
    try {
      const response = await userBoundFetch(userId, queryFor(requestedView, nextCursor))
      const payload = await response.json() as { data?: { thoughts?: ThoughtSummary[]; nextCursor?: string | null } }
      if (requestEpoch !== viewRequestEpochRef.current) return
      if (!response.ok || !payload.data?.thoughts) throw new Error('LOAD_FAILED')
      if (requestedView.kind === 'recent') {
        setAdditionalThoughts((current) => mergeThoughts(current, payload.data!.thoughts!))
      } else {
        setViewThoughts((current) => mergeThoughts(current, payload.data!.thoughts!))
      }
      setNextCursor(payload.data.nextCursor ?? null)
    } catch {
      if (requestEpoch !== viewRequestEpochRef.current) return
      setLoadError('没有加载完成，可以重试。')
    } finally {
      if (requestEpoch === viewRequestEpochRef.current) setLoading(false)
    }
  }

  function showRecent() {
    viewRequestEpochRef.current += 1
    setView({ kind: 'recent' })
    setNextCursor(initialNextCursor)
    setRemovedIds(new Set())
    setLoadError('')
    setLoading(false)
  }

  async function performAction(
    thought: ThoughtSummary,
    action: Exclude<ThoughtAction, 'delete'>,
    trigger?: HTMLElement | null,
  ) {
    const focusTarget = thoughtFocusTarget(thought.id, trigger)
    setRevealedThoughtId(null)
    setRemovedIds((current) => new Set(current).add(thought.id))
    focusAfterMutation(focusTarget, thought.id === activeThoughtId)
    setLoadError('')
    try {
      const response = await userBoundFetch(userId, `/api/thoughts/${thought.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!response.ok) throw new Error('ACTION_FAILED')
      router.refresh()
    } catch {
      setRemovedIds((current) => {
        const next = new Set(current)
        next.delete(thought.id)
        return next
      })
      setLoadError('操作结果未确认，可以重试。')
    }
  }

  async function requestAction(
    thought: ThoughtSummary,
    action: ThoughtAction,
    trigger?: HTMLElement | null,
  ) {
    if (action === 'delete') {
      if (deletingThought) {
        setLoadError('正在删除上一个想法，请稍候。')
        return
      }
      setPendingDelete(thought)
      pendingDeleteFocusRef.current = thoughtFocusTarget(thought.id, trigger)
      deleteCancelFocusRef.current = trigger ?? null
      deleteDialogDismissedRef.current = false
      setDeleteError('')
      overlay.open('delete-confirm', trigger)
      return
    }
    await performAction(thought, action, trigger)
  }

  function cancelThoughtDelete() {
    if (deletingThought) {
      deleteDialogDismissedRef.current = true
      overlay.close('delete-confirm')
      focusAfterMutation(pendingDeleteFocusRef.current, pendingDelete?.id === activeThoughtId)
      return
    }
    const focusTarget = deleteCancelFocusRef.current
    setPendingDelete(null)
    setDeleteError('')
    overlay.close('delete-confirm')
    focusAfterMutation(focusTarget)
  }

  async function deleteThought() {
    const thought = pendingDelete
    if (!thought || deletingThought) return
    setDeletingThought(true)
    setDeleteError('')
    setRevealedThoughtId(null)
    setRemovedIds((current) => new Set(current).add(thought.id))
    try {
      const response = await userBoundFetch(userId, `/api/thoughts/${thought.id}`, {
        method: 'DELETE',
      })
      if (response.status !== 204 && response.status !== 404) throw new Error('DELETE_FAILED')
      const localCleanupFailed = await discardThoughtOutboxItems(userId, thought.id)
        .then(() => false)
        .catch(() => true)
      setPendingDelete(null)
      overlay.close('delete-confirm')
      if (thought.id === activeThoughtId) {
        router.push('/')
      } else {
        router.refresh()
        if (!deleteDialogDismissedRef.current) focusAfterMutation(pendingDeleteFocusRef.current)
        if (localCleanupFailed) setLoadError('想法已删除，本机待同步记录未清理。')
      }
    } catch {
      setRemovedIds((current) => {
        const next = new Set(current)
        next.delete(thought.id)
        return next
      })
      if (deleteDialogDismissedRef.current) {
        setPendingDelete(null)
        setLoadError('删除结果未确认，请重试。')
      } else {
        setDeleteError('删除结果未确认，请重试。')
      }
    } finally {
      setDeletingThought(false)
    }
  }

  async function moveThought(thought: ThoughtSummary, collectionId: string | null) {
    const previousCollectionId = thought.collectionId
    const removesFromCurrentView = view.kind === 'collection' && collectionId !== view.id
    const focusTarget = removesFromCurrentView ? thoughtFocusTarget(thought.id) : null
    setCollectionOverrides((current) => new Map(current).set(thought.id, collectionId))
    const patchThought = (item: ThoughtSummary): ThoughtSummary => (
      item.id === thought.id ? { ...item, collectionId } : item
    )
    setAdditionalThoughts((current) => current.map(patchThought))
    setViewThoughts((current) => current.map(patchThought))
    if (removesFromCurrentView) {
      setRemovedIds((current) => new Set(current).add(thought.id))
      focusAfterMutation(focusTarget, thought.id === activeThoughtId)
    }
    try {
      const response = await userBoundFetch(userId, `/api/thoughts/${thought.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'move', collectionId }),
      })
      if (!response.ok) throw new Error('MOVE_FAILED')
      router.refresh()
    } catch (error) {
      setCollectionOverrides((current) => new Map(current).set(thought.id, previousCollectionId))
      const rollbackThought = (item: ThoughtSummary): ThoughtSummary => (
        item.id === thought.id ? { ...item, collectionId: previousCollectionId } : item
      )
      setAdditionalThoughts((current) => current.map(rollbackThought))
      setViewThoughts((current) => current.map(rollbackThought))
      if (view.kind === 'collection' && previousCollectionId === view.id) {
        setRemovedIds((current) => {
          const next = new Set(current)
          next.delete(thought.id)
          return next
        })
      }
      throw error
    }
  }

  function requestCollectionDelete(collection: ThoughtCollection, trigger: HTMLButtonElement) {
    if (deletingCollection) {
      setLoadError('正在删除上一个合集，请稍候。')
      return
    }
    setPendingCollectionDelete(collection)
    pendingCollectionDeleteFocusRef.current = collectionFocusTarget(trigger)
    collectionDeleteCancelFocusRef.current = trigger
    collectionDeleteDialogDismissedRef.current = false
    setCollectionDeleteError('')
    overlay.open('collection-delete-confirm', trigger)
  }

  function cancelCollectionDelete() {
    if (deletingCollection) {
      collectionDeleteDialogDismissedRef.current = true
      overlay.close('collection-delete-confirm')
      focusAfterMutation(collectionDeleteCancelFocusRef.current)
      return
    }
    const focusTarget = collectionDeleteCancelFocusRef.current
    setPendingCollectionDelete(null)
    setCollectionDeleteError('')
    overlay.close('collection-delete-confirm')
    focusAfterMutation(focusTarget)
  }

  async function deleteCollection() {
    const collection = pendingCollectionDelete
    if (!collection || deletingCollection) return
    setDeletingCollection(true)
    setCollectionDeleteError('')
    try {
      const response = await userBoundFetch(userId, `/api/collections/${collection.id}`, {
        method: 'DELETE',
      })
      if (!response.ok && response.status !== 404) throw new Error('DELETE_COLLECTION_FAILED')
      setCollections((current) => current.filter((item) => item.id !== collection.id))
      setCollectionOverrides((current) => {
        const next = new Map(current)
        for (const thought of [...recentThoughts, ...viewThoughts]) {
          const currentCollection = next.has(thought.id)
            ? next.get(thought.id)
            : thought.collectionId
          if (currentCollection === collection.id) next.set(thought.id, null)
        }
        return next
      })
      setPendingCollectionDelete(null)
      overlay.close('collection-delete-confirm')
      focusAfterMutation(pendingCollectionDeleteFocusRef.current)
      router.refresh()
    } catch {
      if (collectionDeleteDialogDismissedRef.current) {
        setPendingCollectionDelete(null)
        setLoadError('删除合集的结果未确认，请重试。')
      } else {
        setCollectionDeleteError('删除合集的结果未确认，请重试。')
      }
    } finally {
      setDeletingCollection(false)
    }
  }

  async function createCollection(name: string) {
    const response = await userBoundFetch(userId, '/api/collections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: crypto.randomUUID(), name }),
    })
    const payload = await response.json() as { data?: { collection?: ThoughtCollection } }
    if (!response.ok || !payload.data?.collection) throw new Error('CREATE_FAILED')
    setCollections((current) => [...current, payload.data!.collection!])
    return payload.data.collection
  }

  function openArchive(compact: boolean) {
    if (compact) {
      sidebar.expand()
      window.requestAnimationFrame(() => expandedArchiveRef.current?.focus())
    }
    void loadView({ kind: 'archived' })
  }

  function secondaryNavigation(menuScope: 'sidebar' | 'history', compact = false) {
    return (
      <div className={`thought-navigation__secondary thought-navigation__footer${compact ? ' thought-navigation__footer--compact' : ''}`}>
        <button
          ref={menuScope === 'sidebar' && !compact ? expandedArchiveRef : undefined}
          type="button"
          aria-current={view.kind === 'archived' ? 'page' : undefined}
          aria-label="归档"
          data-sidebar-tooltip={compact ? '归档' : undefined}
          onClick={() => openArchive(compact)}
        >
          <ArchiveIcon />
          <span>归档</span>
          <ChevronIcon />
        </button>
        <Link
          aria-current={activeView === 'review' ? 'page' : undefined}
          aria-label="回看"
          data-sidebar-tooltip={compact ? '回看' : undefined}
          href="/review"
          onClick={() => menuScope === 'history' && closeHistory()}
        >
          <ReviewIcon />
          <span>回看</span>
          <ChevronIcon />
        </Link>
      </div>
    )
  }

  function navigationContent(menuScope: 'sidebar' | 'history') {
    const list = loading && visibleThoughts.length === 0
      ? <p className="thought-list-loading" role="status">正在加载</p>
      : visibleThoughts.length === 0 && !loadError
        ? <p className="thought-list-empty">
            {view.kind === 'archived' ? '还没有归档的想法。' : '这里还没有想法。'}
          </p>
      : <div className="thought-list">
          {visibleThoughts.map((thought) => (
            <ThoughtListItem
              active={thought.id === activeThoughtId}
              collections={collections}
              key={thought.id}
              menuScope={menuScope}
              mode={view.kind === 'archived' ? 'archived' : 'active'}
              navigating={thought.id === navigatingThoughtId}
              revealed={revealedThoughtId === thought.id}
              thought={thought}
              onAction={requestAction}
              onChoose={() => menuScope === 'history' && closeHistory()}
              onConceal={() => setRevealedThoughtId(null)}
              onCreateCollection={createCollection}
              onMove={moveThought}
              onNavigate={setNavigatingThoughtId}
              onReveal={() => setRevealedThoughtId(thought.id)}
            />
          ))}
        </div>

    return <div className="thought-navigation__content">
      {menuScope === 'sidebar' && <div className="thought-navigation__heading">
        {view.kind !== 'recent' && <button type="button" aria-label="返回以前的想法" onClick={showRecent}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg>
        </button>}
        <h2>{viewTitle(view)}</h2>
      </div>}
      <ThoughtSearch
        key={`${menuScope}:${userId}:${view.kind === 'collection' ? view.id : view.kind}`}
        userId={userId}
        onChoose={() => { if (menuScope === 'history') closeHistory() }}
      >
        <div className="thought-navigation__scroll">
          {list}
          {loadError && <p className="thought-list-error" role="status">{loadError}</p>}
          {nextCursor && <button className="load-more-thoughts" type="button" disabled={loading} onClick={() => void loadMore()}>{loading ? '正在加载' : '加载更多'}</button>}
          {view.kind === 'recent' && collections.length > 0 && <div className="thought-navigation__sections">
            <section>
              <h3>合集</h3>
              {collections.map((collection) => (
                <div className="collection-link" key={collection.id}>
                  <button type="button" onClick={() => void loadView({ kind: 'collection', id: collection.id, name: collection.name })}>{collection.name}</button>
                  <button
                    className="collection-delete-action"
                    type="button"
                    aria-label={`删除合集 ${collection.name}`}
                    onClick={(event) => requestCollectionDelete(collection, event.currentTarget)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
                  </button>
                </div>
              ))}
            </section>
          </div>}
        </div>
      </ThoughtSearch>
      {secondaryNavigation(menuScope)}
    </div>
  }

  return (
    <>
      <aside className="thought-sidebar" id="thought-sidebar" aria-label="想法导航" data-collapsed={sidebar.collapsed || undefined}>
        <Link
          aria-current={!currentStarted ? 'page' : undefined}
          aria-busy={navigatingNew || undefined}
          aria-label="写新想法"
          className="new-thought-action"
          data-sidebar-tooltip={sidebar.collapsed ? '写新想法' : undefined}
          href="/"
          onClick={openNewThought}
        >
          <NewThoughtIcon />
          <span><strong>{navigatingNew ? '正在打开' : '写新想法'}</strong></span>
        </Link>
        {sidebar.collapsed
          ? <section className="all-thoughts all-thoughts--collapsed">{secondaryNavigation('sidebar', true)}</section>
          : <section className="all-thoughts">{navigationContent('sidebar')}</section>}
      </aside>

      <nav className="mobile-workspace-toolbar" aria-label="想法导航">
        <button
          ref={historyTriggerRef}
          className="mobile-history-action"
          type="button"
          aria-controls="thought-history-dialog"
          aria-expanded={historyOpen}
          aria-haspopup="dialog"
          onClick={(event) => historyOpen ? closeHistory() : openHistory(event.currentTarget)}
        >
          <ThoughtListIcon />
          <span>以前的想法</span>
        </button>
        {(currentStarted || activeView === 'review') && <Link
          aria-busy={navigatingNew || undefined}
          aria-label={navigatingNew ? '正在打开新想法' : '写新想法'}
          className="mobile-new-thought-action"
          href="/"
          onClick={openNewThought}
        >
          <NewThoughtIcon />
          <span>{navigatingNew ? '正在打开' : '写新想法'}</span>
        </Link>}
      </nav>

      <dialog
        id="thought-history-dialog"
        className="thought-history-dialog"
        ref={dialogRef}
        aria-labelledby="thought-history-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeHistory()
        }}
        onCancel={(event) => { event.preventDefault(); closeHistory() }}
        onClose={() => historyOpen && closeHistory()}
      >
        <div className="thought-history-dialog__header">
          {view.kind !== 'recent' && <button className="thought-history-dialog__back" type="button" aria-label="返回以前的想法" onClick={showRecent}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg>
          </button>}
          <h2 id="thought-history-title">{viewTitle(view)}</h2>
          <button className="thought-history-dialog__close" type="button" aria-label="关闭以前的想法" onClick={closeHistory}>
            <CloseIcon />
          </button>
        </div>
        <div className="thought-history-dialog__body">{navigationContent('history')}</div>
        <div id="thought-history-layer-root" />
      </dialog>

      <dialog
        className="confirm-dialog"
        ref={deleteDialogRef}
        aria-labelledby="delete-thought-dialog-title"
        aria-describedby="delete-thought-dialog-description"
        onClick={(event) => {
          if (event.target === event.currentTarget) cancelThoughtDelete()
        }}
        onCancel={(event) => {
          event.preventDefault()
          cancelThoughtDelete()
        }}
        onClose={() => deleteOpen && cancelThoughtDelete()}
      >
        <h2 id="delete-thought-dialog-title">删除这个想法？</h2>
        <p id="delete-thought-dialog-description">删除后无法恢复，相关联系也会一并删除。</p>
        {deleteError && <p className="confirm-dialog__error" role="alert">{deleteError}</p>}
        <div>
          <button type="button" onClick={cancelThoughtDelete}>{deletingThought ? '关闭' : '取消'}</button>
          <button className="danger" type="button" disabled={deletingThought} onClick={() => void deleteThought()}>
            {deletingThought ? '正在删除' : '删除'}
          </button>
        </div>
      </dialog>

      <dialog
        className="confirm-dialog"
        ref={collectionDeleteDialogRef}
        aria-labelledby="delete-collection-dialog-title"
        aria-describedby="delete-collection-dialog-description"
        onClick={(event) => {
          if (event.target === event.currentTarget) cancelCollectionDelete()
        }}
        onCancel={(event) => {
          event.preventDefault()
          cancelCollectionDelete()
        }}
        onClose={() => collectionDeleteOpen && cancelCollectionDelete()}
      >
        <h2 id="delete-collection-dialog-title">删除这个合集？</h2>
        <p id="delete-collection-dialog-description">只删除合集，不会删除里面的想法。</p>
        {collectionDeleteError && <p className="confirm-dialog__error" role="alert">{collectionDeleteError}</p>}
        <div>
          <button type="button" onClick={cancelCollectionDelete}>{deletingCollection ? '关闭' : '取消'}</button>
          <button className="danger" type="button" disabled={deletingCollection} onClick={() => void deleteCollection()}>
            {deletingCollection ? '正在删除' : '删除合集'}
          </button>
        </div>
      </dialog>
    </>
  )
}
