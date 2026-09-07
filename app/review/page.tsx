import { redirect } from 'next/navigation'
import { AppHeader } from '@/src/components/app-header'
import { ReviewWorkspace } from '@/src/components/review/review-workspace'
import { ThoughtNavigation } from '@/src/components/thoughts/thought-navigation'
import { ThoughtLayout } from '@/src/components/thoughts/thought-layout'
import { ApiError } from '@/src/lib/api-error'
import { requireUser } from '@/src/lib/auth/require-user'
import { createServiceClient } from '@/src/lib/supabase/service'
import { CollectionRepository } from '@/src/server/repositories/collection-repository'
import { ReviewPreferenceRepository } from '@/src/server/repositories/review-preference-repository'
import { ThoughtConnectionRepository } from '@/src/server/repositories/thought-connection-repository'
import { ThoughtRepository } from '@/src/server/repositories/thought-repository'

export const dynamic = 'force-dynamic'

export default async function ReviewPage() {
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await requireUser()
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login')
    throw error
  }
  const userId = user.id

  const client = createServiceClient()
  const thoughts = new ThoughtRepository(client)
  const collections = new CollectionRepository(client)
  const preferences = new ReviewPreferenceRepository(client)
  const connections = new ThoughtConnectionRepository(client)
  const initialReviewPromise = Promise.all([
    preferences.get(userId),
    connections.listForReview(userId, 'pending'),
    connections.countForReview(userId, 'pending'),
    connections.listForReview(userId, 'confirmed'),
  ]).then(([preference, pending, pendingCount, confirmed]) => ({
    preference,
    pending: { items: pending.connections, nextCursor: pending.nextCursor },
    pendingCount,
    confirmed: { items: confirmed.connections, nextCursor: confirmed.nextCursor },
  })).catch(() => null)
  const [recent, initialCollections, initialReview] = await Promise.all([
    thoughts.listRecent(userId),
    collections.list(userId).catch(() => null),
    initialReviewPromise,
  ])

  return (
    <main key={userId} className="app-shell" id="main-content" tabIndex={-1} data-retniw-user-id={userId}>
      <AppHeader account={{ email: user.email, nickname: user.nickname }} userId={userId} />
      <ThoughtLayout>
        <ThoughtNavigation
          userId={userId}
          activeThoughtId=""
          activeView="review"
          currentStarted
          initialCollections={initialCollections}
          initialNextCursor={recent.nextCursor}
          thoughts={recent.thoughts}
        />
        <section className="thought-main" aria-label="回看以前的想法">
          <ReviewWorkspace initialData={initialReview} userId={userId} />
        </section>
      </ThoughtLayout>
    </main>
  )
}
