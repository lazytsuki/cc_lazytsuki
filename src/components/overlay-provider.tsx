'use client'

import { usePathname } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'

type OverlayContextValue = {
  activeId: string | null
  open: (id: string, trigger?: HTMLElement | null) => void
  close: (id?: string) => void
  isOpen: (id: string) => boolean
}

const OverlayContext = createContext<OverlayContextValue | null>(null)

export function OverlayProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  const close = useCallback((id?: string) => {
    if (id && activeIdRef.current !== id) return
    const trigger = triggerRef.current
    activeIdRef.current = null
    setActiveId(null)
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (activeIdRef.current !== null) return
        const activeElement = document.activeElement
        const focusHasNowhereUsefulToGo = !activeElement || activeElement === document.body || !activeElement.isConnected
        if (focusHasNowhereUsefulToGo && trigger?.isConnected) trigger.focus()
        if (triggerRef.current === trigger) triggerRef.current = null
      }, 0)
    })
  }, [])

  const open = useCallback((id: string, trigger?: HTMLElement | null) => {
    activeIdRef.current = id
    if (trigger !== undefined) triggerRef.current = trigger
    setActiveId(id)
  }, [])

  useEffect(() => {
    close()
  }, [pathname, close])

  const value = useMemo<OverlayContextValue>(() => ({
    activeId,
    open,
    close,
    isOpen: (id) => activeId === id,
  }), [activeId, close, open])

  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>
}

export function useOverlayController() {
  const context = useContext(OverlayContext)
  if (!context) throw new Error('useOverlayController must be used inside OverlayProvider')
  return context
}

export function useDismissibleLayer(
  id: string,
  layerRef: RefObject<HTMLElement | null>,
  triggerRef?: RefObject<HTMLElement | null>,
) {
  const overlay = useOverlayController()
  useEffect(() => {
    if (!overlay.isOpen(id)) return
    const dismissOutside = (event: PointerEvent) => {
      if (layerRef.current?.contains(event.target as Node)) return
      if (triggerRef?.current?.contains(event.target as Node)) return
      overlay.close(id)
    }
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      overlay.close(id)
    }
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('keydown', dismissEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('keydown', dismissEscape)
    }
  }, [id, layerRef, overlay, triggerRef])
}
