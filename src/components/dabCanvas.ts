import type { BrushShape } from '../engine/brushFile'
import type { BrushTip } from '../engine/brushTip'
import { createDabPath, type Dab, type StrokePoint } from '../engine/dabs'

// Drawing brush strokes on an ordinary canvas, in black, for the brush previews and the Brush Designer's test area.
// The dabs are placed by the same code as on the drawing (dabs.ts)

// Each tip in black, made the first time it is drawn
const blackTips = new WeakMap<BrushTip, HTMLCanvasElement>()

function blackTip(tip: BrushTip) {
  let black = blackTips.get(tip)
  if (!black) {
    black = document.createElement('canvas')
    black.width = tip.image.width
    black.height = tip.image.height
    const ctx = black.getContext('2d')!
    ctx.drawImage(tip.image, 0, 0)
    ctx.globalCompositeOperation = 'source-in' // keep the alpha of the tip, with black instead of white
    ctx.fillRect(0, 0, black.width, black.height)
    blackTips.set(tip, black)
  }
  return black
}

export function drawDabs(ctx: CanvasRenderingContext2D, tip: BrushTip, dabs: Dab[]) {
  const image = blackTip(tip)
  const side = Math.max(image.width, image.height)
  ctx.imageSmoothingQuality = 'high'
  for (const dab of dabs) {
    const width = (image.width * dab.size) / side
    const height = (image.height * dab.size) / side
    ctx.save()
    ctx.translate(dab.x, dab.y)
    ctx.rotate(dab.angle)
    ctx.globalAlpha = dab.alpha
    ctx.drawImage(image, -width / 2, -height / 2, width, height)
    ctx.restore()
  }
}

// A whole stroke through these points. "size" is the brush size at full pressure
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  tip: BrushTip,
  shape: BrushShape,
  size: number,
  points: StrokePoint[],
) {
  if (points.length === 0) return
  const path = createDabPath(shape, size)
  drawDabs(ctx, tip, [...path.start(points[0]), ...path.moveTo(points.slice(1)), ...path.end()])
}

// A sample stroke across a box: a wave pressed lightly at the ends and harder in the middle, like a pen
export function sampleWave(width: number, height: number, margin: number): StrokePoint[] {
  const steps = 60
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    return {
      x: margin + t * (width - 2 * margin),
      y: height / 2 + Math.sin(t * Math.PI * 2) * height * 0.18,
      pressure: 0.3 + 0.7 * Math.sin(t * Math.PI),
    }
  })
}

// Clear a canvas and scale its drawing so that "width" and "height" are in CSS pixels: sharp on any screen
export function resetCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const ctx = canvas.getContext('2d')!
  const scale = canvas.width / width
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.clearRect(0, 0, width, height)
  return ctx
}
