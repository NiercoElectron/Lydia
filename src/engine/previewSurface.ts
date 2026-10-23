import { autoDetectRenderer, Container, RenderTexture, Sprite, type WebGLRenderer } from 'pixi.js'
import type { BrushShape } from './brushFile'
import type { BrushTip } from './brushTip'
import { createDabPainter, type DabPainter } from './dabPainter'
import { createDabPath, type Dab, type DabPath, type StrokePoint } from './dabs'

// The brush previews (the sample strokes of the brush list, the Brush Designer's test area) are painted by the
// graphics card with the same code as the drawing (dabPainter.ts), each stroke in a texture of its own as on the
// drawing, and copied to their canvases in black. They share one small renderer, started for the first preview

let sharedRenderer: Promise<WebGLRenderer> | null = null

function previewRenderer() {
  sharedRenderer ??= autoDetectRenderer({
    preference: 'webgl',
    width: 1,
    height: 1,
    backgroundAlpha: 0,
  }) as Promise<WebGLRenderer>
  return sharedRenderer
}

// A place to paint strokes on, like a tiny drawing with one layer, copied to a canvas of the same size in pixels
export async function createPreviewSurface() {
  const renderer = await previewRenderer()
  let width = 1
  let height = 1
  let painted = RenderTexture.create({ width, height }) // the finished strokes
  let stroke = RenderTexture.create({ width, height }) // the stroke being painted
  let shown = RenderTexture.create({ width, height }) // both together, to be copied
  const nothing = new Container()
  const strokeRoot = new Container() // the stroke alone, to be put with the finished strokes
  const strokeSprite = new Sprite(stroke)
  strokeRoot.addChild(strokeSprite)
  const shownRoot = new Container()
  const paintedSprite = new Sprite(painted)
  const shownStrokeSprite = new Sprite(stroke)
  shownRoot.addChild(paintedSprite, shownStrokeSprite)
  let painter: DabPainter | null = null
  let path: DabPath | null = null
  let unit = 1 // pixels for each unit of the strokes

  const clearTexture = (texture: RenderTexture) =>
    renderer.render({ container: nothing, target: texture, clear: true, clearColor: [0, 0, 0, 0] })

  // Make it this many pixels, and empty
  function setSize(newWidth: number, newHeight: number) {
    if (newWidth !== width || newHeight !== height) {
      const old = [painted, stroke, shown]
      width = newWidth
      height = newHeight
      painted = RenderTexture.create({ width, height })
      stroke = RenderTexture.create({ width, height })
      shown = RenderTexture.create({ width, height })
      paintedSprite.texture = painted
      strokeSprite.texture = stroke
      shownStrokeSprite.texture = stroke
      for (const texture of old) texture.destroy(true)
    }
    clear()
  }

  function clear() {
    clearTexture(painted)
    clearTexture(stroke)
  }

  // The dabs, from units of the strokes to pixels
  const inPixels = (dabs: Dab[]) =>
    unit === 1 ? dabs : dabs.map(dab => ({ ...dab, x: dab.x * unit, y: dab.y * unit, size: dab.size * unit }))

  function paintDabs(dabs: Dab[]) {
    if (dabs.length > 0) painter!.paint(stroke, inPixels(dabs), 0, 0)
  }

  // Start a stroke with this brush at this point. "size" and the points are in units of "pixels" pixels each (pixel
  // brushes are only previewed at one pixel each)
  function startStroke(tip: BrushTip, shape: BrushShape, size: number, point: StrokePoint, pixels: number) {
    if (painter) painter.setTip(tip, shape)
    else painter = createDabPainter(renderer, tip, shape)
    unit = pixels
    clearTexture(stroke)
    path = createDabPath(shape, size)
    paintDabs(path.start(point))
  }

  function continueStroke(points: StrokePoint[]) {
    if (path) paintDabs(path.moveTo(points))
  }

  function endStroke() {
    if (!path) return
    paintDabs(path.end())
    path = null
    renderer.render({ container: strokeRoot, target: painted, clear: false })
    clearTexture(stroke)
  }

  // A whole stroke at once
  function paintStroke(tip: BrushTip, shape: BrushShape, size: number, points: StrokePoint[], pixels: number) {
    if (points.length === 0) return
    startStroke(tip, shape, size, points[0], pixels)
    continueStroke(points.slice(1))
    endStroke()
  }

  // Copy everything painted so far, with the stroke being painted, to a canvas of the same size, in black
  function copyTo(canvas: HTMLCanvasElement) {
    renderer.render({ container: shownRoot, target: shown, clear: true, clearColor: [0, 0, 0, 0] })
    const { pixels } = renderer.extract.pixels(shown)
    const image = new ImageData(width, height)
    for (let i = 3; i < image.data.length; i += 4) image.data[i] = pixels[i]
    canvas.getContext('2d')!.putImageData(image, 0, 0)
  }

  function destroy() {
    painter?.destroy()
    strokeRoot.destroy({ children: true })
    shownRoot.destroy({ children: true })
    for (const texture of [painted, stroke, shown]) texture.destroy(true)
  }

  return { setSize, clear, startStroke, continueStroke, endStroke, paintStroke, copyTo, destroy }
}

export type PreviewSurface = Awaited<ReturnType<typeof createPreviewSurface>>

let sampleSurface: Promise<PreviewSurface> | null = null

// Paint one stroke alone on a canvas, as a sample of a brush. "size" and the points are in units of the canvas,
// "width" of them across it
export async function paintSample(
  canvas: HTMLCanvasElement,
  width: number,
  tip: BrushTip,
  shape: BrushShape,
  size: number,
  points: StrokePoint[],
) {
  sampleSurface ??= createPreviewSurface()
  const surface = await sampleSurface
  surface.setSize(canvas.width, canvas.height)
  surface.paintStroke(tip, shape, size, points, canvas.width / width)
  surface.copyTo(canvas)
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
