import { useEffect, useRef, useState } from 'react'
import type { Point, Project, Stroke, Tool } from '../drawing/types'
import { createCanvas, drawStroke, drawStrokes } from '../drawing/render'
import { downloadBlob, renderPng } from '../drawing/file'
import { PROJECT_EXTENSION, serializeProject } from '../drawing/projectFile'
import { Toolbar } from '../components/Toolbar'

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

const MAX_CANVAS_PIXELS = 8192 * 8192 // per canvas; much more than this and the browser may run out of memory

// Physical pixels per CSS pixel (2 on Retina screens), limited so the canvas never gets too big
function getCanvasScale(width: number, height: number) {
  const dpr = window.devicePixelRatio || 1
  const maxScale = Math.sqrt(MAX_CANVAS_PIXELS / (width * height))
  return Math.min(dpr, maxScale)
}

// Show the finished strokes (already drawn on the committed canvas) and, on top, the stroke in progress
function paint(canvas: HTMLCanvasElement, committed: HTMLCanvasElement, dpr: number, stroke: Stroke | null) {
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(1, 0, 0, 1, 0, 0) // the committed canvas already has the same size in real pixels: copy it 1:1
  ctx.globalCompositeOperation = 'source-over' // the last stroke drawn may have left the eraser mode on
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(committed, 0, 0)

  if (stroke) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawStroke(ctx, stroke)
  }
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
  const committedCanvas = useRef<HTMLCanvasElement | null>(null) // off-screen canvas with the finished strokes already drawn
  const committedStrokes = useRef<Stroke[] | null>(null) // the list of strokes the committed canvas is showing
  const [tool, setTool] = useState<Tool>('brush')
  const [color, setColor] = useState('#000000')
  const [size, setSize] = useState(4)
  const dpr = getCanvasScale(project.width, project.height) // physical pixels per CSS pixel, limited to save memory

  // Keep the committed canvas in sync with the list of strokes, then show it
  useEffect(() => {
    const canvas = canvasRef.current!

    // (Re)create the committed canvas when it does not exist yet or the screen density changed its size
    let committed = committedCanvas.current
    if (!committed || committed.width !== canvas.width || committed.height !== canvas.height) {
      committed = createCanvas(canvas.width, canvas.height)
      committedCanvas.current = committed
      committedStrokes.current = null // the new canvas is empty, so it must be redrawn
    }

    // Redraw everything only when the strokes changed in a way that can't be drawn on top (undo, clear...)
    if (committedStrokes.current !== strokes) {
      drawStrokes(getScaledContext(committed, dpr), strokes)
      committedStrokes.current = strokes
    }

    paint(canvas, committed, dpr, null)
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
    paint(canvasRef.current!, committedCanvas.current!, dpr, stroke)
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return // only the main button draws (left click, pen tip, touch)
    if (activePointerId.current !== null) return // already drawing with another pointer
    activePointerId.current = e.pointerId

    const rect = e.currentTarget.getBoundingClientRect()
    const newStroke: Stroke = { tool, color, width: size, points: [getPosition(rect, e)] }
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

    // Add only the new stroke to the committed canvas, instead of redrawing all of them
    drawStroke(getScaledContext(committedCanvas.current!, dpr), stroke)
    const nextStrokes = [...strokes, stroke]
    committedStrokes.current = nextStrokes // tell the effect that the committed canvas is already up to date
    setStrokes(nextStrokes)
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
      <Toolbar tool={tool} color={color} size={size} onToolChange={setTool} onColorChange={setColor} onSizeChange={setSize} />
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
