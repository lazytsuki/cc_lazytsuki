import { authContextChangedEvent, currentPageUserId, userBoundFetch } from '@/src/lib/auth/user-bound-fetch'

function accountChanged(): never {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(authContextChangedEvent))
  throw new Error('AUTH_CONTEXT_CHANGED')
}

export function verifyLocalPageOwner(userId: string) {
  if (currentPageUserId() !== userId) accountChanged()
}

function requireExportResponse(response: Response) {
  if (response.status === 409) accountChanged()
  if (response.status === 401 || response.status === 403) throw new Error('EXPORT_AUTH_REQUIRED')
  if (!response.ok) throw new Error('EXPORT_FAILED')
}

export async function verifyExportOwner(userId: string, allowOffline = false) {
  if (allowOffline) verifyLocalPageOwner(userId)
  if (allowOffline && typeof navigator !== 'undefined' && !navigator.onLine) return 'offline' as const
  let response: Response
  try {
    response = await userBoundFetch(userId, '/api/export', { method: 'HEAD', signal: AbortSignal.timeout(4_000) })
  } catch (error) {
    if (!allowOffline) throw error
    verifyLocalPageOwner(userId)
    return 'offline' as const
  }
  // HEAD has no error body, so emit the account-change event from its status.
  requireExportResponse(response)
  if (allowOffline) verifyLocalPageOwner(userId)
  return 'online' as const
}

export async function readCloudThoughtMarkdown(userId: string, thoughtId: string) {
  let response: Response
  try {
    response = await userBoundFetch(userId, `/api/thoughts/${thoughtId}/export.md`, {
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    return null
  }
  requireExportResponse(response)
  // Never turn a server error or a truncated stream into a complete export.
  if (!response.headers.get('content-type')?.startsWith('text/markdown')) throw new Error('EXPORT_FAILED')
  try {
    return await response.text()
  } catch {
    return null
  }
}

export function downloadTextFile(content: string, filename: string, type: string) {
  const href = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 60_000)
}
