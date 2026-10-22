import { useEffect, useRef } from 'react'
import type { BrushShape } from '../engine/brushFile'
import type { BrushTip } from '../engine/brushTip'
import { createDabPath, type StrokePoint } from '../engine/dabs'

const WIDTH = 160
const HEIGHT = 44
const STEPS = 60 // points along the sample stroke

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

// A sample stroke: a wave pressed lightly at the ends and harder in the middle, painted with the same dabs the brush
// would paint on the drawing
function drawSampleStroke(canvas: HTMLCanvasElement, tip: BrushTip, shape: BrushShape) {
  const ctx = canvas.getContext('2d')!
  const scale = canvas.width / WIDTH
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.clearRect(0, 0, WIDTH, HEIGHT)
  ctx.imageSmoothingQuality = 'high'

  const size = HEIGHT * 0.5
  const margin = size * 0.6
  const points: StrokePoint[] = []
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS
    points.push({
      x: margin + t * (WIDTH - 2 * margin),
      y: HEIGHT / 2 + Math.sin(t * Math.PI * 2) * HEIGHT * 0.18,
      pressure: 0.3 + 0.7 * Math.sin(t * Math.PI),
    })
  }
  const path = createDabPath(shape, size)
  const dabs = [...path.start(points[0]), ...path.moveTo(points.slice(1)), ...path.end()]

  const image = blackTip(tip)
  const side = Math.max(image.width, image.height)
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

type Props = {
  tip: Promise<BrushTip>
  shape: BrushShape
}

export function BrushPreview({ tip, shape }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    tip.then(
      decoded => {
        if (!cancelled && canvasRef.current) drawSampleStroke(canvasRef.current, decoded, shape)
      },
      () => {}, // a tip that can't be decoded shows no stroke; choosing the brush says why
    )
    return () => {
      cancelled = true
    }
  }, [tip, shape])

  const pixelRatio = window.devicePixelRatio || 1
  return (
    <canvas
      ref={canvasRef}
      className="brush-preview"
      width={Math.round(WIDTH * pixelRatio)}
      height={Math.round(HEIGHT * pixelRatio)}
    />
  )
}
