import type { Stroke } from './types'

// Draw a single stroke on the canvas
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const [first, ...rest] = stroke.points
  if (!first) return // Empty stroke, nothing to draw

  ctx.strokeStyle = stroke.color
  ctx.fillStyle = stroke.color
  ctx.lineWidth = stroke.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // A single point (click without dragging) has no line, so draw a dot
  if (rest.length === 0) {
    ctx.beginPath()
    ctx.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }

  ctx.beginPath()
  ctx.moveTo(first.x, first.y)

  // Curve through the midpoints between points, using each point as a control point.
  // This turns the polygon into a smooth line.
  for (let i = 0; i < rest.length - 1; i++) {
    const control = rest[i]
    const next = rest[i + 1]
    const midX = (control.x + next.x) / 2
    const midY = (control.y + next.y) / 2
    ctx.quadraticCurveTo(control.x, control.y, midX, midY)
  }

  // Finish with a straight line to the last point
  const last = rest[rest.length - 1]
  ctx.lineTo(last.x, last.y)

  ctx.stroke()
}

// Clear the whole canvas, paint the background (null = transparent) and draw a list of strokes
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], background: string | null = null) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  }
  for (const stroke of strokes) {
    drawStroke(ctx, stroke)
  }
}
