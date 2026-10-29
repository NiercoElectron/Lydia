import { Container, RenderTexture, Sprite, type Texture, type WebGLRenderer } from 'pixi.js'
import type { LayerBlender } from './blendModes'
import type { GpuTiles } from './gpuTiles'
import { blockStart, clipBaseIndex, isClipped, isFolder, type BlendMode, type Layer, type LayerStack } from './layers'
import { TILE_SIZE } from './tiles'

// The paint of a layer at a column and row (null: none), as the projection wants it: with the stroke being painted on
// it, if any (see projection.ts)
export type PaintOf = (layer: Layer, column: number, row: number) => Texture | null

// A step of a tile shown live (see live): how "the picture" (all that is put together so far) goes on
export type LiveStep =
  // the picture with "paint" on top of it, at this opacity, with this mode
  | { kind: 'onto'; paint: RenderTexture; opacity: number; mode: BlendMode }
  // the picture, the paint of a folder with its own blend mode, onto "under" (what is under the folder)
  | { kind: 'into'; under: RenderTexture; opacity: number; mode: BlendMode; mask: RenderTexture | null }
  // the picture mixed with "before", or with the picture kept by the last "keep" step when there is none (a folder
  // that lets what is in it pass through, at less than full opacity or clipped)
  | { kind: 'mix'; before: RenderTexture | null; opacity: number; mask: RenderTexture | null }
  | { kind: 'keep' }

// A tile of a layer or folder shown live while its opacity changes (see projection.ts): the picture with it at no
// opacity and at full opacity, and the steps still to do after mixing the two. All the tiles belong to it
export type LivePicture = { zero: RenderTexture; one: RenderTexture; steps: LiveStep[] }

