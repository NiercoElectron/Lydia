import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { Engine, TextTyping } from '../engine/engine'
import type { Matrix3 } from '../engine/smartObject'
import { fontFamilies } from '../engine/text'
import { isTyping } from '../engine/view'
import { useLanguage } from '../i18n'

// The room around the lines, in font sizes: for what sticks out of them, and for the caret
const ROOM = 0.5

// The matrix as CSS writes it. Only a perspective needs the longer way, which the browser draws less sharply
function cssMatrix([a, b, c, d, e, f, g, h, i]: Matrix3) {
  if (g === 0 && h === 0) return `matrix(${a}, ${d}, ${b}, ${e}, ${c}, ${f})`
  return `matrix3d(${a}, ${d}, 0, ${g}, ${b}, ${e}, 0, ${h}, 0, 0, 1, 0, ${c}, ${f}, 0, ${i})`
}

// Where a text is typed (see text.ts): a real text box, for the caret, accents and the keyboards of every language, in
// the font of the text and in its place on the drawing, following the view while it moves. Enter starts a new line
export function TextBox({ engine, typing }: { engine: Engine | null; typing: TextTyping }) {
  const { t } = useLanguage()
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const { words, style, area, lineHeight, opacity } = typing
  const room = Math.ceil(style.size * ROOM)
  const left = area.x - room
  const top = area.y - room

  useEffect(() => {
    let frame = 0
    const follow = () => {
      const box = boxRef.current
      const place = engine?.textPlace()
      if (box && place) {
        box.style.transform = cssMatrix(place)
        box.style.outline = `${1 / Math.hypot(place[0], place[3])}px dashed currentColor`
      }
      frame = requestAnimationFrame(follow)
    }
    follow()
    return () => cancelAnimationFrame(frame)
  }, [engine])

  useEffect(() => {
    const box = boxRef.current!
    box.focus()
    box.setSelectionRange(box.value.length, box.value.length)
    // The wheel goes on moving and zooming the drawing. React only listens to it in a way that can't stop the browser
    // from zooming the page with Ctrl
    const passOn = (e: WheelEvent) => {
      e.preventDefault()
      box.parentElement?.querySelector('canvas')?.dispatchEvent(new WheelEvent('wheel', e))
    }
    box.addEventListener('wheel', passOn, { passive: false })
    return () => box.removeEventListener('wheel', passOn)
  }, [])

  // The bar and the color panel take the keyboard away when they are used. A field being typed in keeps it
  useEffect(() => {
    if (!isTyping(document.activeElement)) boxRef.current!.focus()
  }, [style])

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      engine?.cancelText()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      engine?.finishText()
    }
  }

  return (
    <textarea
      ref={boxRef}
      className="text-box"
      aria-label={t('Text')}
      value={words}
      wrap="off"
      spellCheck={false}
      onChange={e => engine?.setTypedWords(e.target.value)}
      onKeyDown={handleKeyDown}
      style={{
        left,
        top,
        width: area.width + 2 * room,
        height: area.height + 2 * room,
        padding: room,
        transformOrigin: `${-left}px ${-top}px`,
        fontFamily: fontFamilies(style.font),
        fontSize: style.size,
        fontWeight: style.isBold ? 'bold' : 'normal',
        fontStyle: style.isItalic ? 'italic' : 'normal',
        lineHeight: `${lineHeight}px`,
        color: style.color,
        caretColor: style.color,
        textAlign: style.align,
        opacity,
      }}
    />
  )
}
