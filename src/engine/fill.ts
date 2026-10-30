import { toStoredTile, type StoredTile, type TileMemory } from './memory'
import { paperPart, TILE_SIZE, tileKey, tileSize, wholeTileMask, type Grid } from './tiles'

// The fill bucket (decision 39): it fills the region around the point clicked whose colors are close to the color
// there, and goes on under the soft edge of the lines around it. The region is worked out by the processor, a few
// milliseconds every frame so the screen never stops, from what each tile looks like to it (see TileReference), and so
// are the layer's new pixels (see fillTile)

// What the fill looks at to find where to stop: only the active layer, or the visible layers put together (without
// the paper)
export type FillReference = 'layer' | 'all'

export type FillSettings = {
  tolerance: number // how far each of red, green, blue and alpha may be from the color clicked, from 0 to 255
  reference: FillReference
  expand: number // at most how many pixels the fill goes past its edge, under the lines around it
}

export const DEFAULT_FILL: FillSettings = { tolerance: 32, reference: 'all', expand: 20 }
export const MAX_FILL_EXPAND = 50

// What the fill does to each pixel of a tile: nothing (0), fill it (FILL), or fill behind the paint already there
// (BEHIND, under the soft edge of the lines). "full": fill every pixel
export type FillMask = Uint8Array | 'full'
const FILL = 1
const BEHIND = 2

// A layer as the fill sees it: its tiles in RAM, and how much it shows
export type ReferenceLayer = { tiles: Map<string, StoredTile>; opacity: number }

// What the fill looks at in the tile "column,row": one color for all of it, or the color of each pixel of its part on
// the paper ("width" × "height"), as one number each (see channel)
export type TileReference = (key: string, width: number, height: number) => number | Uint32Array

const BUDGET_MS = 6 // at most this much of each frame goes to the fill
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

// Returns a function to call often during long work: it waits for the next frame once this frame's time is used up
export function createPacer() {
  let deadline = performance.now() + BUDGET_MS
  return async () => {
    if (performance.now() < deadline) return
    await nextFrame()
    deadline = performance.now() + BUDGET_MS
  }
}

// Colors are 4 bytes in one number, as in RAM: red, green, blue and alpha, with the color multiplied by the alpha
const channel = (color: number, index: number) => (color >>> (index * 8)) & 255

// One color over another, the top one shown at "opacity"
function over(bottom: number, top: number, opacity: number) {
  const keep = 1 - (channel(top, 3) / 255) * opacity
  let result = 0
  for (let i = 0; i < 4; i++) {
    result |= Math.min(255, Math.round(channel(top, i) * opacity + channel(bottom, i) * keep)) << (i * 8)
  }
  return result >>> 0
}

// The color a tile of a single color ("below") gets when it is filled whole with this color ("#rrggbb") at this opacity
function filledColor(below: number, color: string, opacity: number) {
  const red = parseInt(color.slice(1, 3), 16)
  const green = parseInt(color.slice(3, 5), 16)
  const blue = parseInt(color.slice(5, 7), 16)
  return over(below, (red | (green << 8) | (blue << 16) | (255 << 24)) >>> 0, opacity)
}

// The color a tile of a single color ("below") gets when its layer's transparency is locked: the fill's color goes
// only where there is paint, as much as it covers, and the transparency stays
function coloredPaint(below: number, color: string, opacity: number) {
  const alpha = channel(below, 3) / 255
  let result = channel(below, 3) << 24
  for (let i = 0; i < 3; i++) {
    const fill = parseInt(color.slice(1 + i * 2, 3 + i * 2), 16)
    result |= Math.min(255, Math.round(fill * alpha * opacity + channel(below, i) * (1 - opacity))) << (i * 8)
  }
  return result >>> 0
}

// What the fill looks at, from these layers in RAM put together on top of each other, each at its opacity, as Normal
// layers go (see TileReference)
export const layersReference =
  (layers: ReferenceLayer[], memory: TileMemory): TileReference =>
  (key, width, height) =>
    referenceOf(layers, memory, key, width, height)

