import { NextRequest, NextResponse } from 'next/server'
import { apiErrorResponse } from '@/src/lib/api-response'
import { requireRequestUser } from '@/src/lib/auth/require-user'
import { createServiceClient } from '@/src/lib/supabase/service'
import { decodeSearchCursor, parseSearchQuery, ThoughtSearchRepository } from '@/src/server/repositories/thought-search-repository'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const user = await requireRequestUser(request)
    const query = parseSearchQuery(request.nextUrl.searchParams.get('q'))
    const cursor = request.nextUrl.searchParams.get('cursor') ?? undefined
    if (cursor !== undefined) decodeSearchCursor(cursor, query)
    const result = await new ThoughtSearchRepository(createServiceClient()).search(user.id, query, cursor)
    return NextResponse.json({ data: result }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    const response = apiErrorResponse(error)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
}
