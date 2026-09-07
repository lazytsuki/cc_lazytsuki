'use client'

import { useId, useLayoutEffect, useRef, type RefObject } from 'react'
import { usePointerGlow } from '@/src/hooks/use-pointer-glow'

type ThoughtComposerProps = {
  autoFocus?: boolean
  content: string
  disabled?: boolean
  saveDisabled?: boolean
  saveDisabledReason?: string
  hasEntries: boolean
  onChange: (content: string) => void
  onSubmit: () => void
  textareaRef?: RefObject<HTMLTextAreaElement | null>
}

export function thoughtComposerCopy(hasEntries: boolean) {
  return hasEntries
    ? { ariaLabel: '继续写', placeholder: '补充一个新的点，或继续刚才的思路' }
    : { ariaLabel: '写在这里', placeholder: '从这里开始写' }
}

export function shouldSubmitThought(event: {
  key: string
  shiftKey: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  isComposing: boolean
  keyCode: number
}) {
  return event.key === 'Enter' &&
    Boolean(event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229
}

export function ThoughtComposer({ autoFocus = false, content, disabled = false, saveDisabled = false, saveDisabledReason, hasEntries, onChange, onSubmit, textareaRef }: ThoughtComposerProps) {
  const copy = thoughtComposerCopy(hasEntries)
  const textareaId = useId()
  const ownTextareaRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = textareaRef ?? ownTextareaRef
  const pointerGlow = usePointerGlow<HTMLDivElement>()
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 560)}px`
  }, [content, inputRef])
  return (
    <div
      className={`thought-composer capture-surface${hasEntries ? '' : ' thought-composer--initial'}`}
      aria-busy={disabled || undefined}
      data-mode={hasEntries ? 'continuation' : 'initial'}
      data-pointer-glow="capture"
      onPointerLeave={pointerGlow.onPointerLeave}
      onPointerMove={pointerGlow.onPointerMove}
    >
      {hasEntries && <label className="thought-composer__label" htmlFor={textareaId}>继续写</label>}
      <textarea
        id={textareaId}
        ref={inputRef}
        autoFocus={autoFocus}
        disabled={disabled}
        maxLength={10_000}
        aria-label={copy.ariaLabel}
        aria-describedby={saveDisabledReason ? `${textareaId}-status` : undefined}
        placeholder={copy.placeholder}
        value={content}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (disabled || saveDisabled) return
          if (!shouldSubmitThought({
            key: event.key,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey,
            isComposing: event.nativeEvent.isComposing,
            keyCode: event.keyCode,
          })) return
          event.preventDefault()
          onSubmit()
        }}
      />
      <div className="capture-actions">
        <span className="capture-shortcut-hint">Enter 换行，⌘ / Ctrl + Enter 保存</span>
        <span className="capture-mobile-hint">写好后，点保存</span>
        <button type="button" aria-label="保存" disabled={disabled || saveDisabled || !content.trim()} onClick={onSubmit}>
          保存
        </button>
      </div>
      {saveDisabledReason && <p className="capture-status" id={`${textareaId}-status`} role="status">{saveDisabledReason}</p>}
    </div>
  )
}
