import { notFound, redirect } from 'next/navigation'
import { ApiError } from '@/src/lib/api-error'
import { requireUser } from '@/src/lib/auth/require-user'
import { createServiceClient } from '@/src/lib/supabase/service'
import { CollectionRepository, type ThoughtCollection } from '@/src/server/repositories/collection-repository'
import { ThoughtRepository } from '@/src/server/repositories/thought-repository'
import { requireUuid } from '@/src/server/thoughts/parse-thought-management'
import { ThoughtWorkspace } from '@/src/components/thoughts/thought-workspace'
import { AppHeader } from '@/src/components/app-header'

export const dynamic = 'force-dynamic'

type ThoughtPageProps = { params: Promise<{ id: string }> }

export default async function ThoughtPage({ params }: ThoughtPageProps) {
  const { id: rawId } = await params
  let id: string
  try {
    id = requireUuid(rawId, 'id')
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) notFound()
    throw error
  }
  let data: Awaited<ReturnType<ThoughtRepository['getDetail']>>
  let recent: Awaited<ReturnType<ThoughtRepository['listRecent']>>
  let initialCollections: ThoughtCollection[] | null
  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await requireUser()
    const client = createServiceClient()
    const repository = new ThoughtRepository(client)
    ;[data, recent, initialCollections] = await Promise.all([
      repository.getDetail(user.id, id),
      repository.listRecent(user.id),
      new CollectionRepository(client).list(user.id).catch(() => null),
    ])
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login')
    if (error instanceof ApiError && error.status === 404) {
      return <main className="shell" id="main-content" tabIndex={-1}><p>没有找到这段内容。</p></main>
    }
    throw error
  }

  return (
    <main className="app-shell" id="main-content" tabIndex={-1} data-retniw-user-id={user.id}>
      <AppHeader account={{ email: user.email, nickname: user.nickname }} userId={user.id} />
      <ThoughtWorkspace
        key={`${user.id}:${data.thought.id}`}
        userId={user.id}
        initialThought={data.thought}
        initialEntries={data.entries}
        initialCheckpoints={data.checkpoints}
        initialCollections={initialCollections}
        initialThoughts={recent.thoughts}
        initialNextCursor={recent.nextCursor}
      />
    </main>
  )
}
