import { useEffect, useRef } from 'react'
import type { BrushShape } from '../engine/brushFile'
import type { BrushTip } from '../engine/brushTip'
import { drawStroke, resetCanvas, sampleWave } from './dabCanvas'

const WIDTH = 160
const HEIGHT = 44
const SIZE = HEIGHT * 0.5 // the brush size of the sample stroke

type Props = {
  tip: Promise<BrushTip>
  shape: BrushShape
}

// A sample stroke of a brush, painted with the same dabs the brush would paint on the drawing
export function BrushPreview({ tip, shape }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    tip.then(
      decoded => {
        if (cancelled || !canvasRef.current) return
        const ctx = resetCanvas(canvasRef.current, WIDTH, HEIGHT)
        drawStroke(ctx, decoded, shape, SIZE, sampleWave(WIDTH, HEIGHT, SIZE * 0.6))
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
