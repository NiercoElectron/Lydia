import { useEffect, useRef, useState } from 'react'
import type { BrushShape } from '../engine/brushFile'
import type { BrushTip } from '../engine/brushTip'
import { createDabPath, type DabPath, type StrokePoint } from '../engine/dabs'
import { drawDabs, drawStroke, resetCanvas, sampleWave } from './dabCanvas'

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
  const strokes = useRef<StrokePoint[][]>([sampleWave(WIDTH, HEIGHT, 30)])
  // The stroke being drawn right now: its pointer, where its dabs go, and its points so far
  const drawing = useRef<{ pointerId: number; path: DabPath; points: StrokePoint[] } | null>(null)

  useEffect(() => {
    const ctx = resetCanvas(canvasRef.current!, WIDTH, HEIGHT)
    if (tip) for (const points of strokes.current) drawStroke(ctx, tip, shape, size, points)
  }, [tip, shape, size, clears])

  // A point of the area, from where the pointer is. A mouse always paints at full pressure
  function pointOf(e: PointerEvent): StrokePoint {
    const box = canvasRef.current!.getBoundingClientRect()
    return {
      x: ((e.clientX - box.left) * WIDTH) / box.width,
      y: ((e.clientY - box.top) * HEIGHT) / box.height,
      pressure: e.pointerType === 'pen' ? e.pressure : 1,
    }
  }

  const context = () => canvasRef.current!.getContext('2d')!

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!tip || e.button !== 0 || drawing.current) return
    e.currentTarget.setPointerCapture(e.pointerId) // keep receiving the moves even outside the area
    const point = pointOf(e.nativeEvent)
    const path = createDabPath(shape, size)
    drawing.current = { pointerId: e.pointerId, path, points: [point] }
    drawDabs(context(), tip, path.start(point))
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const stroke = drawing.current
    if (!stroke || stroke.pointerId !== e.pointerId || !tip) return
    // The browser groups fast movements into one event; get all the points in between
    const events = e.nativeEvent.getCoalescedEvents?.() ?? []
    const points = (events.length > 0 ? events : [e.nativeEvent]).map(pointOf)
    stroke.points.push(...points)
    drawDabs(context(), tip, stroke.path.moveTo(points))
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const stroke = drawing.current
    if (!stroke || stroke.pointerId !== e.pointerId) return
    if (tip) drawDabs(context(), tip, stroke.path.end())
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
          <span className="slider-value">{size}</span>
        </label>
        <button onClick={handleClear}>Clear</button>
      </div>
    </div>
  )
}
