import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/src/lib/api-error'

const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), search: vi.fn(), createServiceClient: vi.fn() }))

vi.mock('@/src/lib/supabase/server', () => ({
  createServerAuthClient: () => ({ auth: { getClaims: mocks.getClaims } }),
}))
vi.mock('@/src/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }))
vi.mock('@/src/server/repositories/thought-search-repository', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/src/server/repositories/thought-search-repository')>(),
  ThoughtSearchRepository: class { search = mocks.search },
}))

import { GET } from '@/app/api/thoughts/search/route'
import { encodeSearchCursor } from '@/src/server/repositories/thought-search-repository'

const userId = '018f6f3a-a1c2-47a8-8f1e-800000000001'
const entryId = '018f6f3a-a1c2-47a8-8f1e-800000000002'

function request(params: Record<string, string> = { q: '原文' }, expectedUserId: string | null = userId) {
  return new NextRequest(`http://localhost/api/thoughts/search?${new URLSearchParams(params)}`, {
    headers: expectedUserId ? { 'x-retniw-expected-user-id': expectedUserId } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: userId } }, error: null })
  mocks.search.mockResolvedValue({ results: [], nextCursor: null })
})

describe('thought search route', () => {
  it('binds search to the authenticated page account and disables caching', async () => {
    const response = await GET(request({ q: '  原文  ', userId: 'another-user' }))
    expect(response.status).toBe(200)
    expect(mocks.search).toHaveBeenCalledWith(userId, '原文', undefined)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ data: { results: [], nextCursor: null } })
  })

  it('requires authentication before parsing search terms or reading data', async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: null })
    const response = await GET(request({ q: '' }))
    expect(response.status).toBe(401)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
    expect(mocks.search).not.toHaveBeenCalled()
  })

  it.each([null, 'another-user'])('rejects missing or switched account context: %s', async (expected) => {
    const response = await GET(request({ q: '原文' }, expected))
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('AUTH_CONTEXT_CHANGED')
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
    expect(mocks.search).not.toHaveBeenCalled()
  })

  it.each<Record<string, string>>([{}, { q: '  ' }, { q: 'a'.repeat(121) }, { q: '原文', cursor: '' }, { q: '原文', cursor: 'invalid' }])('rejects malformed search requests before creating a service client', async (params) => {
    const response = await GET(request(params))
    expect(response.status).toBe(400)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
    expect(mocks.search).not.toHaveBeenCalled()
  })

  it('accepts only a cursor issued for the same search term', async () => {
    const cursor = encodeSearchCursor({ query: '原文', createdAt: '2026-09-07T01:00:00.123456Z', id: entryId })
    const valid = await GET(request({ q: '原文', cursor }))
    expect(valid.status).toBe(200)
    expect(mocks.search).toHaveBeenCalledWith(userId, '原文', cursor)
    mocks.search.mockClear()
    const different = await GET(request({ q: '其他', cursor }))
    expect(different.status).toBe(400)
    expect(mocks.search).not.toHaveBeenCalled()
  })

  it('returns a retryable failure response without caching it', async () => {
    mocks.search.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', '暂时无法搜索，请重试', true))
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect((await response.json()).error.retryable).toBe(true)
  })
})
