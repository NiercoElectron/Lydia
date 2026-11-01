import { useEffect, useRef, useState, type ReactNode } from 'react'

export type MenuItem = {
  label: string
  onClick: () => void
  disabled?: boolean
  isOn?: boolean // a choice that stays on or off, shown with a mark
  keys?: string // its shortcut, shown after it
  hint?: string
}

// null: a line between two groups of items
export type Menu = { title: string; items: (MenuItem | null)[]; extra?: ReactNode }

// The menus on top of the window. A click opens one, and while one is open, going over the others opens them. Their
// items are always on the page, only hidden
export function MenuBar({ menus }: { menus: Menu[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const barRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (open === null) return
    const handlePointerDown = (e: PointerEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpen(null)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <nav ref={barRef} className="menu-bar">
      {menus.map(({ title, items, extra }) => (
        <div key={title} className={open === title ? 'menu open' : 'menu'}>
          <button
            className="menu-title"
            aria-expanded={open === title}
            onClick={() => setOpen(current => (current === title ? null : title))}
            onPointerEnter={() => setOpen(current => (current === null ? null : title))}
          >
            {title}
          </button>
          <div className="menu-items">
            {items.map((item, index) =>
              item ? (
                <button
                  key={item.label}
                  disabled={item.disabled}
                  aria-pressed={item.isOn}
                  title={item.hint}
                  data-keys={item.keys}
                  onClick={() => {
                    item.onClick()
                    setOpen(null)
                  }}
                >
                  {item.label}
                </button>
              ) : (
                <hr key={index} />
              ),
            )}
            {extra}
          </div>
        </div>
      ))}
    </nav>
  )
}
