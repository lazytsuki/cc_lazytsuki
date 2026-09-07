'use client'

import { useLayoutEffect, useRef } from 'react'
import { ExportMenu, type WorkspaceExportProps } from './export-menu'
import { useDismissibleLayer, useOverlayController } from '@/src/components/overlay-provider'

type ThoughtMenuProps = {
  userId: string
  thoughtId: string | null
  organizeDisabled: boolean
  organizeRunning: boolean
  importDisabled: boolean
  onImport: () => void
  onOrganize: () => void
  exportSnapshot: WorkspaceExportProps
}

export function nextMenuItemIndex(key: string, currentIndex: number, itemCount: number) {
  if (itemCount === 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return itemCount - 1
  if (key === 'ArrowDown') return currentIndex < 0 ? 0 : (currentIndex + 1) % itemCount
  if (key === 'ArrowUp') return currentIndex < 0 ? itemCount - 1 : (currentIndex - 1 + itemCount) % itemCount
  return null
}

export function ThoughtMenu({
  userId,
  thoughtId,
  organizeDisabled,
  organizeRunning,
  importDisabled,
  onImport,
  onOrganize,
  exportSnapshot,
}: ThoughtMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const initialFocusRef = useRef<'first' | 'last'>('first')
  const overlay = useOverlayController()
  const menuOpen = overlay.isOpen('thought-menu')
  useDismissibleLayer('thought-menu', menuRef)

  useLayoutEffect(() => {
    if (!menuOpen) return
    const frame = window.requestAnimationFrame(() => {
      const items = menuRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"]):not(:disabled)',
      )
      const item = initialFocusRef.current === 'last' ? items?.item((items?.length ?? 1) - 1) : items?.item(0)
      item?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [menuOpen])

  function closeMenu(restoreFocus = true) {
    overlay.close('thought-menu')
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }))
    }
  }

  function focusOutsideMenu(reverse: boolean) {
    const trigger = triggerRef.current
    const panel = menuRef.current?.querySelector<HTMLElement>('#thought-menu-panel')
    if (!trigger) return closeMenu(false)
    const focusable = Array.from(document.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).filter((item) => item.getClientRects().length > 0)
    const triggerIndex = focusable.indexOf(trigger)
    const direction = reverse ? -1 : 1
    let nextIndex = triggerIndex + direction
    while (nextIndex >= 0 && nextIndex < focusable.length && panel?.contains(focusable[nextIndex]!)) {
      nextIndex += direction
    }
    const target = focusable[nextIndex]
    closeMenu(false)
    window.requestAnimationFrame(() => target?.focus({ preventScroll: true }))
  }

  function navigateMenu(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeMenu()
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      focusOutsideMenu(event.shiftKey)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"]):not(:disabled)',
      ),
    )
    if (items.length === 0) return
    event.preventDefault()
    const currentIndex = items.findIndex((item) => item === document.activeElement)
    const nextIndex = nextMenuItemIndex(event.key, currentIndex, items.length)
    if (nextIndex !== null) items[nextIndex]?.focus({ preventScroll: true })
  }

  return (
    <div className="thought-menu" ref={menuRef}>
      <button
        id="thought-menu-trigger"
        ref={triggerRef}
        type="button"
        aria-label="更多操作"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-controls={menuOpen ? 'thought-menu-panel' : undefined}
        onClick={(event) => {
          if (menuOpen) return overlay.close('thought-menu')
          initialFocusRef.current = 'first'
          overlay.open('thought-menu', event.currentTarget)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          initialFocusRef.current = event.key === 'ArrowUp' ? 'last' : 'first'
          if (!menuOpen) overlay.open('thought-menu', event.currentTarget)
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.25" />
          <circle cx="12" cy="12" r="1.25" />
          <circle cx="19" cy="12" r="1.25" />
        </svg>
      </button>
      {menuOpen && <div id="thought-menu-panel" className="thought-menu__panel" role="menu" aria-labelledby="thought-menu-trigger" onKeyDown={navigateMenu}>
        <button
          type="button"
          role="menuitem"
          disabled={!thoughtId || organizeDisabled || organizeRunning}
          onClick={() => {
            closeMenu()
            onOrganize()
          }}
        >
          {organizeRunning ? '正在整理' : '整理内容'}
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={importDisabled}
          onClick={() => {
            closeMenu()
            onImport()
          }}
        >
          导入文字
        </button>
        <ExportMenu thoughtId={thoughtId} userId={userId} {...exportSnapshot} />
      </div>}
    </div>
  )
}