// What the fill looks at in a tile: the layers put together, as one color when every one of them is a single color
// there (or has nothing), or as the color of each pixel of the tile's part on the paper ("width" × "height"; the
// layers' tiles are whole, see tiles.ts)
function referenceOf(layers: ReferenceLayer[], memory: TileMemory, key: string, width: number, height: number) {
  const present = layers.filter(layer => layer.opacity > 0 && layer.tiles.has(key))
  if (present.every(layer => layer.tiles.get(key)!.color !== undefined)) {
    return present.reduce((color, layer) => over(color, layer.tiles.get(key)!.color!, layer.opacity), 0)
  }
  // A single layer, fully shown: its own pixels, without a copy
  if (present.length === 1 && present[0].opacity === 1) {
    const pixels = memory.unpack(present[0].tiles.get(key)!, TILE_SIZE, TILE_SIZE)
    return new Uint32Array(paperPart(pixels, width, height).buffer)
  }
  const out = new Uint8ClampedArray(width * height * 4) // transparent at first; it rounds and keeps within 0–255
  for (const { tiles, opacity } of present) {
    const tile = tiles.get(key)!
    if (tile.color !== undefined) {
      const color = new Uint8ClampedArray(new Uint32Array([tile.color]).buffer)
      const keep = 1 - (color[3] / 255) * opacity
      for (let i = 0; i < out.length; i += 4) {
        for (let c = 0; c < 4; c++) out[i + c] = color[c] * opacity + out[i + c] * keep
      }
    } else {
      const pixels = paperPart(memory.unpack(tile, TILE_SIZE, TILE_SIZE), width, height)
      for (let i = 0; i < out.length; i += 4) {
        const keep = 1 - (pixels[i + 3] / 255) * opacity
        for (let c = 0; c < 4; c++) out[i + c] = pixels[i + c] * opacity + out[i + c] * keep
      }
    }
  }
  return new Uint32Array(out.buffer)
}

// What each pixel of a tile is to the fill: 0 for a color too far from the one clicked, or one it can still reach,
// one filled, or one at the edge, under a line
const OPEN = 1
const FILLED = 2
const EDGE = 3

// A tile as the fill works through it. A tile of a single color is filled whole or not at all; only the edge can go
// into part of it
type TileState = {
  left: number
  top: number
  width: number
  height: number
  reference: number | Uint32Array // what the fill looks at: one color for the whole tile, or each pixel's
  isClose: boolean // for a tile of a single color: whether that color is close enough
  full: boolean // a tile of a single color, filled
  pixels: Uint8Array | null // 0, OPEN, FILLED or EDGE for each pixel, for the other tiles and the edge
}

