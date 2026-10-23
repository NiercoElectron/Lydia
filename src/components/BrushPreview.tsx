import { useEffect, useRef } from 'react'
import type { BrushShape } from '../engine/brushFile'
import type { BrushTip } from '../engine/brushTip'
import { paintSample, sampleWave } from '../engine/previewSurface'

const WIDTH = 160
const HEIGHT = 44
const SIZE = HEIGHT * 0.5 // the brush size of the sample stroke
// A pixel brush's sample stroke is painted 4 times smaller and shown 4 times bigger, so that its pixels show
const PIXEL_ZOOM = 4

type Props = {
  tip: Promise<BrushTip>
  shape: BrushShape
}

// A sample stroke of a brush, painted with the same dabs the brush would paint on the drawing
export function BrushPreview({ tip, shape }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const zoom = shape.pixel === 'none' ? 1 : PIXEL_ZOOM

  useEffect(() => {
    let cancelled = false
    tip.then(
      decoded => {
        const canvas = canvasRef.current
        if (cancelled || !canvas) return
        const [width, height, size] = [WIDTH / zoom, HEIGHT / zoom, SIZE / zoom]
        void paintSample(canvas, width, decoded, shape, size, sampleWave(width, height, size * 0.6))
      },
      () => {}, // a tip that can't be decoded shows no stroke; choosing the brush says why
    )
    return () => {
      cancelled = true
    }
  }, [tip, shape, zoom])

  // A smooth stroke uses every pixel of the screen, to be sharp. A pixel brush's canvas has one pixel for each pixel
  // of its stroke, which the screen shows as squares
  const scale = zoom === 1 ? window.devicePixelRatio || 1 : 1 / zoom
  return (
    <canvas
      ref={canvasRef}
      className={zoom === 1 ? 'brush-preview' : 'brush-preview pixelated'}
      width={Math.round(WIDTH * scale)}
      height={Math.round(HEIGHT * scale)}
    />
  )
}
