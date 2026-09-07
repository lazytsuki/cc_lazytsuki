import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '@/src/lib/api-error'
import { UUID_PATTERN } from '@/src/server/thoughts/parse-thought-management'

export const SEARCH_PAGE_SIZE = 20
export const SEARCH_QUERY_LIMIT = 120

export type SearchExcerpt = { before: string; match: string; after: string }

export type ThoughtSearchResult = {
  entryId: string
  thoughtId: string
  entryType: 'user' | 'import'
  excerpt: SearchExcerpt
  sourceLabel: string | null
  createdAt: string
  archivedAt: string | null
}

export type ThoughtSearchPage = {
  results: ThoughtSearchResult[]
  nextCursor: string | null
}

type SearchRow = {
  id: string
  thought_id: string
  entry_type: 'user' | 'import'
  content: string
  source_label: string | null
  created_at: string
  thought: { archived_at: string | null }
}

type SearchCursor = { query: string; createdAt: string; id: string }

export function parseSearchQuery(value: string | null) {
  const query = value?.trim() ?? ''
  if (!query || query.length > SEARCH_QUERY_LIMIT || query.includes('\0')) {
    throw new ApiError(400, 'INVALID_INPUT', `搜索内容需要 1 至 ${SEARCH_QUERY_LIMIT} 个字`)
  }
  return query
}

// Unlike PostgREST ILIKE, imatch does not rewrite a literal * into a wildcard.
// Escape every regex metacharacter; %, _ and quotes already have literal meaning.
export function escapeSearchPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function makeSearchExcerpt(content: string, query: string): SearchExcerpt {
  const found = new RegExp(escapeSearchPattern(query), 'iu').exec(content)
  if (!found) {
    return { before: content.slice(0, 160), match: '', after: content.length > 160 ? '…' : '' }
  }
  const start = Math.max(0, found.index - 64)
  const end = Math.min(content.length, found.index + found[0].length + 80)
  return {
    before: `${start > 0 ? '…' : ''}${content.slice(start, found.index)}`,
    match: found[0],
    after: `${content.slice(found.index + found[0].length, end)}${end < content.length ? '…' : ''}`,
  }
}

export function encodeSearchCursor(cursor: SearchCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

export function decodeSearchCursor(value: string, query: string): SearchCursor {
  try {
    if (value.length > 2048 || !/^[\w-]+$/.test(value)) throw new Error('Invalid encoding')
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<SearchCursor> | null
    if (
      parsed && parsed.query === query &&
      typeof parsed.id === 'string' && UUID_PATTERN.test(parsed.id) &&
      typeof parsed.createdAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(parsed.createdAt) &&
      !Number.isNaN(Date.parse(parsed.createdAt))
    ) return parsed as SearchCursor
  } catch {}
  throw new ApiError(400, 'INVALID_INPUT', '搜索分页已失效，请重新搜索')
}

export class ThoughtSearchRepository {
  constructor(private readonly client: SupabaseClient) {}

  async search(userId: string, input: string, cursorValue?: string): Promise<ThoughtSearchPage> {
    const query = parseSearchQuery(input)
    const cursor = cursorValue !== undefined ? decodeSearchCursor(cursorValue, query) : undefined
    let request = this.client
      .from('entries')
      .select('id,thought_id,entry_type,content,source_label,created_at,thought:thoughts!entries_thought_owner_fk!inner(archived_at)')
      .eq('user_id', userId)
      .eq('thought.user_id', userId)
      .is('thought.deleted_at', null)
      .in('entry_type', ['user', 'import'])
      .filter('content', 'imatch', escapeSearchPattern(query))
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })

    if (cursor) {
      request = request.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
    }

    const { data, error } = await request.limit(SEARCH_PAGE_SIZE + 1).returns<SearchRow[]>()
    if (error) throw new ApiError(500, 'INTERNAL_ERROR', '暂时无法搜索，请重试', true)
    const rows = data ?? []
    const page = rows.slice(0, SEARCH_PAGE_SIZE)
    const last = page.at(-1)
    return {
      results: page.map((row) => ({
        entryId: row.id,
        thoughtId: row.thought_id,
        entryType: row.entry_type,
        excerpt: makeSearchExcerpt(row.content, query),
        sourceLabel: row.source_label?.slice(0, 80) ?? null,
        createdAt: row.created_at,
        archivedAt: row.thought.archived_at,
      })),
      nextCursor: rows.length > SEARCH_PAGE_SIZE && last
        ? encodeSearchCursor({ query, createdAt: last.created_at, id: last.id })
        : null,
    }
  }
}