// The region the fill covers from the pixel (x, y): the pixels connected to it, side by side or above and below,
// whose colors are within "tolerance" of its color; and its edge, at most "expand" pixels into the lines around it.
// Not "contiguous" (for the magic wand: see selection.ts), every pixel of the paper close enough, connected or not.
// Returns "column,row" -> the mask of each tile it touches
export async function findFillRegion(
  grid: Grid,
  referenceAt: TileReference,
  x: number,
  y: number,
  tolerance: number,
  expand: number,
  contiguous = true,
) {
  const pace = createPacer()

  // The color clicked, and how far another color is from it: its largest difference in red, green, blue or alpha
  const seedColumn = Math.floor(x / TILE_SIZE)
  const seedRow = Math.floor(y / TILE_SIZE)
  const { width: seedWidth, height: seedHeight } = tileSize(grid, seedColumn, seedRow)
  const seedReference = referenceAt(tileKey(seedColumn, seedRow), seedWidth, seedHeight)
  const seed =
    typeof seedReference === 'number'
      ? seedReference
      : seedReference[(y - seedRow * TILE_SIZE) * seedWidth + (x - seedColumn * TILE_SIZE)]
  const distance = (color: number) =>
    Math.max(
      Math.abs((color & 255) - (seed & 255)),
      Math.abs(((color >>> 8) & 255) - ((seed >>> 8) & 255)),
      Math.abs(((color >>> 16) & 255) - ((seed >>> 16) & 255)),
      Math.abs((color >>> 24) - (seed >>> 24)),
    )
  const isClose = (color: number) => distance(color) <= tolerance

  const tiles: (TileState | undefined)[] = [] // by row × columns + column, made the first time they are needed

  function tileAt(column: number, row: number) {
    const index = row * grid.columns + column
    let tile = tiles[index]
    if (tile) return tile
    const { width, height } = tileSize(grid, column, row)
    const reference = referenceAt(tileKey(column, row), width, height)
    const left = column * TILE_SIZE
    const top = row * TILE_SIZE
    if (typeof reference === 'number') {
      tile = { left, top, width, height, reference, isClose: isClose(reference), full: false, pixels: null }
    } else {
      // Which pixels are close enough, all at once
      const pixels = new Uint8Array(width * height) // all too far at first
      for (let i = 0; i < pixels.length; i++) if (isClose(reference[i])) pixels[i] = OPEN
      tile = { left, top, width, height, reference, isClose: false, full: false, pixels }
    }
    tiles[index] = tile
    return tile
  }
  const tileOf = (x: number, y: number) => tileAt(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE))
  const isOneColor = (tile: TileState) => typeof tile.reference === 'number'

  // ----- The region -----

  // Pixels to go on from, as pairs of numbers (x, y). Each one fills the stretch of its row it is in, and adds the
  // stretches above and below it (a "scanline" fill)
  const stack = contiguous ? [x, y] : []

  // Not contiguous: every tile of the paper, each pixel close enough filled where it is
  if (!contiguous) {
    for (let row = 0; row < grid.rows; row++) {
      for (let column = 0; column < grid.columns; column++) {
        await pace()
        const tile = tileAt(column, row)
        if (isOneColor(tile)) tile.full = tile.isClose
        else for (let i = 0; i < tile.pixels!.length; i++) if (tile.pixels![i] === OPEN) tile.pixels![i] = FILLED
      }
    }
  }

  // In row y, from "left" to "right": add the first pixel of each stretch the fill can still reach, and the tiles of a
  // single color close enough
  function addStretches(y: number, left: number, right: number) {
    if (y < 0 || y >= grid.height) return
    let x = Math.max(0, left)
    const last = Math.min(grid.width - 1, right)
    while (x <= last) {
      const tile = tileOf(x, y)
      const end = Math.min(last, tile.left + tile.width - 1)
      if (isOneColor(tile)) {
        if (tile.isClose && !tile.full) stack.push(x, y)
      } else {
        const row = (y - tile.top) * tile.width - tile.left
        let isInStretch = false
        for (let px = x; px <= end; px++) {
          const isOpen = tile.pixels![row + px] === OPEN
          if (isOpen && !isInStretch) stack.push(px, y)
          isInStretch = isOpen
        }
      }
      x = end + 1
    }
  }

  // In a column, from "top" to "bottom": add every pixel the fill can still reach (next to a tile filled whole)
  function addColumn(x: number, top: number, bottom: number) {
    if (x < 0 || x >= grid.width) return
    for (let y = Math.max(0, top); y <= Math.min(grid.height - 1, bottom); y++) addStretches(y, x, x)
  }

  while (stack.length > 0) {
    await pace()
    const py = stack.pop()!
    const px = stack.pop()!
    let tile = tileOf(px, py)
    if (isOneColor(tile)) {
      if (!tile.isClose || tile.full) continue
      // Every pixel of it is close enough: fill it whole, and go on from the pixels just around it
      tile.full = true
      const right = tile.left + tile.width - 1
      const bottom = tile.top + tile.height - 1
      addStretches(tile.top - 1, tile.left, right)
      addStretches(bottom + 1, tile.left, right)
      addColumn(tile.left - 1, tile.top, bottom)
      addColumn(right + 1, tile.top, bottom)
      continue
    }
    let row = (py - tile.top) * tile.width - tile.left
    if (tile.pixels![row + px] !== OPEN) continue
    tile.pixels![row + px] = FILLED

    // Fill to the left as far as possible, going on into the tiles on the left
    let left = px
    for (;;) {
      if (left - 1 >= tile.left) {
        if (tile.pixels![row + left - 1] !== OPEN) break
        tile.pixels![row + left - 1] = FILLED
        left--
      } else {
        if (left === 0) break
        const next = tileOf(left - 1, py)
        if (isOneColor(next)) {
          if (next.isClose && !next.full) stack.push(left - 1, py)
          break
        }
        tile = next
        row = (py - tile.top) * tile.width - tile.left
      }
    }
    // And to the right
    tile = tileOf(px, py)
    row = (py - tile.top) * tile.width - tile.left
    let right = px
    for (;;) {
      if (right + 1 < tile.left + tile.width) {
        if (tile.pixels![row + right + 1] !== OPEN) break
        tile.pixels![row + right + 1] = FILLED
        right++
      } else {
        if (right === grid.width - 1) break
        const next = tileOf(right + 1, py)
        if (isOneColor(next)) {
          if (next.isClose && !next.full) stack.push(right + 1, py)
          break
        }
        tile = next
        row = (py - tile.top) * tile.width - tile.left
      }
    }
    addStretches(py - 1, left, right)
    addStretches(py + 1, left, right)
  }

  // ----- The edge, under the lines -----

  // From the edge of the region, the fill goes on pixel by pixel as long as the colors keep getting further from the
  // one clicked: into the soft edge of the lines around it, up to where they are darkest (past that, they get lighter
  // again), and at most "expand" pixels. There it fills behind the paint (see fillTile), so the soft edge stays on top
  const distanceAt = (tile: TileState, i: number) =>
    distance(typeof tile.reference === 'number' ? tile.reference : tile.reference[i])
  const isFullAt = (x: number, y: number) => x < 0 || y < 0 || x >= grid.width || y >= grid.height || tileOf(x, y).full

  // Where to start: the filled pixels next to one that isn't. At the sides of a tile, the tile next to it decides, so
  // they all start (those with nothing to go into simply stop)
  let edge: number[] = []
  if (expand > 0) {
    for (let index = 0; index < tiles.length; index++) {
      const tile = tiles[index]
      if (!tile) continue
      await pace()
      const right = tile.left + tile.width - 1
      const bottom = tile.top + tile.height - 1
      if (tile.full) {
        if (!isFullAt(tile.left - 1, tile.top)) for (let y = tile.top; y <= bottom; y++) edge.push(tile.left, y)
        if (!isFullAt(right + 1, tile.top)) for (let y = tile.top; y <= bottom; y++) edge.push(right, y)
        if (!isFullAt(tile.left, tile.top - 1)) for (let x = tile.left; x <= right; x++) edge.push(x, tile.top)
        if (!isFullAt(tile.left, bottom + 1)) for (let x = tile.left; x <= right; x++) edge.push(x, bottom)
      } else if (tile.pixels) {
        const { pixels, width, height } = tile
        for (let py = 0; py < height; py++) {
          for (let px = 0; px < width; px++) {
            const i = py * width + px
            if (pixels[i] !== FILLED) continue
            const isInside =
              px > 0 &&
              py > 0 &&
              px < width - 1 &&
              py < height - 1 &&
              pixels[i - 1] === FILLED &&
              pixels[i + 1] === FILLED &&
              pixels[i - width] === FILLED &&
              pixels[i + width] === FILLED
            if (!isInside) edge.push(tile.left + px, tile.top + py)
          }
        }
      }
    }
  }
  // One pixel further at each step, into the 8 pixels around
  for (let step = 0; step < expand && edge.length > 0; step++) {
    const next: number[] = []
    for (let k = 0; k < edge.length; k += 2) {
      if (k % 1024 === 0) await pace()
      const ex = edge[k]
      const ey = edge[k + 1]
      const from = tileOf(ex, ey)
      const here = distanceAt(from, (ey - from.top) * from.width + (ex - from.left))
      for (let ny = Math.max(0, ey - 1); ny <= Math.min(grid.height - 1, ey + 1); ny++) {
        for (let nx = Math.max(0, ex - 1); nx <= Math.min(grid.width - 1, ex + 1); nx++) {
          const tile = tileOf(nx, ny)
          if (tile.full) continue
          const i = (ny - tile.top) * tile.width + (nx - tile.left)
          if (tile.pixels && tile.pixels[i] >= FILLED) continue
          const there = distanceAt(tile, i)
          if (there < here) continue // lighter again: past the darkest part of the line
          tile.pixels ??= new Uint8Array(tile.width * tile.height) // a tile of a single color, partly under the edge
          tile.pixels[i] = EDGE
          if (there < 255) next.push(nx, ny) // nothing can be further than 255: the line is at its darkest there
        }
      }
    }
    edge = next
  }

  // Each tile's mask
  const region = new Map<string, FillMask>()
  for (let index = 0; index < tiles.length; index++) {
    const tile = tiles[index]
    if (!tile) continue
    await pace()
    const key = tileKey(index % grid.columns, Math.floor(index / grid.columns))
    if (tile.full) {
      region.set(key, 'full')
    } else if (tile.pixels) {
      let mask: Uint8Array | null = null
      for (let i = 0; i < tile.pixels.length; i++) {
        const state = tile.pixels[i]
        if (state < FILLED) continue
        mask ??= new Uint8Array(tile.pixels.length)
        mask[i] = state === FILLED ? FILL : BEHIND
      }
      if (mask) region.set(key, mask)
    }
  }
  return region
}

