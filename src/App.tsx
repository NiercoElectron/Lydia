import { useEffect, useRef, useState } from 'react'
import type { Point, Stroke } from './drawing/types'
import { drawStrokes } from './drawing/render'
import './App.css'
import { exportPng } from './drawing/file'

const WIDTH = 800
const HEIGHT = 600

// Current local date and time for file names, e.g. "2026-10-19_14-32-05"
function timestamp() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const currentStroke = useRef<Stroke | null>(null) // stroke being drawn right now, null when not drawing
  const [strokes, setStrokes] = useState<Stroke[]>([]) // finished strokes

  // Redraw the canvas every time the list of strokes changes (new stroke, undo, clear...)
  useEffect(() => {
    const ctx = canvasRef.current!.getContext('2d')!
    drawStrokes(ctx, strokes)
  }, [strokes])

  // Undo with Ctrl+Z (Windows/Linux) or Cmd+Z (macOS)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z'
      if (!isUndo) return
      e.preventDefault()
      setStrokes(prev => prev.slice(0, -1))
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Convert a pointer position (relative to the window) into canvas coordinates
  function getPosition(rect: DOMRect, e: { clientX: number; clientY: number }): Point {
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // Draw the finished strokes plus the one in progress
  function drawWithCurrent(stroke: Stroke) {
    const ctx = canvasRef.current!.getContext('2d')!
    drawStrokes(ctx, [...strokes, stroke])
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const newStroke: Stroke = { color: '#000000', width: 4, points: [getPosition(rect, e)] }
    currentStroke.current = newStroke
    drawWithCurrent(newStroke)
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
    drawWithCurrent(stroke)
  }

  function handlePointerUp() {
    const stroke = currentStroke.current
    if (!stroke) return
    setStrokes(prev => [...prev, stroke])
    currentStroke.current = null
  }

  function handleUndo() {
    setStrokes(prev => prev.slice(0, -1)) // new array without the last stroke
  }

  function handleClear() {
    setStrokes([])
    currentStroke.current = null // drop any stroke in progress
  }

  function handleExport() {
    exportPng(strokes, WIDTH, HEIGHT, `lydia-${timestamp()}.png`)
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
      <button onClick={handleUndo} disabled={strokes.length === 0}>Undo</button>
      <button onClick={handleClear}>Clear</button>
      <button onClick={handleExport} disabled={strokes.length === 0}>Export PNG</button>
    </>
  )
}

export default App
