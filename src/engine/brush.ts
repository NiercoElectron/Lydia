import { Container, RenderTexture, Sprite } from 'pixi.js'
import type { WebGLRenderer } from 'pixi.js'
import type { BrushShape } from './brushFile'
import type { BrushTip } from './brushTip'
import { createDabPainter } from './dabPainter'
import { createDabPath, NO_TAPER, type Dab, type DabPath, type StrokePoint, type TaperSettings } from './dabs'
import type { GpuTiles } from './gpuTiles'
import type { History } from './history'
import type { LayerStack } from './layers'
import { noiseReach } from './noiseDabs'
import type { Projection, ShownStroke } from './projection'
import { parseTileKey, TILE_SIZE, tileKey, tilesInRect, tileSize, type Grid } from './tiles'
import type { PaintTool } from './tools'

export type BrushSettings = {
  tool: PaintTool
  color: string
  size: number // the tip's longer side, in pixels of the paper, at full pressure
  opacity: number // how much the whole stroke covers, from 0 to 1
  taper: TaperSettings // how the stroke's ends thin out (see dabs.ts)
}

// The selection, as the brush sees it (see selectionView.ts): whether a tile can be painted at all, and cutting a
// stroke's tile to the selected part of it
export type StrokeCutter = {
  canPaint: (key: string) => boolean
  cut: (strokeTexture: RenderTexture, key: string) => void
}

// Tiles of finished strokes kept for the next ones, instead of creating and deleting textures at every stroke
const SPARE_STROKE_TILES = 64
const DEGREES = Math.PI / 180

