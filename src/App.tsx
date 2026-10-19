import { useRef, useState } from 'react'
import type { Point, Stroke } from './drawing/types'
import { drawStroke } from './drawing/render'
import './App.css'

const WIDTH = 800
const HEIGHT = 600

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const currentStroke = useRef<Stroke | null>(null) // stroke being drawn right now, null when not drawing
  const [strokes, setStrokes] = useState<Stroke[]>([]) // finished strokes

  // Convert a pointer position (relative to the window) into canvas coordinates
  function getPosition(rect: DOMRect, e: { clientX: number; clientY: number }): Point {
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // Clear the canvas and draw all finished strokes plus the one in progress
  function drawAll() {
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    for (const stroke of strokes) {
      drawStroke(ctx, stroke)
    }
    if (currentStroke.current) {
      drawStroke(ctx, currentStroke.current)
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    currentStroke.current = { color: '#000000', width: 4, points: [getPosition(rect, e)] }
    drawAll()
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const stroke = currentStroke.current
    if (!stroke) return // pointer is just hovering, not drawing

    const rect = e.currentTarget.getBoundingClientRect()
    // The browser groups fast movements into one event; get all the points in between
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
    for (const ev of events) {
      stroke.points.push(getPosition(rect, ev))
    }
    drawAll()
  }

  function handlePointerUp() {
    const stroke = currentStroke.current
    if (!stroke) return
    setStrokes(prev => [...prev, stroke])
    currentStroke.current = null
  }

    function handleClear() {
    setStrokes([])               // empty the data (takes effect on the next render)
    currentStroke.current = null // drop any stroke in progress
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.clearRect(0, 0, WIDTH, HEIGHT)
  }


  return (
    <>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{ border: '1px solid #ccc', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <button onClick={handleClear}>Clear</button>
    </>
  )
}

export default App
