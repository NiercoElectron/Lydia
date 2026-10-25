import { useEffect, useRef, useState } from 'react'
import type { BrushShape } from '../engine/brushFile'
import type { BrushTip } from '../engine/brushTip'
import type { StrokePoint } from '../engine/dabs'
import { createPreviewSurface, sampleWave, type PreviewSurface } from '../engine/previewSurface'
import { SliderValue } from './SliderValue'

const WIDTH = 280
const HEIGHT = 200
const MIN_SIZE = 4
const MAX_SIZE = 120

type Props = {
  tip: BrushTip | null // null while there is no tip to try
  shape: BrushShape
}

// A place to try a brush while it is being made. It starts with a sample stroke, and every stroke drawn on it is
// painted again whenever the brush changes, to compare
export function BrushTestArea({ tip, shape }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState(40)
  const [clears, setClears] = useState(0) // goes up when the area is cleared, to paint it again
  const [surface, setSurface] = useState<PreviewSurface | null>(null)
  const strokes = useRef<StrokePoint[][]>([sampleWave(WIDTH, HEIGHT, 30)])
  // The stroke being drawn right now: its pointer and its points so far
  const drawing = useRef<{ pointerId: number; points: StrokePoint[] } | null>(null)

  // Its own place to paint on (see previewSurface.ts), freed when the area goes away
  useEffect(() => {
    let cancelled = false
    let made: PreviewSurface | null = null
    createPreviewSurface().then(created => {
      if (cancelled) {
        created.destroy()
      } else {
        made = created
        setSurface(created)
      }
    })
    return () => {
      cancelled = true
      made?.destroy()
    }
  }, [])

  // Pixels of the canvas for each unit of the area
  const unit = () => canvasRef.current!.width / WIDTH

  useEffect(() => {
    const canvas = canvasRef.current
    if (!surface || !canvas) return
    surface.setSize(canvas.width, canvas.height)
    if (tip) for (const points of strokes.current) surface.paintStroke(tip, shape, size, points, unit())
    surface.copyTo(canvas)
  }, [surface, tip, shape, size, clears])

  // A point of the area, from where the pointer is. A mouse always paints at full pressure
  function pointOf(e: PointerEvent): StrokePoint {
    const box = canvasRef.current!.getBoundingClientRect()
    return {
      x: ((e.clientX - box.left) * WIDTH) / box.width,
      y: ((e.clientY - box.top) * HEIGHT) / box.height,
      pressure: e.pointerType === 'pen' ? e.pressure : 1,
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!tip || !surface || e.button !== 0 || drawing.current) return
    e.currentTarget.setPointerCapture(e.pointerId) // keep receiving the moves even outside the area
    const point = pointOf(e.nativeEvent)
    drawing.current = { pointerId: e.pointerId, points: [point] }
    surface.startStroke(tip, shape, size, point, unit())
    surface.copyTo(e.currentTarget)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const stroke = drawing.current
    if (!stroke || stroke.pointerId !== e.pointerId || !surface) return
    // The browser groups fast movements into one event; get all the points in between
    const events = e.nativeEvent.getCoalescedEvents?.() ?? []
    const points = (events.length > 0 ? events : [e.nativeEvent]).map(pointOf)
    stroke.points.push(...points)
    surface.continueStroke(points)
    surface.copyTo(e.currentTarget)
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const stroke = drawing.current
    if (!stroke || stroke.pointerId !== e.pointerId) return
    surface?.endStroke()
    surface?.copyTo(e.currentTarget)
    strokes.current.push(stroke.points)
    drawing.current = null
  }

  function handleClear() {
    strokes.current = []
    setClears(n => n + 1)
  }

  const pixelRatio = window.devicePixelRatio || 1
  return (
    <div className="test-area">
      {!tip && <p className="hint">Paint the tip on the paper to try the brush here.</p>}
      <canvas
        ref={canvasRef}
        className="test-canvas"
        width={Math.round(WIDTH * pixelRatio)}
        height={Math.round(HEIGHT * pixelRatio)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <div className="test-controls">
        <label>
          Size
          <input
            type="range"
            min={MIN_SIZE}
            max={MAX_SIZE}
            value={size}
            onChange={e => setSize(Number(e.target.value))}
          />
          <SliderValue value={size} min={MIN_SIZE} max={MAX_SIZE} onChange={setSize} />
        </label>
        <button onClick={handleClear}>Clear</button>
      </div>
    </div>
  )
}