export function createBrush(
  renderer: WebGLRenderer,
  grid: Grid,
  stack: LayerStack,
  gpu: GpuTiles,
  projection: Projection,
  history: History,
  startTip: BrushTip,
  startShape: BrushShape,
  selection: StrokeCutter,
) {
  const settings: BrushSettings = { tool: 'brush', color: '#000000', size: 20, opacity: 1, taper: NO_TAPER }
  let tip = startTip
  let shape = startShape
  const painter = createDabPainter(renderer, tip, shape)

  // The stroke being painted goes into tiles of its own first, white, with the paint in their alpha. Only when it ends
  // is it put into the layer, with the color and the opacity of the stroke (or taken out of it, with the eraser), so
  // that a stroke never covers more than its opacity, however many times it passes over a place. Meanwhile the
  // projection shows the layer with the stroke on it
  const strokeTiles = new Map<string, RenderTexture>()
  const spareStrokeTiles: RenderTexture[] = []
  const nothing = new Container()
  // PixiJS ignores the blend mode of what it is asked to render, so the stroke's sprite goes inside a container
  const mergeRoot = new Container()
  const mergeSprite = new Sprite()
  mergeRoot.addChild(mergeSprite)
  let stroke: ShownStroke | null = null

  function strokeTile(key: string, column: number, row: number) {
    let strokeTexture = strokeTiles.get(key)
    if (strokeTexture) return strokeTexture
    const { width, height } = tileSize(grid, column, row)
    const isFull = width === TILE_SIZE && height === TILE_SIZE
    strokeTexture = (isFull && spareStrokeTiles.pop()) || RenderTexture.create({ width, height })
    renderer.render({ container: nothing, target: strokeTexture, clear: true, clearColor: [0, 0, 0, 0] })
    strokeTiles.set(key, strokeTexture)
    return strokeTexture
  }

  // Put the finished stroke into the active layer, tile by tile, keeping each tile's pixels for undo first. The
  // projection already shows these tiles as they now are
  function mergeStroke(shown: ShownStroke) {
    const layer = stack.active
    mergeSprite.tint = shown.color
    mergeSprite.alpha = shown.opacity
    mergeSprite.blendMode = shown.erase ? 'erase' : 'normal'
    for (const [key, strokeTexture] of strokeTiles) {
      const { column, row } = parseTileKey(key)
      // The eraser has nothing to take away where the layer has no paint, and mustn't leave an empty tile there
      if (!shown.erase || gpu.getTexture(layer, column, row, false)) {
        history.backUpTile(key)
        mergeSprite.texture = strokeTexture
        renderer.render({ container: mergeRoot, target: gpu.getTexture(layer, column, row, true)!, clear: false })
        gpu.markDirty(layer, key)
      }
      const isFull = strokeTexture.width === TILE_SIZE && strokeTexture.height === TILE_SIZE
      if (isFull && spareStrokeTiles.length < SPARE_STROKE_TILES) spareStrokeTiles.push(strokeTexture)
      else strokeTexture.destroy(true)
    }
    strokeTiles.clear()
  }

  // Paint with another brush from now on
  function setTip(newTip: BrushTip, newShape: BrushShape) {
    tip = newTip
    shape = newShape
    painter.setTip(tip, shape)
  }

  // Which dabs touch each tile ("column,row" -> its dabs, in the order they were placed)
  function dabsByTile(dabs: Dab[]) {
    const isPixel = shape.pixel !== 'none'
    const byTile = new Map<string, Dab[]>()
    for (const dab of dabs) {
      // A pixel tip is a square that never turns; drops of noise can stick out of the tip a little
      const radius = isPixel ? dab.size / 2 : dab.size * (tip.reach / 2 + noiseReach(shape))
      const area = tilesInRect(grid, dab.x - radius, dab.y - radius, dab.x + radius, dab.y + radius)
      if (!area) continue // the dab is entirely outside the paper
      for (let column = area.firstColumn; column <= area.lastColumn; column++) {
        for (let row = area.firstRow; row <= area.lastRow; row++) {
          const key = tileKey(column, row)
          let tileDabs = byTile.get(key)
          if (!tileDabs) {
            tileDabs = []
            byTile.set(key, tileDabs)
          }
          tileDabs.push(dab)
        }
      }
    }
    return byTile
  }

  // Paint into each touched tile of the stroke only the dabs that touch it, shifted so that the tile's corner is at
  // (0, 0), and keep only what is selected. "fresh": the tiles are cleared first, to be painted again from the start
  function paintTiles(byTile: Map<string, Dab[]>, fresh = false) {
    for (const [key, tileDabs] of byTile) {
      if (!selection.canPaint(key)) continue
      const { column, row } = parseTileKey(key)
      const strokeTexture = strokeTile(key, column, row)
      if (fresh) renderer.render({ container: nothing, target: strokeTexture, clear: true, clearColor: [0, 0, 0, 0] })
      painter.paint(strokeTexture, tileDabs, column * TILE_SIZE, row * TILE_SIZE)
      selection.cut(strokeTexture, key)
      projection.composeTile(column, row)
    }
  }

  function paintDabs(dabs: Dab[]) {
    strokeDabs.push(...dabs)
    paintTiles(dabsByTile(dabs))
  }

  // Where the dabs of the stroke being painted go, or null when not painting
  let path: DabPath | null = null
  // The stroke being painted as it was started, its points and the dabs painted so far, to work it out again at its
  // end (see taperEnd)
  let strokeStart = { size: 0, seed: 0, taper: NO_TAPER }
  let strokePoints: StrokePoint[] = []
  let strokeDabs: Dab[] = []

  // Start a stroke at this point of the paper. The pen's pressure goes from 0 to 1
  function startStroke(x: number, y: number, pressure: number) {
    history.begin(stack.active)
    stroke = { tiles: strokeTiles, color: settings.color, opacity: settings.opacity, erase: settings.tool === 'eraser' }
    projection.showStroke(stroke)
    strokeStart = { size: settings.size, seed: Math.floor(Math.random() * 2 ** 32), taper: settings.taper }
    strokePoints = [{ x, y, pressure }]
    strokeDabs = []
    path = createDabPath(shape, strokeStart.size, { ...strokeStart, tip: tip.image })
    paintDabs(path.start({ x, y, pressure }))
  }

  // Continue the stroke through these points
  function continueStroke(points: StrokePoint[]) {
    if (!path) return
    strokePoints.push(...points)
    paintDabs(path.moveTo(points))
  }

  const isSameDab = (a: Dab, b: Dab) =>
    a.x === b.x && a.y === b.y && a.size === b.size && a.angle === b.angle && a.alpha === b.alpha && a.seed === b.seed

  // The end of a stroke can only taper once the stroke has ended and its length is known, and a short stroke's start
  // tapers less than was painted (see dabs.ts). So the stroke is worked out again from its points, with the same random
  // numbers, now knowing its length: its dabs are the same up to where the taper changes them. The tiles touched by
  // the dabs from there on, as painted or as they should be, are painted again from the start
  function taperEnd(length: number) {
    const { taper } = strokeStart
    if (taper.start === 0 && taper.end === 0) return
    const again = createDabPath(shape, strokeStart.size, { ...strokeStart, length, tip: tip.image })
    const tapered = [...again.start(strokePoints[0]), ...again.moveTo(strokePoints.slice(1)), ...again.end()]
    let first = 0
    while (first < strokeDabs.length && first < tapered.length && isSameDab(strokeDabs[first], tapered[first])) first++
    if (first === strokeDabs.length && first === tapered.length) return
    const changed = dabsByTile([...strokeDabs.slice(first), ...tapered.slice(first)])
    const allTapered = dabsByTile(tapered)
    paintTiles(new Map([...changed.keys()].map(key => [key, allTapered.get(key) ?? []])), true)
  }

  // Finish the stroke. Returns whether it changed anything (and so was added to the undo history)
  function endStroke() {
    if (path) {
      paintDabs(path.end())
      taperEnd(path.strokeLength())
    }
    path = null
    strokePoints = []
    strokeDabs = []
    if (stroke) mergeStroke(stroke)
    projection.showStroke(null)
    stroke = null
    return history.end()
  }

  // How far from the pointer the brush can paint, in pixels of the paper. A pixel brush's tip can be up to a pixel
  // further, as it moves to the nearest pixels, and a drawn pixel tip's size is rounded to a multiple of its picture's
  const reach = () => {
    const tipSide = Math.max(tip.image.width, tip.image.height)
    const pixelSize =
      shape.pixel === 'drawn' ? Math.max(1, Math.round(settings.size / tipSide)) * tipSide : settings.size
    const tipReach = shape.pixel === 'none' ? settings.size * (tip.reach / 2 + noiseReach(shape)) : pixelSize / 2 + 1
    return tipReach + shape.scatter * settings.size
  }

  // How much the tip is turned now, in radians, clockwise: as the brush is made, and also with the direction of the
  // stroke while painting with a brush that turns with it. The random turn of each dab is left out
  const tipAngle = () => shape.angle * DEGREES + (shape.followStroke && path ? path.direction() : 0)

  function destroy() {
    painter.destroy()
    mergeRoot.destroy({ children: true })
    for (const strokeTexture of [...strokeTiles.values(), ...spareStrokeTiles]) strokeTexture.destroy(true)
  }

  return {
    settings,
    setTip,
    getTip: () => tip,
    getShape: () => shape,
    tipAngle,
    startStroke,
    continueStroke,
    endStroke,
    reach,
    isPainting: () => path !== null,
    destroy,
  }
}

export type Brush = ReturnType<typeof createBrush>
