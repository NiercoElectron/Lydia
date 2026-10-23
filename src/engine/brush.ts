import { CanvasSource, Container, RenderTexture, Sprite, Texture } from 'pixi.js'
import type { WebGLRenderer } from 'pixi.js'
import type { BrushShape } from './brushFile'
import type { BrushTip } from './brushTip'
import { createDabPath, type Dab, type DabPath, type StrokePoint } from './dabs'
import type { GpuTiles } from './gpuTiles'
import type { History } from './history'
import type { LayerStack } from './layers'
import { createNoiseDabs } from './noiseDabs'
import { roundTipRows } from './pixelTip'
import type { Projection, ShownStroke } from './projection'
import { parseTileKey, TILE_SIZE, tileKey, tilesInRect, tileSize, type Grid } from './tiles'

export type Tool = 'brush' | 'eraser'

export type BrushSettings = {
  tool: Tool
  color: string
  size: number // the tip's longer side, in pixels of the paper, at full pressure
  opacity: number // how much the whole stroke covers, from 0 to 1
}

// The tip on the graphics card, with smaller copies of itself (mipmaps), so that a big tip full of detail still looks
// smooth when the brush is small. Every dab is this picture, tinted, resized and turned
function createTipTexture(tip: BrushTip) {
  return new Texture({ source: new CanvasSource({ resource: tip.image, resolution: 1, autoGenerateMipmaps: true }) })
}

// The round tip of a pixel brush at one size (see pixelTip.ts). It is painted at its own size, each of its pixels on
// one pixel of the paper, and "nearest" keeps the graphics card from blending them with their neighbors
function createPixelTipTexture(size: number) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  roundTipRows(size).forEach((count, row) => ctx.fillRect((size - count) / 2, row, count, 1))
  return new Texture({ source: new CanvasSource({ resource: canvas, resolution: 1, scaleMode: 'nearest' }) })
}

// A pixel brush needs a tip for each size it paints at, as the pen's pressure changes it. They are made when first
// needed, and the ones unused for the longest time are forgotten once they add up to more than this many pixels
const PIXEL_TIPS_BUDGET = 4 * 1024 ** 2

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
  let texture = createTipTexture(tip)
  const noiseDabs = createNoiseDabs(renderer, texture, tip)

  // The dabs that touch a tile are put in "stamp" and rendered into that tile at once
  const stampRoot = new Container()
  const stamp = new Container()
  stampRoot.addChild(stamp)
  const dabSprites: Sprite[] = [] // reused between tiles instead of creating new sprites every time
  const pixelTips = new Map<number, Texture>() // by size, the most recently used last
  let pixelTipsArea = 0 // their pixels, added up

  function pixelTip(size: number) {
    let pixelTexture = pixelTips.get(size)
    if (pixelTexture) {
      pixelTips.delete(size) // to put it last again
    } else {
      pixelTexture = createPixelTipTexture(size)
      pixelTipsArea += size * size
    }
    pixelTips.set(size, pixelTexture)
    return pixelTexture
  }

  // Forget the pixel tips unused for the longest time, once there are too many. The sprites get the brush's own tip
  // first, so that none keeps a forgotten one
  function trimPixelTips() {
    if (pixelTipsArea <= PIXEL_TIPS_BUDGET) return
    for (const sprite of dabSprites) sprite.texture = texture
    for (const [size, pixelTexture] of pixelTips) {
      if (pixelTipsArea <= PIXEL_TIPS_BUDGET) break
      pixelTips.delete(size)
      pixelTipsArea -= size * size
      pixelTexture.destroy(true)
    }
  }

  // The stroke being painted goes into tiles of its own first, white, with the paint in their alpha. Only when it ends
  // is it put into the layer, with the color and the opacity of the stroke (or taken out of it, with the eraser), so
  // that a stroke never covers more than its opacity, however many times it passes over a place. Meanwhile the
  // projection shows the layer with the stroke on it. A brush that "washes" keeps, at each pixel, the most paint one
  // dab gave it, instead of piling the dabs up: then its texture shows inside the stroke too
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
    const oldTexture = texture
    tip = newTip
    shape = newShape
    texture = createTipTexture(tip)
    for (const sprite of dabSprites) sprite.texture = texture
    noiseDabs.setTip(texture, tip)
    oldTexture.destroy(true)
  }

  function paintDabs(dabs: Dab[]) {
    const isPixel = shape.pixel !== 'none'
    const hasNoise = !isPixel && shape.noiseAmount > 0
    // Which dabs touch each tile ("column,row" -> its dabs, in the order they were placed)
    const dabsByTile = new Map<string, Dab[]>()
    for (const dab of dabs) {
      const radius = isPixel ? dab.size / 2 : (dab.size / 2) * tip.reach // a pixel tip is a square that never turns
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

    // Render into each touched tile of the stroke only the dabs that touch it, shifted so that the tile's corner is at
    // (0, 0)
    const tipSide = Math.max(tip.image.width, tip.image.height)
    const blendMode = shape.wash ? 'max' : 'normal'
    for (const [key, tileDabs] of dabsByTile) {
      const { column, row } = parseTileKey(key)
      const target = strokeTile(key, column, row)
      if (hasNoise) {
        noiseDabs.paint(target, tileDabs, column * TILE_SIZE, row * TILE_SIZE, blendMode, shape)
      } else {
        stamp.removeChildren()
        tileDabs.forEach((dab, i) => {
          let sprite = dabSprites[i]
          if (!sprite) {
            sprite = new Sprite(texture)
            sprite.anchor.set(0.5) // position and turn the dab around its center
            dabSprites[i] = sprite
          }
          sprite.position.set(dab.x, dab.y)
          sprite.rotation = dab.angle
          if (isPixel) {
            sprite.texture = pixelTip(dab.size)
            sprite.scale.set(1)
          } else {
            sprite.texture = texture
            sprite.scale.set(dab.size / tipSide)
          }
          sprite.alpha = dab.alpha
          sprite.blendMode = blendMode
          stamp.addChild(sprite)
        })
        stamp.position.set(-column * TILE_SIZE, -row * TILE_SIZE)
        renderer.render({ container: stampRoot, target, clear: false })
      }
      projection.composeTile(column, row)
    }
    if (isPixel) trimPixelTips()
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
    const tipReach = shape.pixel === 'none' ? (settings.size / 2) * tip.reach : settings.size / 2 + 1
    return tipReach + shape.scatter * settings.size
  }

  function destroy() {
    stampRoot.destroy({ children: true })
    for (const sprite of dabSprites) sprite.destroy()
    noiseDabs.destroy()
    mergeRoot.destroy({ children: true })
    for (const strokeTexture of [...strokeTiles.values(), ...spareStrokeTiles]) strokeTexture.destroy(true)
    texture.destroy(true)
    for (const pixelTexture of pixelTips.values()) pixelTexture.destroy(true)
  }

  return {
    settings,
    setTip,
    startStroke,
    continueStroke,
    endStroke,
    reach,
    isPainting: () => path !== null,
    noiseDabs, // for measuring, on the filtered-noise branch
    destroy,
  }
}

export type Brush = ReturnType<typeof createBrush>
