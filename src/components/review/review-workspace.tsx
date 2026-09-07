'use client'

import Link from 'next/link'
import { useCallback, useRef, useState } from 'react'
import styles from './review-workspace.module.css'
import {
  createProductEventRequestId,
  recordConnectionOpened,
  useVisibleProductEvent,
} from '@/src/components/product-event-sender'
import type { ReviewPreference } from '@/src/server/repositories/review-preference-repository'
import type { ReviewConnection } from '@/src/server/repositories/thought-connection-repository'
import { userBoundFetch } from '@/src/lib/auth/user-bound-fetch'

type ReviewResponse = {
  data?: {
    preference?: ReviewPreference
    connections?: ReviewConnection[]
    pendingCount?: number
    nextCursor?: string | null
  }
}

type ReviewScanResponse = {
  data?: {
    status?: 'disabled' | 'not-enough-content' | 'processed' | 'provider-failed' | 'persistence-failed'
    created?: number
  }
}

type ListState = {
  items: ReviewConnection[]
  nextCursor: string | null
}

type ReviewInitialData = {
  preference: ReviewPreference
  pending: ListState
  pendingCount: number
  confirmed: ListState
}

const emptyList: ListState = { items: [], nextCursor: null }

function mergeConnections(current: ReviewConnection[], additional: ReviewConnection[]) {
  const merged = new Map(current.map((item) => [item.id, item]))
  for (const item of additional) merged.set(item.id, item)
  return Array.from(merged.values()).sort((left, right) => (
    right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
  ))
}

async function readList(userId: string, status: 'pending' | 'confirmed', cursor?: string | null) {
  const params = new URLSearchParams({ status })
  if (cursor) params.set('cursor', cursor)
  const response = await userBoundFetch(userId, `/api/review?${params.toString()}`)
  const payload = await response.json().catch(() => null) as ReviewResponse | null
  if (!response.ok || !payload?.data?.preference || !payload.data.connections) {
    throw new Error('LOAD_FAILED')
  }
  return payload.data
}

function ConnectionMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="8" r="2.5" />
      <circle cx="18" cy="16" r="2.5" />
      <path d="M8.4 9.2 15.6 14.8" />
    </svg>
  )
}

function ArrowMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 16 16 8M10 8h6v6" />
    </svg>
  )
}

function ConnectionCard({
  connection,
  disabled,
  deciding,
  onDecide,
}: {
  connection: ReviewConnection
  disabled?: boolean
  deciding: boolean
  onDecide?: (decision: 'confirmed' | 'rejected') => void
}) {
  return (
    <article
      className={styles.card}
      data-connection-id={connection.id}
    >
      <div className={styles.pair}>
        <div>
          <span>后来写的</span>
          <p>{connection.source.excerpt}</p>
          <Link
            aria-label="打开后来写的原文"
            href={`/thoughts/${connection.source.thoughtId}#entry-${connection.source.entryId}`}
            onClick={() => recordConnectionOpened(connection.id, connection.source.thoughtId)}
          >
            读完整想法<ArrowMark />
          </Link>
        </div>
        <div>
          <span>更早写的</span>
          <p>{connection.target.excerpt}</p>
          <Link
            aria-label="打开更早写的原文"
            href={`/thoughts/${connection.target.thoughtId}#entry-${connection.target.entryId}`}
            onClick={() => recordConnectionOpened(connection.id, connection.target.thoughtId)}
          >
            读完整想法<ArrowMark />
          </Link>
        </div>
      </div>
      <div className={styles.reason}>
        <span><ConnectionMark />{connection.status === 'confirmed' ? '联系说明 · AI提出' : '可能的联系 · AI提出'}</span>
        <p>{connection.rationale}</p>
      </div>
      {onDecide ? (
        <div className={styles.actions}>
          <button data-decision="confirmed" type="button" disabled={disabled} onClick={() => onDecide('confirmed')}>
            {deciding ? '正在保存' : '保留联系'}
          </button>
          <button data-decision="rejected" type="button" disabled={disabled} onClick={() => onDecide('rejected')}>忽略</button>
        </div>
      ) : null}
    </article>
  )
}

