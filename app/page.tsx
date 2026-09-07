import { redirect } from 'next/navigation'
import { ApiError } from '@/src/lib/api-error'
import { requireUser } from '@/src/lib/auth/require-user'
import { createServiceClient } from '@/src/lib/supabase/service'
import { CollectionRepository } from '@/src/server/repositories/collection-repository'
import { ThoughtRepository } from '@/src/server/repositories/thought-repository'
import { ThoughtWorkspace } from '@/src/components/thoughts/thought-workspace'
import { AppHeader } from '@/src/components/app-header'

export const dynamic = 'force-dynamic'

export default async function CapturePage() {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await requireUser()
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login')
    throw error
  }
  const userId = user.id

  const client = createServiceClient()
  const [recent, initialCollections] = await Promise.all([
    new ThoughtRepository(client).listRecent(userId),
    new CollectionRepository(client).list(userId).catch(() => null),
  ])

  return (
    <main className="app-shell" id="main-content" tabIndex={-1} data-retniw-user-id={userId}>
      <AppHeader account={{ email: user.email, nickname: user.nickname }} userId={userId} />
      <ThoughtWorkspace
        key={`new-thought:${userId}`}
        userId={userId}
        initialThought={null}
        initialEntries={[]}
        initialCheckpoints={[]}
        initialCollections={initialCollections}
        initialThoughts={recent.thoughts}
        initialNextCursor={recent.nextCursor}
      />
    </main>
  )
}