// The blend modes that only add and multiply what is under them, so a picture made with them changes in a straight
// line with what is under it
const STRAIGHT_MODES: BlendMode[] = ['normal', 'multiply', 'screen']

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
// normal layers on top of it, drawn only when a picture of it all is needed ("settle"). A level can also write down
// the steps instead of doing them ("steps"), for a tile shown live: see live
type Level = { root: Container; tile: RenderTexture | null; isPending: boolean; steps: LiveStep[] | null }

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

  function startLevel(base: Container | null, steps: LiveStep[] | null = null): Level {
    const root = spareRoots.pop() ?? new Container()
    if (base) root.addChild(base)
    return { root, tile: null, isPending: base !== null, steps }
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

  // A copy of "paint" in a tile of its own, only as much as "mask" covers (all of it without one)
  function copyOf(paint: Texture, mask?: Texture) {
    const tile = takeTile()
    blender.clip(paint, tile, mask)
    return tile
  }

  // A level writing down steps: the normal layers added since the last step become a step of their own, put together
  // over nothing (normal layers go on top of each other the same way whatever is under them)
  function writeNormalLayers(level: Level) {
    if (!level.isPending) return
    const tile = hold(level)
    level.root.removeChildren()
    level.isPending = false
    level.steps!.push({ kind: 'onto', paint: tile, opacity: 1, mode: 'normal' })
  }

  // Put "paint" onto the level at this opacity
  function addNormal(level: Level, paint: Texture, opacity: number) {
    level.root.addChild(sprite(paint, opacity))
    level.isPending = true
  }

  // Put "paint" onto the level at this opacity, with this mode, where "mask" covers (all over without one)
  function blendIn(level: Level, paint: Texture, opacity: number, mode: BlendMode, mask?: Texture) {
    if (level.steps) {
      writeNormalLayers(level)
      level.steps.push({ kind: 'onto', paint: copyOf(paint, mask), opacity, mode })
      return
    }
    const under = settle(level)
    const into = takeTile()
    blender.blend(under, paint, opacity, mode, into, mask)
    showTile(level, into)
  }

  // Keep the picture of all that the level has put together, for mixKept (null when the level writes down steps)
  function keep(level: Level) {
    if (!level.steps) return hold(level)
    writeNormalLayers(level)
    level.steps.push({ kind: 'keep' })
    return null
  }

  // Mix the picture kept with all that the level has put together since: as much of that as the opacity, where "mask"
  // covers
  function mixKept(level: Level, before: RenderTexture | null, opacity: number, mask?: Texture) {
    if (!before) {
      writeNormalLayers(level)
      level.steps!.push({ kind: 'mix', before: null, opacity, mask: mask ? copyOf(mask) : null })
      return
    }
    const after = settle(level)
    const into = takeTile()
    blender.mix(before, after, opacity, into, mask)
    showTile(level, into)
    spareTiles.push(before)
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
  // like any other layers: the callers make sure that changes nothing (see prepareMoveTile in projection.ts)
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
            const before = keep(level)
            addItems(level, start, index, column, row, paintOf)
            mixKept(level, before, item.opacity, mask)
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
      if (item.blendMode === 'normal' && !mask) addNormal(level, paint, item.opacity)
      else blendIn(level, paint, item.opacity, item.blendMode, mask)
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

  // The paint of the layer or folder at this position (null: none), with the tile of a folder's paint, which the caller
  // must give back
  function paintAt(index: number, column: number, row: number, paintOf: PaintOf, made: RenderTexture[]) {
    const item = stack.layers[index]
    if (!isFolder(item)) return paintOf(item, column, row)
    const tile = folderPaint(index, column, row, paintOf)
    made.push(tile)
    return tile
  }

  // The paint of the base the layer or folder at this position is clipped to (null: none here, or the base is hidden),
  // or undefined when it isn't clipped
  function maskOf(index: number, column: number, row: number, paintOf: PaintOf, made: RenderTexture[]) {
    if (!isClipped(stack, index)) return undefined
    const baseIndex = clipBaseIndex(stack, index)
    return stack.layers[baseIndex].visible ? paintAt(baseIndex, column, row, paintOf, made) : null
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

  // ----- Tiles shown live while an opacity changes -----

  // Whether the tiles of the layer or folder at this position can be shown live (see live): not when layers are clipped
  // to a folder it is in, since that folder's paint, which clips them, changes with its opacity too. Its tiles are then
  // put together again for each new opacity
  function canShowLive(index: number) {
    for (let folder = stack.layers[index].parent; folder; folder = folder.parent) {
      const at = stack.layers.indexOf(folder)
      for (let above = at + 1; above < stack.layers.length; above++) {
        if (stack.layers[above].visible && isClipped(stack, above) && clipBaseIndex(stack, above) === at) return false
      }
    }
    return true
  }

  // The steps from "start" on, into a tile of the caller's ("target", for the last one) or a new one: the result. The
  // tiles in between are given back, but never "start"
  function runSteps(start: RenderTexture, steps: LiveStep[], target?: RenderTexture) {
    let picture = start
    const kept: RenderTexture[] = []
    const done = (tile: RenderTexture) => {
      if (tile !== start && !kept.includes(tile)) spareTiles.push(tile)
    }
    steps.forEach((step, i) => {
      if (step.kind === 'keep') {
        kept.push(picture)
        return
      }
      const into = target && i === steps.length - 1 ? target : takeTile()
      if (step.kind === 'onto') blender.blend(picture, step.paint, step.opacity, step.mode, into)
      else if (step.kind === 'into') {
        blender.blend(step.under, picture, step.opacity, step.mode, into, step.mask ?? undefined)
      } else {
        const before = step.before ?? kept.pop()!
        blender.mix(before, picture, step.opacity, into, step.mask ?? undefined)
        if (!step.before && before !== picture) done(before)
      }
      done(picture)
      picture = into
    })
    return picture
  }

  // Every tile of a picture shown live
  const texturesOf = (picture: LivePicture) => [picture.zero, picture.one, ...texturesOfSteps(picture.steps)]

  function texturesOfSteps(steps: LiveStep[]) {
    const textures: RenderTexture[] = []
    for (const step of steps) {
      if (step.kind === 'onto') textures.push(step.paint)
      if (step.kind === 'into') textures.push(step.under)
      if (step.kind === 'mix' && step.before) textures.push(step.before)
      if ((step.kind === 'into' || step.kind === 'mix') && step.mask) textures.push(step.mask)
    }
    return textures
  }

  // The tile at this column and row with the layer or folder at "index" shown live while its opacity changes, from
  // "base" (the paper and the layers under position "first", where the outermost folder it is in starts: see splitIndex
  // in layers.ts). Null when it changes nothing there.
  // The tile is the picture of everything with the layer at no opacity, mixed with the picture with it at full opacity
  // as much as its opacity: the layer goes onto what is under it that way, whatever its blend mode, and so do the layers
  // and folders above it as long as they only add and multiply (see STRAIGHT_MODES; a folder letting what is in it
  // pass through only mixes). Up to the first one that does something else, both pictures are made here; that one and
  // the rest are written down as steps, with pictures of the other layers they need, and done again for each new
  // opacity (see showLive). The steps go up through the folders the layer is in: what is above it in its folder, then
  // the folder going onto what is under it, and so on
  function live(
    index: number,
    column: number,
    row: number,
    base: Container,
    first: number,
    paintOf: PaintOf,
  ): LivePicture | null {
    spriteCount = 0
    const made: RenderTexture[] = [] // every tile made here: those the picture doesn't use are given back at the end
    const steps: LiveStep[] = []
    const giveBack = (keep: RenderTexture[] = []) => {
      const tiles = new Set([...made, ...texturesOfSteps(steps)])
      for (const tile of keep) tiles.delete(tile)
      spareTiles.push(...tiles)
      return null
    }

    // What is put together under the block of the layer or folder at "at", in the level it is in: from the paper
    // for one that isn't in a folder, from nothing in a folder with its own blend mode, and from what is under the
    // folder in one that lets what is in it pass through
    const befores = new Map<number, RenderTexture>()
    const before = (at: number): RenderTexture => {
      const known = befores.get(at)
      if (known) return known
      const parent = stack.layers[at].parent
      const parentIndex = parent ? stack.layers.indexOf(parent) : -1
      const from = !parent ? base : parent.blendMode === 'pass-through' ? sprite(before(parentIndex)) : null
      const level = startLevel(from)
      addItems(level, parent ? blockStart(stack, parentIndex) : first, blockStart(stack, at), column, row, paintOf)
      const tile = hold(level)
      finishLevel(level, null)
      befores.set(at, tile)
      made.push(tile)
      return tile
    }

    // The tile with the layer at full opacity (with no opacity, it is what is under it)
    const item = stack.layers[index]
    const mask = maskOf(index, column, row, paintOf, made)
    if (mask === null) return giveBack() // clipped, and none of it shows here
    const under = before(index)
    const one = takeTile()
    made.push(one)
    if (isFolder(item) && item.blendMode === 'pass-through') {
      const level = startLevel(sprite(under))
      addItems(level, blockStart(stack, index), index, column, row, paintOf)
      blender.mix(under, settle(level), 1, one, mask)
      finishLevel(level, null)
    } else {
      const paint = paintAt(index, column, row, paintOf, made)
      if (!paint) return giveBack() // no paint here
      blender.blend(under, paint, 1, item.blendMode, one, mask)
    }

    // The steps above it, in its folder and then in the folders around it
    const level = startLevel(null, steps)
    for (let at = index; ;) {
      const parent = stack.layers[at].parent
      const end = parent ? stack.layers.indexOf(parent) : stack.layers.length
      addItems(level, at + 1, end, column, row, paintOf)
      writeNormalLayers(level)
      if (!parent) break
      const parentMask = maskOf(end, column, row, paintOf, made)
      if (parentMask === null) {
        finishLevel(level, null)
        return giveBack() // the folder it is in is clipped, and none of it shows here
      }
      const ownMask = parentMask ? copyOf(parentMask) : null
      if (parent.blendMode !== 'pass-through') {
        steps.push({ kind: 'into', under: before(end), opacity: parent.opacity, mode: parent.blendMode, mask: ownMask })
      } else if (parent.opacity < 1 || ownMask) {
        steps.push({ kind: 'mix', before: before(end), opacity: parent.opacity, mask: ownMask })
      }
      at = end
    }
    finishLevel(level, null)

    // Where the straight line ends: at the first step that doesn't go in one, or at the "keep" step before it whose
    // picture would be needed
    let cut = steps.length
    const open: number[] = [] // the "keep" steps not mixed yet
    for (const [i, step] of steps.entries()) {
      if (step.kind === 'keep') open.push(i)
      if (step.kind === 'mix' && !step.before) open.pop()
      if ((step.kind === 'onto' || step.kind === 'into') && !STRAIGHT_MODES.includes(step.mode)) {
        cut = open[0] ?? i
        break
      }
    }
    const done = steps.slice(0, cut)
    const picture = { zero: runSteps(under, done), one: runSteps(one, done), steps: steps.slice(cut) }
    giveBack(texturesOf(picture))
    return picture
  }

  // The tile shown live at this opacity, into "target", for a picture with steps left (see live)
  function showLive(picture: LivePicture, opacity: number, target: RenderTexture) {
    const start = takeTile()
    blender.mix(picture.zero, picture.one, opacity, start)
    runSteps(start, picture.steps, target)
    spareTiles.push(start)
  }

  function destroy() {
    for (const tile of spareTiles) tile.destroy(true)
    for (const root of spareRoots) root.destroy()
    for (const each of sprites) each.destroy()
  }

  return { compose, composeFolder, canShowLive, live, showLive, texturesOf, destroy }
}

export type Composer = ReturnType<typeof createComposer>
