'use client'

import type { ThoughtOutboxItem } from '@/src/lib/capture/capture-store'
import styles from './local-drafts.module.css'

export function LocalDrafts({
  drafts,
  disabled,
  onRestore,
}: {
  drafts: ThoughtOutboxItem[]
  disabled: boolean
  onRestore: (item: ThoughtOutboxItem) => void
}) {
  if (drafts.length === 0) return null

  return (
    <details className={styles.drafts}>
      <summary>本机草稿 <span>{drafts.length}</span></summary>
      <p className={styles.description}>还没有保存到想法中，仅保留在这个浏览器。打开后可以继续写。</p>
      <ul>
        {drafts.map((draft) => (
          <li key={draft.entryId}>
            <button type="button" disabled={disabled} onClick={() => onRestore(draft)}>
              <span className={styles.preview}>{draft.content.trim() || '空白草稿'}</span>
              <span className={styles.meta}>
                {draft.createsThought ? '新想法' : '续写草稿'}
                <time dateTime={draft.updatedAt}>{new Date(draft.updatedAt).toLocaleDateString('zh-CN', {
                  month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai',
                })}</time>
                <span className={styles.action}>继续写</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}
