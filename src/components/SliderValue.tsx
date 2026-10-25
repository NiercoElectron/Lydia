import { useRef, useState } from 'react'

type Props = {
  value: number
  min: number
  max: number
  step?: number // 0: any value
  unit?: string // shown after the number: "%", " px", "°"
  hint?: string // what the number is, shown when the pointer rests on it
  disabled?: boolean
  onChange: (value: number) => void
  onDone?: () => void // after a typed value, as when a slider is let go
}

// The number next to a slider (or the view's zoom and angle). Clicking it lets the number be typed in: Enter, or
// clicking elsewhere, keeps it (within the range, on its steps), and Esc leaves it as it was. While the number is typed,
// the keyboard's shortcuts leave it alone (see isTyping in view.ts)
export function SliderValue({ value, min, max, step = 1, unit = '', hint, disabled = false, onChange, onDone }: Props) {
  const [text, setText] = useState<string | null>(null) // what is being typed, or null when not typing
  const isCancelled = useRef(false)

  function keep() {
    const typed = Number(text)
    setText(null)
    if (isCancelled.current || text === null || text.trim() === '' || !Number.isFinite(typed)) return
    const stepped = step > 0 ? min + Math.round((typed - min) / step) * step : typed
    const kept = Math.min(max, Math.max(min, stepped))
    if (kept === value) return
    onChange(kept)
    onDone?.()
  }

  if (text === null) {
    return (
      <button
        type="button"
        className="slider-value"
        disabled={disabled}
        title={hint ? `${hint}. Click to type a value` : 'Click to type a value'}
        onClick={() => {
          isCancelled.current = false
          setText(String(value))
        }}
      >
        {value}
        {unit}
      </button>
    )
  }
  return (
    <input
      className="slider-value"
      type="number"
      value={text}
      min={min}
      max={max}
      step={step > 0 ? step : 'any'}
      autoFocus
      onFocus={e => e.currentTarget.select()}
      onChange={e => setText(e.target.value)}
      onBlur={keep}
      onKeyDown={e => {
        if (e.key === 'Escape') isCancelled.current = true
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
      }}
    />
  )
}
