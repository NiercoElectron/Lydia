import { Container, GlProgram, Mesh, MeshGeometry, RenderTexture, Shader, Sprite, Texture, UniformGroup } from 'pixi.js'
import type { WebGLRenderer } from 'pixi.js'
import type { Brush } from './brush'
import { DEFAULT_SHAPE } from './brushFile'
import { createDabPath, type Dab, type DabPath, type StrokePoint } from './dabs'
import type { GpuTiles } from './gpuTiles'
import type { History, StepSide } from './history'
import { createLayer, type Layer, type LayerStack } from './layers'
import type { Projection } from './projection'
import { PAD, SMART_PROGRAM } from './smartObject'
import { createTileWriter, type LayerSelection } from './tileWriter'
import { isOnPaper, parseTileKey, TILE_SIZE, tileKey, tilesTouching, type Grid } from './tiles'
import type { LiquifyMode } from './tools'

// Liquify (decision 73): a pen that moves the picture on the active layer instead of painting on it. Each stroke goes on
// the layer at once, like the brush's, but what it does is kept apart too, so the picture is never worked out from a
// picture already moved, which would make it softer with each stroke:
//
// - The "source" is the layer as it was, each tile kept the first time liquify needs it.
// - The "map" says, for points 4 pixels apart, how far from there the source's pixel to show is. The strokes only change
//   the map: moving a point means showing what is at another place, so each dab looks up the map there. Reconstruct
//   only shrinks the map toward zero, so it gets back to the very pixels of the source.
// - After each batch of dabs, the tiles they touched are drawn again from the source, through the map.
//
// That goes on for as long as the layer doesn't change in other ways. A session, as these are called here, starts with
// the first stroke and is forgotten as soon as anything else changes the drawing, or another layer is chosen: it isn't
// shown anywhere, and from there the next stroke starts from the layer as it is then. Reconstruct goes back that far.

const CELL = 4 // pixels of the paper between the map's points
const NODES = TILE_SIZE / CELL // the map's points across a tile
const SPACING = 0.1 // how far apart dabs are, as a fraction of the size
export const MIN_LIQUIFY_SIZE = 16 // a smaller dab would fall between the map's points
const HOLD_MS = 33 // while the pen holds still, one dab this often (not with Push, which needs movement)
// What each dab does at most, in the middle of the dab at 100%: the share of the way to the middle (Bloat, Pucker), the
// turn in radians (Twirl), and the share of the map taken away (Reconstruct). Push follows the pen
const SCALE_RATE = 0.06
const TWIRL_RATE = 0.1
const RECONSTRUCT_RATE = 0.5
const NEAR_ZERO = 0.1 // a shift this small, in pixels, is gone: shrinking alone would never get to zero
const MAX_REACH = 4096 // the most pixels of the source each way that one tile can show

type MapTile = Float32Array // the shifts of NODES × NODES points, row by row, across and down

type Session = {
  layer: Layer
  source: Layer // a layer of its own that isn't in the drawing, so the graphics card can keep its tiles like any layer's
  captured: Set<string> // the tiles of the layer already looked at, with paint or not
  map: Map<string, MapTile>
  shown: Set<string> // the layer's tiles that differ from the source because of the map
  isLocked: boolean // the layer's transparency was locked
  synced: unknown // the last step of the undo history when the map last matched the layer
}

