import { useEffect, useRef, useState } from 'react'
import type { Point, Project, Stroke } from '../drawing/types'
import { drawStrokes } from '../drawing/render'
import { downloadBlob, renderPng } from '../drawing/file'
import { PROJECT_EXTENSION, serializeProject } from '../drawing/projectFile'

// Current local date and time for file names, e.g. "2026-10-19_14-32-05"
function timestamp() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
}

// Get the 2D context, scaled so that 1 unit = 1 CSS pixel on any screen density
function getScaledContext(canvas: HTMLCanvasElement, dpr: number) {
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}

type Props = {
  project: Project
  onBack: () => void
}

export function Editor({ project, onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const currentStroke = useRef<Stroke | null>(null) // stroke being drawn right now, null when not drawing
  const [strokes, setStrokes] = useState<Stroke[]>(project.strokes) // finished strokes
  const activePointerId = useRef<number | null>(null) // pointer that started the current stroke
  const dpr = window.devicePixelRatio || 1 // physical pixels per CSS pixel (2 on Retina screens)

  // Redraw the canvas every time the list of strokes changes (new stroke, undo, clear...)
  useEffect(() => {
    const ctx = getScaledContext(canvasRef.current!, dpr)
    drawStrokes(ctx, strokes)
  }, [strokes, dpr])

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
    const ctx = getScaledContext(canvasRef.current!, dpr)
    drawStrokes(ctx, [...strokes, stroke])
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return // only the main button draws (left click, pen tip, touch)
    if (activePointerId.current !== null) return // already drawing with another pointer
    activePointerId.current = e.pointerId

    const rect = e.currentTarget.getBoundingClientRect()
    const newStroke: Stroke = { color: '#000000', width: 4, points: [getPosition(rect, e)] }
    currentStroke.current = newStroke
    drawWithCurrent(newStroke)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerId !== activePointerId.current) return // ignore other pointers (second finger, palm)

    const stroke = currentStroke.current
    if (!stroke) return // should not happen, but tells TypeScript that stroke is not null

    const rect = e.currentTarget.getBoundingClientRect()
    // The browser groups fast movements into one event; get all the points in between
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
    for (const ev of events) {
      stroke.points.push(getPosition(rect, ev))
    }
    drawWithCurrent(stroke)
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerId !== activePointerId.current) return // ignore other pointers
    activePointerId.current = null // free the slot for the next stroke

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
    activePointerId.current = null
  }

  async function handleExport() {
    try {
      const blob = await renderPng(strokes, project.width, project.height)
      downloadBlob(blob, `lydia-${timestamp()}.png`)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not export the image.')
    }
  }

    function handleSave() {
      const text = serializeProject({ ...project, strokes })
      const blob = new Blob([text], { type: 'application/json' })
      downloadBlob(blob, `lydia-${timestamp()}${PROJECT_EXTENSION}`)
  }

    function handleBack() {
    if (strokes.length > 0 && !window.confirm('Discard this drawing and go back to the start screen?')) return
    onBack()
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        width={Math.round(project.width * dpr)}
        height={Math.round(project.height * dpr)}
        style={{ width: project.width, height: project.height, border: '1px solid #ccc', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <button onClick={handleUndo} disabled={strokes.length === 0}>Undo</button>
      <button onClick={handleClear}>Clear</button>
      <button onClick={handleExport} disabled={strokes.length === 0}>Export PNG</button>
      <button onClick={handleBack}>Back</button>
      <button onClick={handleSave}>Save</button>
    </>
  )
}