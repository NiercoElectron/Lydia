import { Pin, PinOff } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { loadAdvancedPinned, saveAdvancedPinned } from '../settings'

// The bar's "Advanced" button, and the panel it opens below it, over the drawing, with the settings changed less often.
// Clicking elsewhere, or Esc, closes it, unless it is pinned: then it stays open, also when this tool is chosen again
// and on the next visit
export function AdvancedMenu({ children }: { children: ReactNode }) {
  const [isPinned, setIsPinned] = useState(loadAdvancedPinned)
  const [isOpen, setIsOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const isShown = isOpen || isPinned

  useEffect(() => {
    if (!isOpen || isPinned) return
    // A click on the drawing only closes the panel, and doesn't paint: it is stopped before it gets there
    const handlePointerDown = (e: PointerEvent) => {
      if (menu.current?.contains(e.target as Node)) return
      if (e.target instanceof HTMLCanvasElement) e.stopPropagation()
      setIsOpen(false)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, isPinned])

  // The button opens and closes the panel; closing a pinned panel unpins it
  function toggle() {
    if (isShown && isPinned) pin(false)
    setIsOpen(!isShown)
  }

  // Pinning or unpinning leaves the panel open, under the pointer
  function pin(pinned: boolean) {
    saveAdvancedPinned(pinned)
    setIsPinned(pinned)
    setIsOpen(true)
  }

  return (
    <div className="advanced-menu" ref={menu}>
      <button aria-expanded={isShown} onClick={toggle} title="More settings of the brush">
        Advanced ▾
      </button>
      {isShown && (
        <div className="advanced-panel">
          <div className="advanced-header">
            Advanced
            <button
              className="icon-button"
              aria-pressed={isPinned}
              onClick={() => pin(!isPinned)}
              title={isPinned ? 'Unpin: close it when clicking elsewhere' : 'Pin: keep it open'}
            >
              {isPinned ? <PinOff size={14} aria-hidden /> : <Pin size={14} aria-hidden />}
            </button>
          </div>
          {children}
        </div>
      )}
    </div>
  )
}
