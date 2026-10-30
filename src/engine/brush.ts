import { Container, Rectangle, RenderTexture, Sprite, Texture } from 'pixi.js'
import type { WebGLRenderer } from 'pixi.js'
import type { BrushShape } from './brushFile'
import type { BrushTip } from './brushTip'
import { createDabPainter } from './dabPainter'
import {
  createDabPath,
  isCorner,
  NO_TAPER,
  pixelLinePoints,
  withoutCorners,
  type Dab,
  type DabPath,
  type StrokePoint,
  type TaperSettings,
} from './dabs'
import type { GpuTiles } from './gpuTiles'
import { createGrainPass, grainOf, type GrainSettings } from './grain'
import type { History } from './history'
import type { LayerStack } from './layers'
import { noiseReach } from './noiseDabs'
import { strokeBlend, type Projection, type ShownStroke } from './projection'
import type { Point } from './selection'
import { parseTileKey, TILE_SIZE, tileKey, tilesInRect, tileSize, type Grid } from './tiles'
import type { PaintTool } from './tools'

export type BrushSettings = {
  tool: PaintTool
  color: string
  size: number // the tip's longer side, in pixels of the paper, at full pressure
  opacity: number // how much the whole stroke covers, from 0 to 1
  taper: TaperSettings // how the stroke's ends thin out (see dabs.ts)
  pixelPerfect: boolean // whether a pixel brush leaves out the doubled corners of its lines (see dabs.ts)
}

