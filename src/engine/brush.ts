import { Container, RenderTexture, Sprite } from 'pixi.js'
import type { WebGLRenderer } from 'pixi.js'
import type { BrushShape } from './brushFile'
import type { BrushTip } from './brushTip'
import { createDabPainter } from './dabPainter'
import { createDabPath, type Dab, type DabPath, type StrokePoint } from './dabs'
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
}

// Tiles of finished strokes kept for the next ones, instead of creating and deleting textures at every stroke
const SPARE_STROKE_TILES = 64

export function createBrush(
  renderer: WebGLRenderer,
  grid: Grid,
  stack: LayerStack,
  gpu: GpuTiles,
  projection: Projection,
  history: History,
  startTip: BrushTip,
  startShape: BrushShape,
) {
  const settings: BrushSettings = { tool: 'brush', color: '#000000', size: 20, opacity: 1 }
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

  function paintDabs(dabs: Dab[]) {
    const isPixel = shape.pixel !== 'none'
    // Which dabs touch each tile ("column,row" -> its dabs, in the order they were placed)
    const dabsByTile = new Map<string, Dab[]>()
    for (const dab of dabs) {
      // A pixel tip is a square that never turns; drops of noise can stick out of the tip a little
      const radius = isPixel ? dab.size / 2 : dab.size * (tip.reach / 2 + noiseReach(shape))
      const area = tilesInRect(grid, dab.x - radius, dab.y - radius, dab.x + radius, dab.y + radius)
      if (!area) continue // the dab is entirely outside the paper
      for (let column = area.firstColumn; column <= area.lastColumn; column++) {
        for (let row = area.firstRow; row <= area.lastRow; row++) {
          const key = tileKey(column, row)
          let tileDabs = dabsByTile.get(key)
          if (!tileDabs) {
            tileDabs = []
            dabsByTile.set(key, tileDabs)
          }
          tileDabs.push(dab)
        }
      }
    }

    // Paint into each touched tile of the stroke only the dabs that touch it, shifted so that the tile's corner is at
    // (0, 0)
    for (const [key, tileDabs] of dabsByTile) {
      const { column, row } = parseTileKey(key)
      painter.paint(strokeTile(key, column, row), tileDabs, column * TILE_SIZE, row * TILE_SIZE)
      projection.composeTile(column, row)
    }
  }

  // Where the dabs of the stroke being painted go, or null when not painting
  let path: DabPath | null = null

  // Start a stroke at this point of the paper. The pen's pressure goes from 0 to 1
  function startStroke(x: number, y: number, pressure: number) {
    history.begin(stack.active)
    stroke = { tiles: strokeTiles, color: settings.color, opacity: settings.opacity, erase: settings.tool === 'eraser' }
    projection.showStroke(stroke)
    path = createDabPath(shape, settings.size)
    paintDabs(path.start({ x, y, pressure }))
  }

  // Continue the stroke through these points
  function continueStroke(points: StrokePoint[]) {
    if (path) paintDabs(path.moveTo(points))
  }

  // Finish the stroke. Returns whether it changed anything (and so was added to the undo history)
  function endStroke() {
    if (path) paintDabs(path.end())
    path = null
    if (stroke) mergeStroke(stroke)
    projection.showStroke(null)
    stroke = null
    return history.end()
  }

  // How far from the pointer the brush can paint, in pixels of the paper. A pixel brush's tip can be up to a pixel
  // further, as it moves to the nearest pixels
  const reach = () => {
    const tipReach =
      shape.pixel === 'none' ? settings.size * (tip.reach / 2 + noiseReach(shape)) : settings.size / 2 + 1
    return tipReach + shape.scatter * settings.size
  }

  function destroy() {
    painter.destroy()
    mergeRoot.destroy({ children: true })
    for (const strokeTexture of [...strokeTiles.values(), ...spareStrokeTiles]) strokeTexture.destroy(true)
  }

  return {
    settings,
    setTip,
    startStroke,
    continueStroke,
    endStroke,
    reach,
    isPainting: () => path !== null,
    destroy,
  }
}

export type Brush = ReturnType<typeof createBrush>