export function createLiquify(
  renderer: WebGLRenderer,
  grid: Grid,
  stack: LayerStack,
  gpu: GpuTiles,
  projection: Projection,
  history: History,
  brush: Brush,
  selection: LayerSelection,
) {
  const settings: { mode: LiquifyMode; strength: number } = { mode: 'push', strength: 0.5 }
  const writer = createTileWriter(renderer, gpu, projection, history, selection)
  const { clear, draw } = writer

  // ----- Drawing on the graphics card -----

  // A tile is drawn as a grid of cells, like a bent smart object: each corner of a cell carries its place in the source
  const across = NODES + 1
  const places = new Float32Array(across * across * 2)
  const corners = new Float32Array(across * across * 2)
  const indices: number[] = []
  for (let y = 0; y < across; y++) {
    for (let x = 0; x < across; x++) {
      corners[(y * across + x) * 2] = x * CELL
      corners[(y * across + x) * 2 + 1] = y * CELL
      if (x === NODES || y === NODES) continue
      const a = y * across + x
      indices.push(a, a + 1, a + across + 1, a, a + across + 1, a + across)
    }
  }
  const geometry = new MeshGeometry({ positions: corners, uvs: places, indices: new Uint32Array(indices) })
  const shared = new UniformGroup({
    uInverse: { value: new Float32Array(9), type: 'mat3x3<f32>' },
    uBent: { value: 1, type: 'f32' },
    uSmooth: { value: 1, type: 'f32' },
  })
  const own = new UniformGroup({
    uOrigin: { value: new Float32Array(2), type: 'vec2<f32>' },
    uSize: { value: new Float32Array(2), type: 'vec2<f32>' },
  })
  const glProgram = new GlProgram(SMART_PROGRAM) // its own: a smart object's is destroyed with it
  const shader = new Shader({ glProgram, resources: { shared, own, uTexture: Texture.EMPTY.source } })
  const meshRoot = new Container()
  meshRoot.addChild(new Mesh({ geometry, shader }))

  // The part of the source a tile shows, put together
  const reachRoot = new Container()
  const reachSprites: Sprite[] = []
  let reach: RenderTexture | null = null
  let work: RenderTexture | null = null // the tile being worked out
  let blank: RenderTexture | null = null // a tile of the source with no paint

  // A picture of at least this size for what a tile shows
  function reachOfSize(width: number, height: number) {
    const fits = reach && reach.width >= width && reach.height >= height
    if (!fits) {
      shader.resources.uTexture = Texture.EMPTY.source
      const side = Math.max(reach?.width ?? 0, reach?.height ?? 0, width, height, 1024)
      reach?.destroy(true)
      reach = RenderTexture.create({ width: Math.ceil(side / 1024) * 1024, height: Math.ceil(side / 1024) * 1024 })
    }
    return reach!
  }

  // ----- The session -----

  let session: Session | null = null

  function newSession(layer: Layer): Session {
    const source = createLayer(`${layer.name} (liquify)`)
    const synced = history.lastStep()
    return {
      layer,
      source,
      captured: new Set(),
      map: new Map(),
      shown: new Set(),
      isLocked: layer.alphaLocked,
      synced,
    }
  }

  function forget() {
    if (session) gpu.dropLayer(session.source)
    session = null
  }

  // Forget the session if the layer may no longer be what the map says. Called after every change of the drawing
  function forgetStale() {
    if (!session || path) return
    const { layer, isLocked, synced } = session
    if (layer !== stack.active || isLocked !== layer.alphaLocked || synced !== history.lastStep()) forget()
  }

  // Keep a tile of the layer in the source, before liquify changes it. A tile painted lately may only be on the graphics
  // card: it is copied there, and the background saving brings it to RAM like any other
  function capture({ layer, source, captured }: Session, column: number, row: number) {
    const key = tileKey(column, row)
    if (captured.has(key)) return
    captured.add(key)
    if (gpu.getCached(layer, key)?.dirty) {
      draw(gpu.getTexture(layer, column, row, false)!, gpu.getTexture(source, column, row, true)!)
      gpu.markDirty(source, key)
    } else {
      const tile = layer.tiles.get(key)
      if (tile) source.tiles.set(key, tile)
    }
  }

  // ----- The map -----

  let area = new Float32Array(0) // a part of the map as one rectangle, where a dab can read it quickly
  let dabbed = new Float32Array(0) // what a dab makes of it

  // Put the map's points from (left, top) to (right, bottom), both included, into "area"
  function readArea(map: Map<string, MapTile>, left: number, top: number, right: number, bottom: number) {
    const width = right - left + 1
    const needed = width * (bottom - top + 1) * 2
    if (area.length < needed) area = new Float32Array(needed)
    else area.fill(0, 0, needed)
    for (let column = Math.floor(left / NODES); column <= Math.floor(right / NODES); column++) {
      for (let row = Math.floor(top / NODES); row <= Math.floor(bottom / NODES); row++) {
        const tile = map.get(tileKey(column, row))
        if (!tile) continue
        const x0 = Math.max(left, column * NODES)
        const x1 = Math.min(right, (column + 1) * NODES - 1)
        for (let y = Math.max(top, row * NODES); y <= Math.min(bottom, (row + 1) * NODES - 1); y++) {
          const from = ((y - row * NODES) * NODES + x0 - column * NODES) * 2
          area.set(tile.subarray(from, from + (x1 - x0 + 1) * 2), ((y - top) * width + x0 - left) * 2)
        }
      }
    }
  }

  // Put "dabbed", the map's points from (left, top) to (right, bottom), into the map
  function writeDabbed(left: number, top: number, right: number, bottom: number) {
    const { map } = session!
    const width = right - left + 1
    for (let column = Math.floor(left / NODES); column <= Math.floor(right / NODES); column++) {
      for (let row = Math.floor(top / NODES); row <= Math.floor(bottom / NODES); row++) {
        if (!isOnPaper(grid, column, row)) continue
        const key = tileKey(column, row)
        let tile = map.get(key)
        if (!tile && mode === 'reconstruct') continue
        if (!strokeBefore.has(key)) strokeBefore.set(key, tile ? tile.slice() : null)
        if (!tile) {
          tile = new Float32Array(NODES * NODES * 2)
          map.set(key, tile)
        }
        const x0 = Math.max(left, column * NODES)
        const x1 = Math.min(right, (column + 1) * NODES - 1)
        for (let y = Math.max(top, row * NODES); y <= Math.min(bottom, (row + 1) * NODES - 1); y++) {
          const from = ((y - top) * width + x0 - left) * 2
          tile.set(
            dabbed.subarray(from, from + (x1 - x0 + 1) * 2),
            ((y - row * NODES) * NODES + x0 - column * NODES) * 2,
          )
        }
      }
    }
  }

  // Each point of the map under the dab now shows what was at another place (fromX, fromY away), through what the map
  // says there. The dab fades toward its edge, and it is its pressure that changes how much it does
  function workDab(dab: Dab, touched: Set<string>) {
    const { map } = session!
    const amount = settings.strength * dab.pressure
    const moveX = lastDab ? dab.x - lastDab.x : 0
    const moveY = lastDab ? dab.y - lastDab.y : 0
    lastDab = dab
    const longest = mode === 'push' ? amount * Math.hypot(moveX, moveY) : radius * Math.max(SCALE_RATE, TWIRL_RATE)
    const margin = mode === 'reconstruct' ? 0 : Math.ceil(longest / CELL) + 1

    const firstX = Math.ceil((dab.x - radius) / CELL)
    const lastX = Math.floor((dab.x + radius) / CELL)
    const firstY = Math.ceil((dab.y - radius) / CELL)
    const lastY = Math.floor((dab.y + radius) / CELL)
    const left = firstX - margin
    const top = firstY - margin
    const width = lastX + margin - left + 1
    readArea(map, left, top, lastX + margin, lastY + margin)
    const needed = (lastX - firstX + 1) * (lastY - firstY + 1) * 2
    if (dabbed.length < needed) dabbed = new Float32Array(needed)

    let at = 0
    for (let y = firstY; y <= lastY; y++) {
      for (let x = firstX; x <= lastX; x++, at += 2) {
        const here = ((y - top) * width + x - left) * 2
        const dx = x * CELL - dab.x
        const dy = y * CELL - dab.y
        const distance = (dx * dx + dy * dy) / (radius * radius)
        if (distance >= 1) {
          dabbed[at] = area[here]
          dabbed[at + 1] = area[here + 1]
          continue
        }
        const fade = (1 - distance) * (1 - distance)
        const strength = amount * fade
        if (mode === 'reconstruct') {
          const keep = 1 - RECONSTRUCT_RATE * strength
          const shiftX = area[here] * keep
          const shiftY = area[here + 1] * keep
          const isGone = Math.abs(shiftX) < NEAR_ZERO && Math.abs(shiftY) < NEAR_ZERO
          dabbed[at] = isGone ? 0 : shiftX
          dabbed[at + 1] = isGone ? 0 : shiftY
          continue
        }
        let fromX: number
        let fromY: number
        if (mode === 'push') {
          fromX = -strength * moveX
          fromY = -strength * moveY
        } else if (mode === 'twirl') {
          const turn = -TWIRL_RATE * strength
          const cos = Math.cos(turn)
          const sin = Math.sin(turn)
          fromX = dx * cos - dy * sin - dx
          fromY = dx * sin + dy * cos - dy
        } else {
          const scale = (mode === 'bloat' ? -SCALE_RATE : SCALE_RATE) * strength
          fromX = dx * scale
          fromY = dy * scale
        }
        // What the map says there, from the four points around it
        const lookX = x - left + fromX / CELL
        const lookY = y - top + fromY / CELL
        const cellX = Math.floor(lookX)
        const cellY = Math.floor(lookY)
        const tx = lookX - cellX
        const ty = lookY - cellY
        const a = (cellY * width + cellX) * 2
        const b = a + 2
        const c = a + width * 2
        const d = c + 2
        for (let way = 0; way < 2; way++) {
          const topRow = area[a + way] * (1 - tx) + area[b + way] * tx
          const bottomRow = area[c + way] * (1 - tx) + area[d + way] * tx
          dabbed[at + way] = topRow * (1 - ty) + bottomRow * ty
        }
        dabbed[at] += fromX
        dabbed[at + 1] += fromY
      }
    }
    writeDabbed(firstX, firstY, lastX, lastY)

    // A point on a tile's edge is on the next one's too: the tile before it has it as its last row and column
    const { firstColumn, lastColumn, firstRow, lastRow } = tilesTouching(
      (firstX - 1) * CELL,
      (firstY - 1) * CELL,
      (lastX + 1) * CELL,
      (lastY + 1) * CELL,
    )
    for (let column = firstColumn; column <= lastColumn; column++) {
      for (let row = firstRow; row <= lastRow; row++) {
        if (isOnPaper(grid, column, row)) touched.add(tileKey(column, row))
      }
    }
  }

  // ----- Drawing a tile from the source, through the map -----

  // Fill "places" with where each corner of this tile's cells comes from in the source. Returns the rectangle around
  // them, or null when nothing is shifted
  function fillPlaces({ map }: Session, column: number, row: number) {
    const tiles = new Map<number, MapTile | undefined>()
    const tileAt = (c: number, r: number) => {
      const id = (c - column) * 2 + r - row
      if (!tiles.has(id)) tiles.set(id, map.get(tileKey(c, r)))
      return tiles.get(id)
    }
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    let isShifted = false
    for (let y = 0; y < across; y++) {
      for (let x = 0; x < across; x++) {
        const tile = tileAt(column + (x === NODES ? 1 : 0), row + (y === NODES ? 1 : 0))
        const from = ((y % NODES) * NODES + (x % NODES)) * 2
        const shiftX = tile ? tile[from] : 0
        const shiftY = tile ? tile[from + 1] : 0
        if (shiftX !== 0 || shiftY !== 0) isShifted = true
        const placeX = column * TILE_SIZE + x * CELL + shiftX
        const placeY = row * TILE_SIZE + y * CELL + shiftY
        places[(y * across + x) * 2] = placeX
        places[(y * across + x) * 2 + 1] = placeY
        left = Math.min(left, placeX)
        top = Math.min(top, placeY)
        right = Math.max(right, placeX)
        bottom = Math.max(bottom, placeY)
      }
    }
    return isShifted ? { left, top, right, bottom } : null
  }

  // The part of the source inside this rectangle, with a border for the smooth sampling, into "reach"
  function readReach(current: Session, rect: { left: number; top: number; right: number; bottom: number }) {
    const left = Math.floor(rect.left) - PAD - 1
    const top = Math.floor(rect.top) - PAD - 1
    const right = Math.min(Math.ceil(rect.right) + PAD + 1, left + MAX_REACH)
    const bottom = Math.min(Math.ceil(rect.bottom) + PAD + 1, top + MAX_REACH)
    const target = reachOfSize(right - left, bottom - top)
    const { firstColumn, lastColumn, firstRow, lastRow } = tilesTouching(left, top, right, bottom)
    reachRoot.removeChildren()
    let count = 0
    for (let column = firstColumn; column <= lastColumn; column++) {
      for (let row = firstRow; row <= lastRow; row++) {
        capture(current, column, row)
        const tile = gpu.getTexture(current.source, column, row, false)
        if (!tile) continue
        const sprite = (reachSprites[count++] ??= new Sprite())
        sprite.texture = tile
        sprite.position.set(column * TILE_SIZE - left, row * TILE_SIZE - top)
        reachRoot.addChild(sprite)
      }
    }
    renderer.render({ container: reachRoot, target, clear: true, clearColor: [0, 0, 0, 0] })
    const values = own.uniforms
    values.uOrigin.set([left, top])
    values.uSize.set([target.width, target.height])
    own.update()
    shader.resources.uTexture = target.source
  }

  // Draw a tile again and put it on the layer. With nothing shifted it is the source's tile, to the pixel
  function drawTile(key: string) {
    if (!selection.canPaint(key)) return
    const current = session!
    const { layer, source, shown } = current
    const { column, row } = parseTileKey(key)
    capture(current, column, row)
    const rect = fillPlaces(current, column, row)
    if (!rect && !shown.has(key)) return // no different from the source, and it never was
    work ??= RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE })
    const sourceTile = gpu.getTexture(source, column, row, false)
    if (rect) {
      readReach(current, rect)
      geometry.getBuffer('aUV').update()
      renderer.render({ container: meshRoot, target: work, clear: true, clearColor: [0, 0, 0, 0] })
      shown.add(key)
    } else {
      if (sourceTile) draw(sourceTile, work)
      else clear(work)
      shown.delete(key)
    }
    let before: Texture | undefined
    if (layer.alphaLocked || selection.isCut(key)) {
      blank ??= RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE })
      if (!sourceTile) clear(blank)
      before = sourceTile ?? blank
    }
    writer.publish(layer, key, work, before)
  }

  // ----- The stroke -----

  let path: DabPath | null = null
  let mode: LiquifyMode = 'push'
  let radius = 0
  let lastDab: Dab | null = null
  let lastDabTime = 0
  // What the stroke changed in the map, as it was: tiles of the map, and the tiles shown
  let strokeBefore = new Map<string, MapTile | null>()
  let shownBefore = new Set<string>()

  function workDabs(dabs: Dab[]) {
    if (dabs.length === 0) return
    const touched = new Set<string>()
    for (const dab of dabs) workDab(dab, touched)
    for (const key of touched) drawTile(key)
    lastDabTime = performance.now()
  }

  // Start a stroke at this point of the paper, at the size of the brush. The pen's pressure goes from 0 to 1, and
  // changes the strength
  function startStroke(x: number, y: number, pressure: number) {
    forgetStale()
    session ??= newSession(stack.active)
    history.begin(session.layer)
    mode = settings.mode
    const size = Math.max(brush.settings.size, MIN_LIQUIFY_SIZE)
    radius = size / 2
    lastDab = null
    strokeBefore = new Map()
    shownBefore = new Set(session.shown)
    const shape = { ...DEFAULT_SHAPE, spacing: Math.max(SPACING, 1 / size), pressureSize: false }
    path = createDabPath(shape, size)
    workDabs(path.start({ x, y, pressure }))
  }

  function continueStroke(points: StrokePoint[]) {
    if (path) workDabs(path.moveTo(points))
  }

  // While the pen holds still, Bloat, Pucker, Twirl and Reconstruct go on working where it is. Called every frame
  function hold() {
    if (!path || !lastDab || mode === 'push' || performance.now() - lastDabTime < HOLD_MS) return
    workDabs([lastDab])
  }

  // Keep with an undo step what the stroke changed in the map, so undo and redo take the map with the layer's pixels
  function stepSide(owner: Session, tiles: Map<string, MapTile | null>, shown: Set<string>): StepSide {
    let bytes = 0
    for (const tile of tiles.values()) bytes += tile?.byteLength ?? 0
    return {
      bytes,
      swap() {
        if (session !== owner) return
        for (const [key, tile] of tiles) {
          tiles.set(key, owner.map.get(key) ?? null)
          if (tile) owner.map.set(key, tile)
          else owner.map.delete(key)
        }
        ;[owner.shown, shown] = [shown, owner.shown]
        owner.synced = history.lastStep()
      },
    }
  }

  // Finish the stroke. Returns whether it changed anything (and so was added to the undo history)
  function endStroke() {
    if (path) workDabs(path.end())
    path = null
    const current = session!
    const isKept = history.end(stepSide(current, strokeBefore, shownBefore))
    if (isKept) {
      current.synced = history.lastStep()
    } else {
      // Nothing it did shows (outside the selection, say), so the map stays as it was
      for (const [key, tile] of strokeBefore) {
        if (tile) current.map.set(key, tile)
        else current.map.delete(key)
      }
      current.shown = shownBefore
    }
    return isKept
  }

  // The tiles the session keeps in RAM, for the memory budget
  function* storedTiles() {
    if (session) yield* session.source.tiles.values()
  }

  function destroy() {
    forget()
    shader.resources.uTexture = Texture.EMPTY.source
    meshRoot.destroy({ children: true })
    reachRoot.destroy()
    for (const sprite of reachSprites) sprite.destroy()
    shader.destroy()
    geometry.destroy()
    glProgram.destroy()
    writer.destroy()
    for (const texture of [reach, work, blank]) texture?.destroy(true)
  }

  return { settings, startStroke, continueStroke, hold, endStroke, forgetStale, storedTiles, destroy }
}

export type Liquify = ReturnType<typeof createLiquify>
