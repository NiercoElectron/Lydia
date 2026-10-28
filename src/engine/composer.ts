import { Container, RenderTexture, Sprite, type Texture, type WebGLRenderer } from 'pixi.js'
import type { LayerBlender } from './blendModes'
import type { GpuTiles } from './gpuTiles'
import { blockStart, clipBaseIndex, isClipped, isFolder, type Layer, type LayerStack } from './layers'
import { TILE_SIZE } from './tiles'

// The paint of a layer at a column and row (null: none), as the projection wants it: with the stroke being painted on
// it, if any (see projection.ts)
export type PaintOf = (layer: Layer, column: number, row: number) => Texture | null

// Putting layers and folders together into one tile, from the bottom up (see projection.ts). Layers with the normal
// blend mode are drawn on top of each other in one pass, as the graphics card blends. A layer with another blend mode,
// or clipped (see isClipped in layers.ts), needs what is under it as a picture: all that is put together so far is
// drawn into a whole tile, and the layer is blended with it into another one (see blendModes.ts), which the layers
// above then go on. Folders (see isFolder in layers.ts):
// - one that lets what is in it pass through adds its layers like any others, right onto what is under it. At less
//   than full opacity, or clipped, the picture from before the folder is kept, and mixed with the one after it
// - one with its own blend mode puts its layers together on their own, from nothing, into a tile of their own (a
//   "level"), which then goes on like one layer
//
// "What is put together so far" is a level: a container of sprites, the tile of what was drawn already (if any) and the
// normal layers on top of it, drawn only when a picture of it all is needed ("settle")
type Level = { root: Container; tile: RenderTexture | null; isPending: boolean }