export function ReviewWorkspace({ initialData, userId }: { initialData: ReviewInitialData | null; userId: string }) {
  useVisibleProductEvent('review_opened')
  const [preference, setPreference] = useState<ReviewPreference | null>(initialData?.preference ?? null)
  const [pending, setPending] = useState<ListState>(initialData?.pending ?? emptyList)
  const [confirmed, setConfirmed] = useState<ListState>(initialData?.confirmed ?? emptyList)
  const [pendingCount, setPendingCount] = useState(initialData?.pendingCount ?? 0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState<'pending' | 'confirmed' | null>(null)
  const [preferencePending, setPreferencePending] = useState(false)
  const [preferenceAction, setPreferenceAction] = useState<'enabling' | 'disabling' | null>(null)
  const [scanning, setScanning] = useState(false)
  const [decidingId, setDecidingId] = useState<string | null>(null)
  const [message, setMessage] = useState(initialData ? '' : '没有加载完成，可以重试。')
  const [notice, setNotice] = useState('')
  const [needsMoreThoughts, setNeedsMoreThoughts] = useState(false)
  const preferencePendingRef = useRef(false)
  const scanningRef = useRef(false)
  const decidingRef = useRef(false)
  const loadingMoreRef = useRef(false)
  const scanRequestIdRef = useRef<string | null>(null)
  const primaryActionRef = useRef<HTMLButtonElement>(null)
  const pendingListRef = useRef<HTMLDivElement>(null)
  const pendingHeadingRef = useRef<HTMLHeadingElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMessage('')
    try {
      const [pendingData, confirmedData] = await Promise.all([
        readList(userId, 'pending'),
        readList(userId, 'confirmed'),
      ])
      setPreference(pendingData.preference!)
      setPending({
        items: pendingData.connections!,
        nextCursor: pendingData.nextCursor ?? null,
      })
      setPendingCount(pendingData.pendingCount ?? pendingData.connections!.length)
      setConfirmed({
        items: confirmedData.connections!,
        nextCursor: confirmedData.nextCursor ?? null,
      })
    } catch {
      setMessage('没有加载完成，可以重试。')
    } finally {
      setLoading(false)
    }
  }, [userId])

  async function setEnabled(enabled: boolean, scanAfter = false) {
    if (!preference || preferencePendingRef.current || scanningRef.current || decidingRef.current || loadingMoreRef.current) return
    let saved = false
    preferencePendingRef.current = true
    setPreferencePending(true)
    setPreferenceAction(enabled ? 'enabling' : 'disabling')
    setMessage('')
    setNotice('')
    setNeedsMoreThoughts(false)
    try {
      const response = await userBoundFetch(userId, '/api/review/preference', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const payload = await response.json().catch(() => null) as ReviewResponse | null
      if (!response.ok || !payload?.data?.preference) throw new Error('UPDATE_FAILED')
      setPreference(payload.data.preference)
      saved = true
    } catch {
      setMessage('没有保存，可以重试。')
    } finally {
      preferencePendingRef.current = false
      setPreferencePending(false)
      setPreferenceAction(null)
    }
    if (saved && !enabled) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => primaryActionRef.current?.focus()))
    }
    if (saved && enabled && scanAfter) await scanExistingThoughts()
  }

  async function scanExistingThoughts() {
    if (preferencePendingRef.current || scanningRef.current || decidingRef.current || loadingMoreRef.current) return
    scanningRef.current = true
    setScanning(true)
    setMessage('')
    setNotice('')
    setNeedsMoreThoughts(false)
    try {
      if (!scanRequestIdRef.current) {
        scanRequestIdRef.current = createProductEventRequestId()
      }
      const response = await userBoundFetch(userId, '/api/review/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: scanRequestIdRef.current }),
      })
      const payload = await response.json().catch(() => null) as ReviewScanResponse | null
      if (!response.ok || !payload?.data?.status) throw new Error('SCAN_FAILED')
      scanRequestIdRef.current = null
      if (payload.data.status === 'disabled') {
        setMessage('先开启自动串联，再开始串联。')
        return
      }
      if (payload.data.status === 'provider-failed') {
        setMessage('DeepSeek这次没有完成比较。可以再串联一次，你写下的内容不受影响。')
        return
      }
      if (payload.data.status === 'not-enough-content') {
        setNeedsMoreThoughts(true)
        setNotice('至少需要两条不同的想法。写下另一个念头后，再回来串联。')
        return
      }
      const created = payload.data.created ?? 0
      await load()
      if (payload.data.status === 'persistence-failed') {
        setMessage(created > 0
          ? `只保存了${created}条联系，其余没有保存，可以重试。`
          : '这次找到的联系没有保存，可以重试。')
        return
      }
      setNotice(created > 0
        ? `找到了${created}条联系，等你判断。`
        : '这次没有找到新的明确联系。')
    } catch {
      setMessage('这次没有完成，可以重试。')
    } finally {
      scanningRef.current = false
      setScanning(false)
    }
  }

  async function decide(connection: ReviewConnection, decision: 'confirmed' | 'rejected') {
    if (preferencePendingRef.current || scanningRef.current || decidingRef.current || loadingMoreRef.current) return
    const previousPending = pending
    const previousPendingCount = pendingCount
    const currentIndex = pending.items.findIndex((item) => item.id === connection.id)
    const nextFocusId = pending.items[currentIndex + 1]?.id ?? pending.items[currentIndex - 1]?.id
    decidingRef.current = true
    setDecidingId(connection.id)
    setMessage('')
    setPending((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== connection.id),
    }))
    setPendingCount((current) => Math.max(0, current - 1))
    window.requestAnimationFrame(() => {
      const nextCard = nextFocusId
        ? pendingListRef.current?.querySelector<HTMLElement>(`[data-connection-id="${nextFocusId}"]`)
        : null
      const nextAction = nextCard?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      if (nextAction) nextAction.focus()
      else if (pendingHeadingRef.current) pendingHeadingRef.current.focus()
      else primaryActionRef.current?.focus()
    })
    let saved = false
    try {
      const response = await userBoundFetch(userId, `/api/thought-connections/${connection.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      if (!response.ok) throw new Error('DECIDE_FAILED')
      saved = true
    } catch {
      setPending(previousPending)
      setPendingCount(previousPendingCount)
      setMessage('没有保存，可以重试。')
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        pendingListRef.current
          ?.querySelector<HTMLButtonElement>(
            `[data-connection-id="${connection.id}"] button[data-decision="${decision}"]`,
          )
          ?.focus({ preventScroll: true })
      }))
    }

    if (saved && decision === 'confirmed') {
      try {
        const data = await readList(userId, 'confirmed')
        setConfirmed({ items: data.connections!, nextCursor: data.nextCursor ?? null })
      } catch {
        setMessage('联系已保留，但列表没有刷新；刷新页面即可看到。')
      }
    }
    decidingRef.current = false
    setDecidingId(null)
    if (saved) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const nextCard = nextFocusId
          ? pendingListRef.current?.querySelector<HTMLElement>(`[data-connection-id="${nextFocusId}"]`)
          : null
        const nextAction = nextCard?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        if (nextAction) nextAction.focus({ preventScroll: true })
        else if (pendingHeadingRef.current) pendingHeadingRef.current.focus({ preventScroll: true })
        else primaryActionRef.current?.focus({ preventScroll: true })
      }))
    }
  }

  async function loadMore(status: 'pending' | 'confirmed') {
    const state = status === 'pending' ? pending : confirmed
    if (!state.nextCursor || preferencePendingRef.current || scanningRef.current || decidingRef.current || loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(status)
    setMessage('')
    try {
      const data = await readList(userId, status, state.nextCursor)
      const update = (current: ListState): ListState => ({
        items: mergeConnections(current.items, data.connections!),
        nextCursor: data.nextCursor ?? null,
      })
      if (status === 'pending') setPending(update)
      else setConfirmed(update)
    } catch {
      setMessage('没有加载完成，可以重试。')
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(null)
    }
  }

  if (loading && !preference) {
    return <section className={styles.workspace} aria-busy="true"><p className={styles.status}>正在打开回看</p></section>
  }

  if (!preference) {
    return (
      <section className={styles.workspace}>
        <p className={styles.status} role="alert">{message}</p>
        <button className={styles.retry} type="button" onClick={() => void load()}>重试</button>
      </section>
    )
  }

  const hasReviewContent = pending.items.length > 0 || pendingCount > 0 || confirmed.items.length > 0

  return (
    <section className={styles.workspace} aria-labelledby="review-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>以前的想法</p>
          <h1 id="review-title">回看</h1>
          <p className={styles.tagline}>把分散的念头放在一起，找到值得继续想的地方。</p>
        </div>
        {preference.enabled ? (
          <button type="button" disabled={preferencePending || scanning || loadingMore !== null || decidingId !== null} onClick={() => void setEnabled(false)}>
            {preferenceAction === 'disabling' ? '正在暂停' : '暂停自动串联'}
          </button>
        ) : null}
      </header>

      <div className={styles.intro} aria-busy={scanning || undefined}>
        <h2><ConnectionMark />{preference.enabled ? '自动串联已开启' : '串联已有想法'}</h2>
        <p id="review-intro-description">
          {preference.enabled
            ? '手动串联时，DeepSeek会比较最多20条最近想法的开头和最新一段原文，提出最多3条有依据的联系。'
            : '默认关闭。开启后，DeepSeek会先比较最多20条最近想法的开头和最新一段原文，提出最多3条有依据的联系。'}
        </p>
        <p id="review-automatic-description">以后保存新内容时，也会把新写的一段与最多20条历史想法的开头交给DeepSeek比较。只处理你写下或导入的原文，不改写，也不自动保留。</p>
        <button
          ref={primaryActionRef}
          type="button"
          aria-describedby="review-intro-description review-automatic-description"
          disabled={preferencePending || scanning || loadingMore !== null || decidingId !== null}
          onClick={() => preference.enabled
            ? void scanExistingThoughts()
            : void setEnabled(true, true)}
        >
          {preferencePending
            ? preferenceAction === 'disabling' ? '正在暂停' : '正在开启'
            : scanning
              ? '正在串联'
              : preference.enabled
                ? '再串联一次'
                : '开启并开始串联'}
        </button>
        {scanning ? <p className={styles.scanStatus} role="status">正在比较原文，寻找有依据的联系。你可以先回到想法继续写。</p> : null}
      </div>

      {message ? <p className={styles.error} role="alert">{message}</p> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {needsMoreThoughts ? <Link className={styles.nextStep} href="/">写一个新想法<ArrowMark /></Link> : null}

      {(preference.enabled || hasReviewContent) ? <section className={styles.listSection} aria-labelledby="pending-title">
        <div className={styles.sectionHeading}>
          <h2 id="pending-title" ref={pendingHeadingRef} tabIndex={-1}>等你判断</h2>
          {pendingCount ? <span>{pendingCount}</span> : null}
        </div>
        {pending.items.length ? <p className={styles.sectionDescription}>先读两段原文，再决定是否保留联系。原文始终可以打开，接着写。</p> : null}
        {pending.items.length ? (
          <div className={styles.list} ref={pendingListRef}>
            {pending.items.map((connection) => (
              <ConnectionCard
                connection={connection}
                disabled={preferencePending || scanning || loadingMore !== null || decidingId !== null}
                deciding={decidingId === connection.id}
                key={connection.id}
                onDecide={(decision) => void decide(connection, decision)}
              />
            ))}
          </div>
        ) : (
          <p className={styles.empty}>{scanning
            ? '找到的联系会出现在这里，等你判断。'
            : needsMoreThoughts
              ? '有了两条不同的想法，才有可以比较的内容。'
              : preference.enabled
                ? '暂时没有待判断的联系。可以继续写，或再串联一次已有想法。'
                : '自动串联已暂停。重新开启后，可以继续寻找联系。'}</p>
        )}
        {pending.nextCursor ? (
          <button className={styles.more} type="button" disabled={preferencePending || scanning || loadingMore !== null || decidingId !== null} onClick={() => void loadMore('pending')}>
            {loadingMore === 'pending' ? '正在加载' : '查看更多'}
          </button>
        ) : null}
      </section> : null}

      {(preference.enabled || hasReviewContent) ? <section className={styles.listSection} aria-labelledby="confirmed-title">
        <h2 id="confirmed-title">已保留</h2>
        {confirmed.items.length ? (
          <div className={styles.list}>
            {confirmed.items.map((connection) => (
              <ConnectionCard connection={connection} deciding={false} key={connection.id} />
            ))}
          </div>
        ) : (
          <p className={styles.empty}>保留的联系会留在这里，两段原文仍各自保存。</p>
        )}
        {confirmed.nextCursor ? (
          <button className={styles.more} type="button" disabled={preferencePending || scanning || loadingMore !== null || decidingId !== null} onClick={() => void loadMore('confirmed')}>
            {loadingMore === 'confirmed' ? '正在加载' : '查看更多'}
          </button>
        ) : null}
      </section> : null}
    </section>
  )
}