// The selection, as the brush sees it (see selectionView.ts): whether a tile can be painted at all, whether it is only
// partly selected, and cutting a stroke's tile to the selected part of it
export type StrokeCutter = {
  canPaint: (key: string) => boolean
  isCut: (key: string) => boolean
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
  const settings: BrushSettings = {
    tool: 'brush',
    color: '#000000',
    size: 20,
    opacity: 1,
    taper: NO_TAPER,
    pixelPerfect: false,
  }
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

  // In a tile only partly selected, or with a brush that has a paper grain, the stroke is painted into a tile of its
  // own ("raw"), and the stroke's tile shown is that one with the grain on it and cut to the selection again after
  // every change. Cut where it is painted, the soft edge of a selection would be cut again at every movement of the
  // pen, its paint fading away (half selected: half of it, then a quarter...). The grain is put on the whole stroke
  // (see grain.ts), with the most pressure of its dabs at each pixel, painted into tiles of their own
  const rawTiles = new Map<string, RenderTexture>()
  const pressureTiles = new Map<string, RenderTexture>()
  const grainPass = createGrainPass(renderer)

  // A tile as big as this stroke's tile, cleared, for the stroke
  function emptyTile(strokeTexture: RenderTexture) {
    const { width, height } = strokeTexture
    const isFull = width === TILE_SIZE && height === TILE_SIZE
    const texture = (isFull && spareStrokeTiles.pop()) || RenderTexture.create({ width, height })
    renderer.render({ container: nothing, target: texture, clear: true, clearColor: [0, 0, 0, 0] })
    return texture
  }

  // Where the stroke paints in this tile: its own tile, or the raw one
  function paintedTile(key: string, strokeTexture: RenderTexture) {
    if (!strokeStart.grain && !selection.isCut(key)) return strokeTexture
    let raw = rawTiles.get(key)
    if (!raw) {
      raw = emptyTile(strokeTexture)
      rawTiles.set(key, raw)
    }
    return raw
  }

  function pressureTile(key: string, strokeTexture: RenderTexture) {
    let pressure = pressureTiles.get(key)
    if (!pressure) {
      pressure = emptyTile(strokeTexture)
      pressureTiles.set(key, pressure)
    }
    return pressure
  }

  // The stroke's tile shown, as the raw one with the grain on it (if the brush has one), cut to the selection (if
  // this tile has one)
  function finishTile(key: string) {
    const raw = rawTiles.get(key)
    if (!raw) return
    const strokeTexture = strokeTiles.get(key)!
    if (strokeStart.grain) {
      const { column, row } = parseTileKey(key)
      const pressure = pressureTiles.get(key)!
      grainPass.apply(raw, pressure, strokeTexture, column * TILE_SIZE, row * TILE_SIZE, strokeStart.grain)
    } else {
      copyPart(raw, new Rectangle(0, 0, raw.width, raw.height), strokeTexture, 0, 0)
    }
    if (selection.isCut(key)) selection.cut(strokeTexture, key)
  }

  // Keep a stroke's tile for the next strokes, or let it go
  function recycle(texture: RenderTexture) {
    const isFull = texture.width === TILE_SIZE && texture.height === TILE_SIZE
    if (isFull && spareStrokeTiles.length < SPARE_STROKE_TILES) spareStrokeTiles.push(texture)
    else texture.destroy(true)
  }

  // Put the finished stroke into the active layer, tile by tile, keeping each tile's pixels for undo first. The
  // projection already shows these tiles as they now are
  function mergeStroke(shown: ShownStroke) {
    const layer = stack.active
    mergeSprite.tint = shown.color
    mergeSprite.alpha = shown.opacity
    mergeSprite.blendMode = strokeBlend(shown)
    for (const [key, strokeTexture] of strokeTiles) {
      const { column, row } = parseTileKey(key)
      // The eraser has nothing to take away where the layer has no paint, nor a layer whose transparency is locked
      // anything to color, and they mustn't leave an empty tile there
      if (!(shown.erase || shown.alphaLocked) || gpu.getTexture(layer, column, row, false)) {
        history.backUpTile(key)
        mergeSprite.texture = strokeTexture
        renderer.render({ container: mergeRoot, target: gpu.getTexture(layer, column, row, true)!, clear: false })
        gpu.markDirty(layer, key)
      }
      recycle(strokeTexture)
    }
    strokeTiles.clear()
    for (const texture of [...rawTiles.values(), ...pressureTiles.values()]) recycle(texture)
    rawTiles.clear()
    pressureTiles.clear()
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
  // (0, 0), and keep only what is selected. "fresh": the tiles are cleared first, to be painted again from the start.
  // "backUpBefore": a dab to keep what is under it before it is painted (see paintDabs)
  function paintTiles(byTile: Map<string, Dab[]>, fresh = false, backUpBefore: Dab | null = null) {
    for (const [key, tileDabs] of byTile) {
      if (!selection.canPaint(key)) continue
      const { column, row } = parseTileKey(key)
      const strokeTexture = strokeTile(key, column, row)
      const painted = paintedTile(key, strokeTexture)
      const pressure = strokeStart.grain ? pressureTile(key, strokeTexture) : null
      for (const texture of fresh ? [painted, pressure] : []) {
        if (texture) renderer.render({ container: nothing, target: texture, clear: true, clearColor: [0, 0, 0, 0] })
      }
      const left = column * TILE_SIZE
      const top = row * TILE_SIZE
      if (backUpBefore && tileDabs.at(-1) === backUpBefore) {
        painter.paint(painted, tileDabs.slice(0, -1), left, top)
        backUp(key, painted, backUpBefore, left, top)
        painter.paint(painted, [backUpBefore], left, top)
      } else {
        painter.paint(painted, tileDabs, left, top)
      }
      if (pressure) painter.paintPressure(pressure, tileDabs, left, top)
      finishTile(key)
      projection.composeTile(column, row)
    }
  }

  // A pixel-perfect stroke leaves out each dab that a new one turns into a doubled corner (see dabs.ts), even one
  // already painted, and that one is always the latest dab painted. So before the last of each batch of dabs is
  // painted, what is under it in each of its tiles is copied aside, and put back if it turns into a corner: as much
  // work however long the stroke is
  const backups = new Map<string, { texture: RenderTexture; frame: Rectangle }>() // by tile
  const spareBackups: RenderTexture[] = []
  // Draw the part "frame" of "from" into "target" at (x, y), in place of what was there: the blend mode "none" turns
  // blending off, so its pixels are copied as they are. PixiJS ignores the blend mode of what it is asked to render,
  // so the copy's sprite goes inside a container
  const copyRoot = new Container()
  const copySprite = new Sprite()
  copySprite.blendMode = 'none'
  copyRoot.addChild(copySprite)
  function copyPart(from: Texture, frame: Rectangle, target: RenderTexture, x: number, y: number) {
    const part = new Texture({ source: from.source, frame })
    copySprite.texture = part
    copySprite.position.set(x, y)
    renderer.render({ container: copyRoot, target, clear: false })
    part.destroy()
  }

  // Keep what the stroke has under this dab in this tile (whose corner is at "left", "top" on the paper), where it is
  // painted (see paintedTile). Only pixel brushes leave out corners, and they have no grain, so their pressure needn't be
  // kept
  function backUp(key: string, painted: RenderTexture, dab: Dab, left: number, top: number) {
    const half = dab.size / 2 // a pixel tip fits in a square of its size (see dabsByTile)
    const x = Math.max(0, Math.floor(dab.x - half) - left)
    const y = Math.max(0, Math.floor(dab.y - half) - top)
    const width = Math.min(painted.width, Math.ceil(dab.x + half) - left) - x
    const height = Math.min(painted.height, Math.ceil(dab.y + half) - top) - y
    if (width <= 0 || height <= 0) return
    const texture = spareBackups.pop() ?? RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE })
    const frame = new Rectangle(x, y, width, height)
    copyPart(painted, frame, texture, 0, 0)
    backups.set(key, { texture, frame })
  }

  // Put back what was under the latest dab painted, taking it out of the stroke. Returns the tiles it was in, to show
  // them again
  function restoreBackups() {
    for (const [key, { texture, frame }] of backups) {
      const painted = rawTiles.get(key) ?? strokeTiles.get(key)!
      copyPart(texture, new Rectangle(0, 0, frame.width, frame.height), painted, frame.x, frame.y)
      finishTile(key)
    }
    return [...backups.keys()]
  }

  function forgetBackups() {
    for (const { texture } of backups.values()) spareBackups.push(texture)
    backups.clear()
  }

  // Add these dabs to the stroke and paint them, leaving out the doubled corners of a pixel-perfect stroke
  function paintDabs(dabs: Dab[]) {
    if (!strokeStart.pixelPerfect) {
      strokeDabs.push(...dabs)
      paintTiles(dabsByTile(dabs))
      return
    }
    let painted = strokeDabs.length // how many of the stroke's dabs are painted
    let isCornerPainted = false
    for (const dab of dabs) {
      const count = strokeDabs.length
      if (count >= 2 && isCorner(strokeDabs[count - 2], strokeDabs[count - 1], dab)) {
        strokeDabs.pop()
        if (strokeDabs.length < painted) {
          // Only the latest dab painted can be: once it is taken out, the one before it is followed by a new dab
          isCornerPainted = true
          painted = strokeDabs.length
        }
      }
      strokeDabs.push(dab)
    }
    const added = strokeDabs.slice(painted)
    if (added.length === 0) return // nothing taken out either, since that only happens with a new dab
    const restored = isCornerPainted ? restoreBackups() : []
    forgetBackups()
    const byTile = dabsByTile(added)
    paintTiles(byTile, false, added.at(-1)!)
    for (const key of restored) {
      if (byTile.has(key)) continue // shown again already
      const { column, row } = parseTileKey(key)
      projection.composeTile(column, row)
    }
  }

  // Where the dabs of the stroke being painted go, or null when not painting
  let path: DabPath | null = null
  // The stroke being painted as it was started, its points and the dabs painted so far, to work it out again at its
  // end (see taperEnd). "grain": the paper's grain, when the brush has one (see grain.ts)
  let strokeStart: {
    size: number
    seed: number
    taper: TaperSettings
    pixelPerfect: boolean
    grain: GrainSettings | null
  } = { size: 0, seed: 0, taper: NO_TAPER, pixelPerfect: false, grain: null }
  let strokePoints: StrokePoint[] = []
  let strokeDabs: Dab[] = []

  // Start a stroke at this point of the paper. The pen's pressure goes from 0 to 1
  function startStroke(x: number, y: number, pressure: number) {
    history.begin(stack.active)
    const { color, opacity } = settings
    const erase = settings.tool === 'eraser'
    stroke = { tiles: strokeTiles, color, opacity, erase, alphaLocked: stack.active.alphaLocked }
    projection.showStroke(stroke)
    strokeStart = {
      size: settings.size,
      seed: Math.floor(Math.random() * 2 ** 32),
      taper: settings.taper,
      pixelPerfect: settings.pixelPerfect && shape.pixel !== 'none',
      grain: grainOf(tip, shape),
    }
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
    a.x === b.x &&
    a.y === b.y &&
    a.size === b.size &&
    a.angle === b.angle &&
    a.alpha === b.alpha &&
    a.seed === b.seed &&
    a.pressure === b.pressure

  // The end of a stroke can only taper once the stroke has ended and its length is known, and a short stroke's start
  // tapers less than was painted (see dabs.ts). So the stroke is worked out again from its points, with the same random
  // numbers, now knowing its length: its dabs are the same up to where the taper changes them. The tiles touched by
  // the dabs from there on, as painted or as they should be, are painted again from the start
  function taperEnd(length: number) {
    const { taper } = strokeStart
    if (taper.start === 0 && taper.end === 0) return
    const again = createDabPath(shape, strokeStart.size, { ...strokeStart, length, tip: tip.image })
    const dabs = [...again.start(strokePoints[0]), ...again.moveTo(strokePoints.slice(1)), ...again.end()]
    const tapered = strokeStart.pixelPerfect ? withoutCorners(dabs) : dabs
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
      lastEnd = strokePoints.at(-1)!
    }
    path = null
    strokePoints = []
    strokeDabs = []
    forgetBackups()
    if (stroke) mergeStroke(stroke)
    projection.showStroke(null)
    stroke = null
    return history.end()
  }

  // Where the last stroke ended (where the brush was, with the stabilizer), for a straight line from there (see
  // view.ts); null before the first one
  let lastEnd: Point | null = null

  // Paint a straight line from one point of the paper to another, at this pressure, as a stroke of its own. A pixel
  // brush's goes along the pixels Bresenham's way (see dabs.ts). Returns whether it changed anything (and so was
  // added to the undo history)
  function paintLine(from: Point, to: Point, pressure: number) {
    const start = { ...from, pressure }
    const end = { ...to, pressure }
    const points = shape.pixel === 'none' ? [start, end] : pixelLinePoints(shape, settings.size, start, end, tip.image)
    startStroke(points[0].x, points[0].y, pressure)
    continueStroke(points.slice(1))
    const changed = endStroke()
    lastEnd = to // exactly where it was asked to end, for the next line, even where the pixels are rounded
    return changed
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
    grainPass.destroy()
    mergeRoot.destroy({ children: true })
    copyRoot.destroy({ children: true })
    forgetBackups()
    const textures = [
      ...strokeTiles.values(),
      ...rawTiles.values(),
      ...pressureTiles.values(),
      ...spareStrokeTiles,
      ...spareBackups,
    ]
    for (const texture of textures) texture.destroy(true)
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
    paintLine,
    getLastEnd: () => lastEnd,
    reach,
    isPainting: () => path !== null,
    destroy,
  }
}

export type Brush = ReturnType<typeof createBrush>