export function createComposer(renderer: WebGLRenderer, stack: LayerStack, gpu: GpuTiles, blender: LayerBlender) {
  // Whole tiles to draw into, given back once used, and reused for the next tiles
  const spareTiles: RenderTexture[] = []
  const takeTile = () => spareTiles.pop() ?? RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE })
  const spareRoots: Container[] = []
  // Sprites reused for each tile put together, instead of new ones every time
  const sprites: Sprite[] = []
  let spriteCount = 0

  function sprite(texture: Texture, alpha = 1) {
    let next = sprites[spriteCount]
    if (!next) {
      next = new Sprite()
      sprites[spriteCount] = next
    }
    spriteCount++
    next.texture = texture
    next.alpha = alpha
    return next
  }

  // The paint of a layer as it is on the graphics card, with no stroke on it
  const ownPaint: PaintOf = (layer, column, row) => gpu.getTexture(layer, column, row, false)

  function startLevel(base: Container | null): Level {
    const root = spareRoots.pop() ?? new Container()
    if (base) root.addChild(base)
    return { root, tile: null, isPending: base !== null }
  }

  // From now on, all that the level has put together is this tile
  function showTile(level: Level, tile: RenderTexture) {
    if (level.tile) spareTiles.push(level.tile)
    level.tile = tile
    level.root.removeChildren()
    level.root.addChild(sprite(tile))
    level.isPending = false
  }

  // A picture of all that the level has put together: its tile, drawn first when it doesn't have everything yet
  function settle(level: Level) {
    if (level.tile && !level.isPending) return level.tile
    const into = takeTile()
    renderer.render({ container: level.root, target: into, clear: true })
    showTile(level, into)
    return into
  }

  // The same picture, taken away from the level, which still shows it: it belongs to the caller from now on
  function hold(level: Level) {
    const tile = settle(level)
    level.tile = null
    level.isPending = true
    return tile
  }

  // Draw all the level has put together into "target", and give its tiles back
  function finishLevel(level: Level, target: RenderTexture | null) {
    if (target) renderer.render({ container: level.root, target, clear: true })
    if (level.tile) spareTiles.push(level.tile)
    level.root.removeChildren()
    spareRoots.push(level.root)
  }

  // Put "paint" onto the level at this opacity, with this mode, where "mask" covers (all over without one)
  function blendIn(level: Level, paint: Texture, opacity: number, mode: Layer['blendMode'], mask?: Texture) {
    const under = settle(level)
    const into = takeTile()
    blender.blend(under, paint, opacity, mode, into, mask)
    showTile(level, into)
  }

  // A folder's layers put together on their own, into a tile that belongs to the caller
  function folderPaint(index: number, column: number, row: number, paintOf: PaintOf) {
    const level = startLevel(null)
    addItems(level, blockStart(stack, index), index, column, row, paintOf)
    const tile = hold(level)
    finishLevel(level, null)
    return tile
  }

  // Put the layers and folders from position "first" to "last" (not included) onto the level, from the bottom up. A
  // folder whose block starts before "first" (when the range starts inside it) is left out, with what is in it added
  // like any other layers: the callers make sure that changes nothing (see showOpacityLive in projection.ts)
  function addItems(level: Level, first: number, last: number, column: number, row: number, paintOf: PaintOf) {
    // The last layer or folder that isn't clipped, the base of the clipped ones above it: null when there is none or
    // it is hidden, undefined until one is found in the range. Its paint here is worked out when a clipped one needs it
    let base: Layer | null | undefined
    let basePaint: Texture | null | undefined
    let baseTile: RenderTexture | null = null // a folder base's paint, given back once it isn't needed anymore
    const setBase = (layer: Layer | null) => {
      base = layer
      basePaint = undefined
      if (baseTile) spareTiles.push(baseTile)
      baseTile = null
    }
    const paintOfBase = (index: number) => {
      if (base === undefined) setBase(stack.layers[clipBaseIndex(stack, index)])
      if (basePaint !== undefined) return basePaint
      if (!base?.visible) basePaint = null
      else if (isFolder(base)) {
        baseTile = folderPaint(stack.layers.indexOf(base), column, row, paintOf)
        basePaint = baseTile
      } else basePaint = paintOf(base, column, row)
      return basePaint
    }

    let at = first
    while (at < last) {
      // The outermost folder whose whole block is in the range and starts here, or the layer here
      let index = at
      for (let parent = stack.layers[at].parent; parent; parent = parent.parent) {
        const folderIndex = stack.layers.indexOf(parent)
        if (folderIndex >= last || blockStart(stack, folderIndex) < first) break
        index = folderIndex
      }
      at = index + 1
      const item = stack.layers[index]
      if (isFolder(item) && blockStart(stack, index) < first) continue
      const clipped = isClipped(stack, index)
      if (!clipped) setBase(item)
      if (!item.visible) continue
      let mask: Texture | undefined
      if (clipped) {
        const paint = paintOfBase(index)
        if (!paint) continue // clipped to a base with no paint here, or hidden: none of it shows
        mask = paint
      }

      if (isFolder(item)) {
        const start = blockStart(stack, index)
        if (item.blendMode === 'pass-through') {
          if (item.opacity === 1 && !mask) {
            addItems(level, start, index, column, row, paintOf)
          } else {
            const before = hold(level)
            addItems(level, start, index, column, row, paintOf)
            const after = settle(level)
            const into = takeTile()
            blender.mix(before, after, item.opacity, into, mask)
            showTile(level, into)
            spareTiles.push(before)
          }
        } else {
          const paint = folderPaint(index, column, row, paintOf)
          blendIn(level, paint, item.opacity, item.blendMode, mask)
          spareTiles.push(paint)
        }
        continue
      }

      const paint = paintOf(item, column, row)
      if (!paint) continue // no paint on this layer here
      if (item.blendMode === 'normal' && !mask) {
        level.root.addChild(sprite(paint, item.opacity))
        level.isPending = true
      } else {
        blendIn(level, paint, item.opacity, item.blendMode, mask)
      }
    }
    setBase(null) // gives the folder base's tile back
  }

  // Put the layers and folders from "first" to "last" (not included) on top of "base", into "target"
  function compose(
    base: Container,
    first: number,
    last: number,
    column: number,
    row: number,
    target: RenderTexture,
    paintOf: PaintOf,
  ) {
    spriteCount = 0
    const level = startLevel(base)
    addItems(level, first, last, column, row, paintOf)
    finishLevel(level, target)
  }

  // The layer or folder at this position alone, as it shows when it is clipped, at full opacity, into "target" (the
  // active layer shown live while its opacity changes: see projection.ts). False when none of it shows here
  function composeAlone(index: number, column: number, row: number, target: RenderTexture, paintOf: PaintOf) {
    spriteCount = 0
    const owned: RenderTexture[] = [] // folders' paint, given back at the end
    const paintAt = (at: number) => {
      const item = stack.layers[at]
      if (!isFolder(item)) return paintOf(item, column, row)
      const tile = folderPaint(at, column, row, paintOf)
      owned.push(tile)
      return tile
    }
    const paint = paintAt(index)
    let mask: Texture | null | undefined
    if (isClipped(stack, index)) {
      const baseIndex = clipBaseIndex(stack, index)
      mask = stack.layers[baseIndex].visible ? paintAt(baseIndex) : null
    }
    const level = startLevel(null)
    const shows = paint !== null && mask !== null
    if (paint && mask !== null) blendIn(level, paint, 1, 'normal', mask)
    finishLevel(level, shows ? target : null)
    spareTiles.push(...owned)
    return shows
  }

  // A folder's layers put together on their own, as it shows with its own blend mode, without its opacity, into
  // "target" (merging a folder into one layer, or moving it: see engine.ts)
  function composeFolder(folder: Layer, column: number, row: number, target: RenderTexture) {
    spriteCount = 0
    const level = startLevel(null)
    const index = stack.layers.indexOf(folder)
    addItems(level, blockStart(stack, index), index, column, row, ownPaint)
    finishLevel(level, target)
  }

  function destroy() {
    for (const tile of spareTiles) tile.destroy(true)
    for (const root of spareRoots) root.destroy()
    for (const each of sprites) each.destroy()
  }

  return { compose, composeAlone, composeFolder, destroy }
}

export type Composer = ReturnType<typeof createComposer>
