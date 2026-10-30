import { useLanguage } from '../i18n'
import { ArrowLeftRight, Palette } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  hexToHsv,
  hsvToHex,
  hsvToRgb,
  parseHex,
  triangleColor,
  triangleCorners,
  trianglePoint,
  type Hsv,
  type Point,
} from '../colors'
import { SliderValue } from './SliderValue'

const SIZE = 200 // the ring and the triangle, in pixels of the screen
const RING = 16 // how thick the ring of hues is
const GAP = 4 // between the ring and the triangle's corners
const OUTER = SIZE / 2 - 1
const INNER = OUTER - RING
const TRIANGLE = INNER - GAP // the radius of the circle the triangle's corners are on

type Props = {
  color: string // the brush's color, "#rrggbb"
  background: string // the color kept behind it, swapped with it by X
  recent: string[] // the colors painted with lately, the newest first
  isTrayOpen: boolean // the color tray (see ColorTray.tsx)
  onColorChange: (color: string) => void
  onSwap: () => void
  onTrayToggle: () => void
}

// The color panel (decision 65), at the top of the right column: a ring of hues around a triangle of the shades of
// the chosen one, which turns with it (its pure color points at the hue on the ring, white and black at its other
// corners); the brush's color and the background color, the color as "#rrggbb", sliders for its hue, saturation and
// value, the colors painted with lately, and the button of the color tray. While the ring or the triangle is dragged, the panel shows each step at
// once but hands the color on at most once a frame: the whole editor is drawn again for each new color
export function ColorPanel({ color, background, recent, isTrayOpen, onColorChange, onSwap, onTrayToggle }: Props) {
  const { t } = useLanguage()
  const [hsv, setHsv] = useState(() => hexToHsv(color))
  // The color handed on last, until it comes back: a color that comes from outside (the eyedropper, a recent color,
  // swapping) moves the panel, but not one it handed on itself, which may already be behind what is shown
  const [sent, setSent] = useState<string | null>(null)
  const [given, setGiven] = useState(color)
  const [typed, setTyped] = useState<string | null>(null) // the hex field while it is typed in
  if (color !== given) {
    setGiven(color)
    if (color === sent) setSent(null)
    else {
      setHsv(hexToHsv(color, hsv))
      setTyped(null)
    }
  }
  const hex = hsvToHex(hsv)

  // ----- Handing the color on -----

  const latest = useRef(hsv)
  const frame = useRef(0)
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  // A new color from the panel. "now": handed on at once (a click, a typed color), else at the next frame (dragging)
  function change(next: Hsv, now = false) {
    setHsv(next)
    latest.current = next
    const handOn = () => {
      frame.current = 0
      const value = hsvToHex(latest.current)
      setSent(value)
      onColorChange(value)
    }
    if (now) {
      cancelAnimationFrame(frame.current)
      handOn()
    } else if (!frame.current) frame.current = requestAnimationFrame(handOn)
  }

  // ----- Drawing the ring and the triangle -----

  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The screen's scale: drawn again when it changes (the browser's zoom, or the window moved to another screen), to
  // stay sharp. A query for the scale it is now tells when it no longer is
  const [scale, setScale] = useState(() => window.devicePixelRatio || 1)
  useEffect(() => {
    const query = matchMedia(`(resolution: ${scale}dppx)`)
    const update = () => setScale(window.devicePixelRatio || 1)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [scale])
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) drawPicker(canvas, hsv, scale)
  }, [hsv, scale])

  // ----- Dragging on them -----

  const dragging = useRef<'ring' | 'triangle' | null>(null)

  // Where the pointer is, from the middle of the ring
  function pointOf(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const box = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - box.left - box.width / 2, y: e.clientY - box.top - box.height / 2 }
  }

  function dragTo(point: Point) {
    const current = latest.current
    if (dragging.current === 'ring') {
      const h = ((Math.atan2(-point.y, point.x) * 180) / Math.PI + 360) % 360
      change({ ...current, h })
    } else if (dragging.current === 'triangle') {
      change({ ...current, ...triangleColor(current.h, point, TRIANGLE) })
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return
    const point = pointOf(e)
    const distance = Math.hypot(point.x, point.y)
    if (distance > OUTER + 2) return
    latest.current = hsv
    dragging.current = distance >= INNER - GAP / 2 ? 'ring' : 'triangle'
    e.currentTarget.setPointerCapture(e.pointerId)
    dragTo(point)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (dragging.current) dragTo(pointOf(e))
  }

  function handlePointerUp() {
    dragging.current = null
  }

  // ----- The hex field -----

  // A whole "#rrggbb" counts as soon as it is typed; a short "#rgb" on Enter, or when the field is left
  function handleHexChange(text: string) {
    setTyped(text)
    if (/^#?[0-9a-f]{6}$/i.test(text.trim())) change(hexToHsv(parseHex(text)!, hsv), true)
  }

  function keepHex() {
    const parsed = typed === null ? null : parseHex(typed)
    if (parsed && parsed !== hex) change(hexToHsv(parsed, hsv), true)
    setTyped(null)
  }

  const slider = (key: 'h' | 's' | 'v', label: string, hint: string, max: number, scale: number, unit: string) => (
    <label className="color-slider" title={hint}>
      {label}
      <input
        type="range"
        min={0}
        max={max}
        value={Math.round(hsv[key] * scale)}
        onChange={e => change({ ...hsv, [key]: Number(e.target.value) / scale })}
      />
      <SliderValue
        value={Math.round(hsv[key] * scale)}
        min={0}
        max={max}
        unit={unit}
        onChange={value => change({ ...hsv, [key]: value / scale }, true)}
      />
    </label>
  )

  return (
    <section className="color-panel" aria-label={t('Color')}>
      <canvas
        ref={canvasRef}
        className="color-picker"
        style={{ width: SIZE, height: SIZE }}
        role="img"
        aria-label={t('Ring of hues, and a triangle of the shades of the hue chosen')}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <div className="color-row">
        <div className="color-swatches">
          <span className="color-swatch background" style={{ background }} title={t('Background color')} />
          <span className="color-swatch foreground" style={{ background: hex }} title={t('Brush color')} />
        </div>
        <button className="color-swap" onClick={onSwap} title={t('Swap with the background color (X)')}>
          <ArrowLeftRight size={14} aria-hidden />
        </button>
        <input
          className="color-hex"
          value={typed ?? hex}
          spellCheck={false}
          aria-label={t('Color code')}
          title={t('The color as a code: #rrggbb, or #rgb')}
          onChange={e => handleHexChange(e.target.value)}
          onBlur={keepHex}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              setTyped(null)
              e.currentTarget.blur()
            }
          }}
        />
        <button
          className="color-tray-button"
          aria-pressed={isTrayOpen}
          onClick={onTrayToggle}
          title={t('Color tray: colors kept to pick again quickly')}
          aria-label={t('Color tray')}
        >
          <Palette size={14} aria-hidden />
        </button>
      </div>
      {slider('h', 'H', t('Hue'), 360, 1, '°')}
      {slider('s', 'S', t('Saturation'), 100, 100, '%')}
      {slider('v', 'V', t('Value: how far from black'), 100, 100, '%')}
      {recent.length > 0 && (
        <div className="recent-colors" aria-label={t('Colors painted with lately')}>
          {recent.map(each => (
            <button
              key={each}
              className="recent-color"
              style={{ background: each }}
              title={each}
              aria-label={each}
              onClick={() => onColorChange(each)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

// The ring of hues, the triangle of the chosen hue's shades and a mark on each, sharp on any screen
function drawPicker(canvas: HTMLCanvasElement, hsv: Hsv, scale: number) {
  const pixels = Math.round(SIZE * scale)
  if (canvas.width !== pixels || canvas.height !== pixels) {
    canvas.width = pixels
    canvas.height = pixels
  }
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.clearRect(0, 0, SIZE, SIZE)
  const middle = SIZE / 2

  // The ring: the hues go round against the clock from red on the right, as in colors.ts. A conic gradient goes with
  // the clock, so its stops count the hues backwards
  const ring = ctx.createConicGradient(0, middle, middle)
  for (let i = 0; i <= 12; i++) ring.addColorStop(i / 12, hsvToHex({ h: (360 - i * 30) % 360, s: 1, v: 1 }))
  ctx.beginPath()
  ctx.arc(middle, middle, OUTER, 0, Math.PI * 2)
  ctx.arc(middle, middle, INNER, 0, Math.PI * 2, true)
  ctx.fillStyle = ring
  ctx.fill()

  // The triangle, pixel by pixel: as much of the pure color and of white as the pixel is made of their corners (black
  // adds nothing). Its edges are smoothed by how far each pixel is inside them
  const side = Math.ceil(TRIANGLE * 2 * scale)
  const image = new ImageData(side, side)
  const { pure, white, black } = triangleCorners(hsv.h, TRIANGLE * scale)
  const [red, green, blue] = hsvToRgb({ h: hsv.h, s: 1, v: 1 })
  const height = 1.5 * TRIANGLE * scale // from a corner to the side across from it
  const area = (white.y - black.y) * (pure.x - black.x) + (black.x - white.x) * (pure.y - black.y)
  for (let py = 0; py < side; py++) {
    const y = py + 0.5 - side / 2
    for (let px = 0; px < side; px++) {
      const x = px + 0.5 - side / 2
      const a = ((white.y - black.y) * (x - black.x) + (black.x - white.x) * (y - black.y)) / area
      const b = ((black.y - pure.y) * (x - black.x) + (pure.x - black.x) * (y - black.y)) / area
      const c = 1 - a - b
      const coverage = Math.min(1, Math.max(0, Math.min(a, b, c) * height + 0.5))
      if (coverage === 0) continue
      const ca = Math.max(0, a)
      const cb = Math.max(0, b)
      const i = (py * side + px) * 4
      image.data[i] = ca * red + cb * 255
      image.data[i + 1] = ca * green + cb * 255
      image.data[i + 2] = ca * blue + cb * 255
      image.data[i + 3] = coverage * 255
    }
  }
  const triangle = document.createElement('canvas')
  triangle.width = side
  triangle.height = side
  triangle.getContext('2d')!.putImageData(image, 0, 0)
  ctx.drawImage(triangle, middle - side / scale / 2, middle - side / scale / 2, side / scale, side / scale)

  // The marks: a circle on the ring at the hue, and one in the triangle at the color, white with a black edge
  const mark = (x: number, y: number, radius: number) => {
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.lineWidth = 3
    ctx.strokeStyle = '#000'
    ctx.stroke()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#fff'
    ctx.stroke()
  }
  const angle = (hsv.h * Math.PI) / 180
  const onRing = (INNER + OUTER) / 2
  mark(middle + onRing * Math.cos(angle), middle - onRing * Math.sin(angle), RING / 2 - 1)
  const shade = trianglePoint(hsv.h, hsv.s, hsv.v, TRIANGLE)
  mark(middle + shade.x, middle + shade.y, 5)
}