// A layer's tile at "key" after the fill (null = no paint): the color, at this opacity, over its pixels where the mask
// says FILL, and behind them where it says BEHIND; with a selection, only as much as each pixel is selected
// ("selected", from 0 to 255; all of it without one). The masks cover the tile's part on the paper: off the paper,
// nothing is filled. Worked out in RAM rather than painted on the graphics card, so nothing has to be read back from
// it afterwards: with big fills, hundreds of tiles read back at once made the screen stop for a moment
export function fillTile(
  grid: Grid,
  key: string,
  tile: StoredTile | undefined,
  regionMask: FillMask,
  color: string,
  opacity: number,
  memory: TileMemory,
  selectedPart?: Uint8Array,
  keepsAlpha = false, // the layer's transparency is locked: only the paint there takes the color
): StoredTile | null {
  const mask = wholeTileMask(grid, key, regionMask, FILL)
  const selected = selectedPart && (wholeTileMask(grid, key, selectedPart, 255) as Uint8Array)
  if (mask === 'full' && !selected && (!tile || tile.color !== undefined)) {
    const below = tile?.color ?? 0
    const filled = keepsAlpha ? coloredPaint(below, color, opacity) : filledColor(below, color, opacity)
    return { color: filled, lastUsed: performance.now() }
  }
  const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4) // it rounds and keeps within 0–255
  if (tile) pixels.set(memory.unpack(tile, TILE_SIZE, TILE_SIZE)) // a copy: stored pixels never change
  const [red, green, blue] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) * opacity)
  const alpha = 255 * opacity
  const keep = 1 - opacity
  for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
    const what = mask === 'full' ? FILL : mask[i]
    if (!what) continue
    const amount = selected ? selected[i] / 255 : 1
    if (amount === 0) continue
    const j = i * 4
    if (keepsAlpha) {
      // Only the paint there takes the color, as much as it covers; past the region nothing is added behind the lines
      if (what !== FILL) continue
      const covers = pixels[j + 3] / 255
      const left = 1 - opacity * amount
      pixels[j] = red * amount * covers + pixels[j] * left
      pixels[j + 1] = green * amount * covers + pixels[j + 1] * left
      pixels[j + 2] = blue * amount * covers + pixels[j + 2] * left
    } else if (what === FILL && amount === 1) {
      pixels[j] = red + pixels[j] * keep
      pixels[j + 1] = green + pixels[j + 1] * keep
      pixels[j + 2] = blue + pixels[j + 2] * keep
      pixels[j + 3] = alpha + pixels[j + 3] * keep
    } else if (what === FILL) {
      const left = 1 - opacity * amount // how much of what was there still shows
      pixels[j] = red * amount + pixels[j] * left
      pixels[j + 1] = green * amount + pixels[j + 1] * left
      pixels[j + 2] = blue * amount + pixels[j + 2] * left
      pixels[j + 3] = alpha * amount + pixels[j + 3] * left
    } else {
      // The color shows only as much as the paint already there lets it through
      const through = (1 - pixels[j + 3] / 255) * amount
      pixels[j] += red * through
      pixels[j + 1] += green * through
      pixels[j + 2] += blue * through
      pixels[j + 3] += alpha * through
    }
  }
  return toStoredTile(pixels)
}
