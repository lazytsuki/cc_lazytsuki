'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { authContextChangedEvent, expectedUserIdQuery } from '@/src/lib/auth/user-bound-fetch'
import { isThoughtOutboxDiscarded, listThoughtOutboxItems, type ThoughtOutboxItem } from '@/src/lib/capture/capture-store'
import { appendLocalThoughtMarkdown, createCurrentThoughtMarkdown, createLocalContentJson, localExportItems } from '@/src/lib/capture/local-export'
import { downloadTextFile, readCloudThoughtMarkdown, verifyExportOwner, verifyLocalPageOwner } from '@/src/lib/capture/export-download'
import type { Entry } from '@/src/server/repositories/entry-repository'
import type { ThoughtCheckpoint } from '@/src/server/repositories/checkpoint-repository'

export type WorkspaceExportProps = {
  entries: Entry[]
  checkpoints: ThoughtCheckpoint[]
  localItems: ThoughtOutboxItem[]
  currentDraft: ThoughtOutboxItem
  authContextChanged: boolean
  cloudThoughtReady: boolean
  localWritePending: boolean
}

function subscribeToConnectionChange(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

export function ExportMenu({ thoughtId, userId, entries, checkpoints, localItems, currentDraft, authContextChanged, cloudThoughtReady, localWritePending }: {
  thoughtId: string | null
  userId: string
} & WorkspaceExportProps) {
  const [status, setStatus] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [authBlocked, setAuthBlocked] = useState(false)
  const preparingRef = useRef(false)
  const accountChangedRef = useRef(false)
  const online = useSyncExternalStore(subscribeToConnectionChange, () => navigator.onLine, () => true)
  const currentLocalItems = localExportItems(userId, localItems, currentDraft)
  const hasLocalContent = currentLocalItems.length > 0
  const canExportCurrent = thoughtId && (entries.length > 0 || currentLocalItems.some((item) => item.thoughtId === thoughtId))

  useEffect(() => {
    const stopExport = () => { accountChangedRef.current = true }
    window.addEventListener(authContextChangedEvent, stopExport)
    return () => window.removeEventListener(authContextChangedEvent, stopExport)
  }, [])

  async function download(kind: 'current' | 'cloud' | 'local') {
    if (preparingRef.current || localWritePending || authBlocked || authContextChanged || accountChangedRef.current) return
    preparingRef.current = true
    setPreparing(true)
    setStatus('正在准备下载')
    const exportedAt = new Date().toISOString()
    try {
      const connection = await verifyExportOwner(userId, kind !== 'cloud')
      const cloudMarkdown = kind === 'current' && thoughtId && cloudThoughtReady && connection === 'online'
        ? await readCloudThoughtMarkdown(userId, thoughtId)
        : null
      const offline = connection === 'offline' || (kind === 'current' && cloudThoughtReady && cloudMarkdown === null)
      // Cloud export works even when browser storage is unavailable.
      const stored = kind === 'cloud' ? localItems : (await listThoughtOutboxItems()).filter((item) =>
        item.userId === userId && !isThoughtOutboxDiscarded(userId, item.thoughtId),
      )
      // Keep the click-time items too: syncing may remove them while cloud export is being read.
      const snapshot = localExportItems(userId, [...localItems, ...stored], currentDraft)
      if (accountChangedRef.current) throw new Error('AUTH_CONTEXT_CHANGED')
      if (kind !== 'cloud') verifyLocalPageOwner(userId)
      const date = new Date().toISOString().slice(0, 10)
      if (kind === 'current' && thoughtId) {
        const markdown = cloudMarkdown !== null
          ? appendLocalThoughtMarkdown(cloudMarkdown, userId, thoughtId, snapshot, exportedAt)
          : createCurrentThoughtMarkdown({ userId, thoughtId, entries, checkpoints, localItems: snapshot, offline, exportedAt })
        downloadTextFile(markdown, `retniw-${thoughtId}${offline ? '-offline-snapshot' : ''}.md`, 'text/markdown; charset=utf-8')
        setStatus(offline
          ? '未取得云端完整内容，已下载当前页面与本机内容的离线快照。'
          : cloudThoughtReady ? '下载已开始，已包含这个想法的云端原文与本机内容。' : '本机内容快照下载已开始。')
      } else if (kind === 'local') {
        downloadTextFile(createLocalContentJson(userId, snapshot, undefined, exportedAt, offline), `retniw-local-${date}.json`, 'application/json; charset=utf-8')
        setStatus(offline ? '本机内容的离线快照下载已开始。' : '本机内容下载已开始。')
      } else {
        const downloadUrl = new URL('/api/export', window.location.href)
        downloadUrl.searchParams.set(expectedUserIdQuery, userId)
        const frame = document.createElement('iframe')
        frame.hidden = true
        frame.src = downloadUrl.toString()
        document.body.append(frame)
        window.setTimeout(() => frame.remove(), 60_000)
        setStatus(snapshot.length > 0
          ? '云端下载已开始。本机内容请另点“下载本机内容”。'
          : '云端下载已开始。')
      }

    } catch (error) {
      if (error instanceof Error && ['AUTH_CONTEXT_CHANGED', 'EXPORT_AUTH_REQUIRED'].includes(error.message)) {
        accountChangedRef.current = true
        setAuthBlocked(true)
      }
      setStatus(error instanceof Error && error.message === 'AUTH_CONTEXT_CHANGED'
        ? '账号已切换，没有导出，请刷新后继续。'
        : error instanceof Error && error.message === 'EXPORT_AUTH_REQUIRED'
          ? '登录已失效，没有导出，请重新登录。'
          : '没有导出，请检查网络后重试。')
    } finally {
      preparingRef.current = false
      setPreparing(false)
    }
  }

  return (
    <div className="export-menu">
      {canExportCurrent && (
        <button
          type="button"
          aria-label={cloudThoughtReady && online ? '导出当前想法为 Markdown' : '导出当前页面快照为 Markdown'}
          role="menuitem"
          disabled={preparing || localWritePending || authBlocked || authContextChanged}
          onClick={() => void download('current')}
        >
          {cloudThoughtReady && online ? '导出这个想法（完整）' : '导出当前页面快照'}
        </button>
      )}
      <button type="button" aria-label="导出云端全部想法为 JSON" role="menuitem" disabled={preparing || localWritePending || authBlocked || authContextChanged} onClick={() => void download('cloud')}>导出云端全部想法</button>
      {hasLocalContent && <>
        <button type="button" aria-label="下载本机草稿和未同步内容为 JSON" role="menuitem" disabled={preparing || localWritePending || authBlocked || authContextChanged} onClick={() => void download('local')}>下载本机内容</button>
        <span>云端导出不含本机草稿和未同步内容。导出这个想法会一并带上。</span>
      </>}
      {!online && <span>当前离线，快照只含页面已加载的原文与本机内容。</span>}
      {status && <span role="status">{status}</span>}
    </div>
  )
}
