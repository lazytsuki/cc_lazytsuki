'use client'

import Link from 'next/link'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { userBoundFetch } from '@/src/lib/auth/user-bound-fetch'
import type { ThoughtSearchPage } from '@/src/server/repositories/thought-search-repository'
import styles from './thought-search.module.css'

type SearchState = {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  page: ThoughtSearchPage
}

const emptyPage: ThoughtSearchPage = { results: [], nextCursor: null }

export function ThoughtSearch({
  userId,
  onChoose,
  children,
}: {
  userId: string
  onChoose: () => void
  children: ReactNode
}) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const requestEpoch = useRef(0)
  const currentQuery = useRef('')
  const [input, setInput] = useState('')
  const query = input.trim()
  const [search, setSearch] = useState<SearchState>({ query: '', status: 'idle', page: emptyPage })

  const runSearch = useCallback(async (value: string, cursor?: string) => {
    if (value !== currentQuery.current) return
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    const epoch = ++requestEpoch.current
    setSearch((current) => ({
      query: value,
      status: 'loading',
      page: cursor && current.query === value ? current.page : emptyPage,
    }))
    try {
      const params = new URLSearchParams({ q: value })
      if (cursor) params.set('cursor', cursor)
      const response = await userBoundFetch(userId, `/api/thoughts/search?${params}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
      const payload = await response.json() as { data?: ThoughtSearchPage }
      if (controller.signal.aborted || epoch !== requestEpoch.current) return
      if (!response.ok || !Array.isArray(payload.data?.results)) throw new Error('SEARCH_FAILED')
      const page = payload.data!
      setSearch((current) => ({
        query: value,
        status: 'ready',
        page: cursor && current.query === value
          ? {
              results: Array.from(new Map([...current.page.results, ...page.results].map((result) => [result.entryId, result])).values()),
              nextCursor: page.nextCursor,
            }
          : page,
      }))
    } catch {
      if (controller.signal.aborted || epoch !== requestEpoch.current) return
      setSearch((current) => ({ ...current, status: 'error' }))
    }
  }, [userId])

  useEffect(() => {
    if (!query) return
    const timer = window.setTimeout(() => void runSearch(query), 250)
    return () => {
      window.clearTimeout(timer)
      activeRequest.current?.abort()
      requestEpoch.current += 1
    }
  }, [query, runSearch])

  function updateInput(value: string) {
    currentQuery.current = value.trim()
    setInput(value)
    if (value.trim() === query) return
    activeRequest.current?.abort()
    requestEpoch.current += 1
    setSearch({ query: value.trim(), status: value.trim() ? 'loading' : 'idle', page: emptyPage })
  }

  function clearSearch() {
    updateInput('')
    inputRef.current?.focus()
  }

  const page = search.query === query ? search.page : emptyPage
  const loading = query !== '' && (search.query !== query || search.status === 'loading')

  return <div className={styles.search} data-thought-search>
    <div className={styles.field} role="search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4.5 4.5" /></svg>
      <label className="visually-hidden" htmlFor={`${id}-input`}>搜索想法原文</label>
      <input
        id={`${id}-input`}
        ref={inputRef}
        type="search"
        placeholder="搜索想法原文"
        aria-controls={query ? `${id}-results` : undefined}
        autoComplete="off"
        enterKeyHint="search"
        maxLength={120}
        value={input}
        onChange={(event) => updateInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape' && input) {
            event.preventDefault()
            event.stopPropagation()
            clearSearch()
          }
        }}
      />
      {input && <button type="button" aria-label="清空搜索" onClick={clearSearch}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
      </button>}
    </div>
    {query ? <div id={`${id}-results`} className={styles.results} key={query} aria-busy={loading}>
      <p className={styles.scope}>搜索全部原文，含归档</p>
      <p className={styles.status} role="status">
        {loading && page.results.length === 0 ? '正在搜索…'
          : search.status === 'ready' && page.results.length === 0 ? '没有找到这段文字，试试更短的关键词。'
          : page.results.length > 0 ? `找到 ${page.results.length}${page.nextCursor ? '+' : ''} 段原文` : ''}
      </p>
      {page.results.length > 0 && <ul className={styles.list}>
        {page.results.map((result) => <li key={result.entryId}>
          <Link
            className={styles.result}
            href={`/thoughts/${result.thoughtId}#entry-${result.entryId}`}
            prefetch={false}
            onClick={(event) => {
              if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onChoose()
            }}
          >
            <span className={styles.excerpt}>{result.excerpt.before}<mark>{result.excerpt.match}</mark>{result.excerpt.after}</span>
            <span className={styles.meta}>
              <time dateTime={result.createdAt}>{new Date(result.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' })}</time>
              {result.entryType === 'import' && <span>导入</span>}
              {result.archivedAt && <span>已归档</span>}
            </span>
          </Link>
        </li>)}
      </ul>}
      {search.status === 'error' && <div className={styles.error}>
        <p role="alert">搜索没有完成，请重试。</p>
        <button type="button" onClick={() => void runSearch(query, page.nextCursor ?? undefined)}>重试</button>
      </div>}
      {page.nextCursor && search.status !== 'error' && <button
        className={styles.more}
        type="button"
        disabled={loading}
        onClick={() => void runSearch(query, page.nextCursor!)}
      >{loading ? '正在加载…' : '更多匹配原文'}</button>}
    </div> : children}
  </div>
}
