import { toStoredTile, type StoredTile, type TileMemory } from './memory'
import { TILE_SIZE, tileKey, tileSize, type Grid } from './tiles'

// A selection (decision 40): how much each pixel of the paper is selected, from 0 (not at all) to 255 (fully), kept by
// tile like the layers. Tiles that are not in the map are not selected at all, and "full" tiles are selected whole.
// A selection never changes: every change makes a new one, so the undo history can keep the old one as it is (the
// tiles that stay the same are shared). null: nothing is selected, and the tools work everywhere
export type SelectionTile = Uint8Array | 'full'
export type Selection = Map<string, SelectionTile>

// How a new shape goes with the selection already there: in its place, added to it, or taken away from it
export type SelectionMode = 'replace' | 'add' | 'subtract'

export type Point = { x: number; y: number }

// Soft edges: each row of pixels is crossed by this many lines, and each line measures exactly how much of each pixel
// it covers, so a pixel on the edge is selected as much as the shape covers it
const LINES_PER_ROW = 4

// How much RAM a selection takes
export function selectionBytes(selection: Selection | null) {
  let bytes = 0
  for (const tile of selection?.values() ?? []) if (tile !== 'full') bytes += tile.length
  return bytes
}

// The tiles of a polygon: points on the paper, the last one joined back to the first. With soft edges, each pixel is
// selected as much as the polygon covers it; with hard edges (for pixel art), a pixel is selected whole when its
// middle is inside. Where the outline goes round a place more than once, it is still inside once ("nonzero" rule)
export function polygonTiles(grid: Grid, points: Point[], hard: boolean): Selection {
  const tiles: Selection = new Map()
  if (points.length < 3) return tiles

  // The sides, each going down (y0 < y1), with the way it went round; flat sides never cross a line across
  const sides: { x0: number; y0: number; x1: number; y1: number; turn: number }[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    if (a.y === b.y) continue
    sides.push(
      a.y < b.y ? { x0: a.x, y0: a.y, x1: b.x, y1: b.y, turn: 1 } : { x0: b.x, y0: b.y, x1: a.x, y1: a.y, turn: -1 },
    )
  }
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  const firstColumn = Math.max(0, Math.floor(Math.min(...xs) / TILE_SIZE))
  const lastColumn = Math.min(grid.columns - 1, Math.floor(Math.max(...xs) / TILE_SIZE))
  const firstRow = Math.max(0, Math.floor(Math.min(...ys) / TILE_SIZE))
  const lastRow = Math.min(grid.rows - 1, Math.floor(Math.max(...ys) / TILE_SIZE))
  const lines = hard ? 1 : LINES_PER_ROW

  for (let row = firstRow; row <= lastRow; row++) {
    const top = row * TILE_SIZE
    const { height } = tileSize(grid, 0, row)
    const near = sides.filter(side => side.y1 > top && side.y0 < top + height)
    // Along each line across this row of tiles, the stretches inside the polygon: [from, to, from, to…]
    const stretches: number[][] = []
    for (let py = 0; py < height; py++) {
      for (let k = 0; k < lines; k++) {
        const y = top + py + (k + 0.5) / lines
        const crossings: { x: number; turn: number }[] = []
        for (const side of near) {
          if (y < side.y0 || y >= side.y1) continue
          crossings.push({ x: side.x0 + ((y - side.y0) * (side.x1 - side.x0)) / (side.y1 - side.y0), turn: side.turn })
        }
        crossings.sort((a, b) => a.x - b.x)
        const stretch: number[] = []
        let winding = 0
        let from = 0
        for (const { x, turn } of crossings) {
          const before = winding
          winding += turn
          if (before === 0 && winding !== 0) from = x
          else if (before !== 0 && winding === 0) stretch.push(from, x)
        }
        stretches.push(stretch)
      }
    }

    for (let column = firstColumn; column <= lastColumn; column++) {
      const left = column * TILE_SIZE
      const { width } = tileSize(grid, column, row)
      const right = left + width
      // Selected whole, not at all, or in part
      let isWhole = true
      let isNothing = true
      for (const stretch of stretches) {
        let covers = false
        for (let i = 0; i < stretch.length; i += 2) {
          if (stretch[i + 1] > left && stretch[i] < right) isNothing = false
          if (stretch[i] <= left && stretch[i + 1] >= right) covers = true
        }
        if (!covers) isWhole = false
      }
      if (isNothing) continue
      const key = tileKey(column, row)
      if (isWhole) {
        tiles.set(key, 'full')
        continue
      }
      const mask = hard ? hardMask(stretches, left, width, height) : softMask(stretches, left, width, height, lines)
      let selected = 0
      for (const value of mask) if (value > 0) selected++
      if (selected === 0) continue
      tiles.set(key, mask.every(value => value === 255) ? 'full' : mask)
    }
  }
  return tiles
}

// Hard edges: a pixel is selected whole when its middle is inside a stretch of its row
function hardMask(stretches: number[][], left: number, width: number, height: number) {
  const mask = new Uint8Array(width * height)
  for (let py = 0; py < height; py++) {
    const stretch = stretches[py]
    for (let i = 0; i < stretch.length; i += 2) {
      const from = Math.max(0, Math.ceil(stretch[i] - 0.5) - left)
      const to = Math.min(width, Math.ceil(stretch[i + 1] - 0.5) - left)
      if (to > from) mask.fill(255, py * width + from, py * width + to)
    }
  }
  return mask
}

// Soft edges: each line adds how much of each pixel it covers, and the lines of a row share the pixel between them
function softMask(stretches: number[][], left: number, width: number, height: number, lines: number) {
  const coverage = new Float32Array(width * height)
  const share = 1 / lines
  stretches.forEach((stretch, index) => {
    const start = Math.floor(index / lines) * width
    for (let i = 0; i < stretch.length; i += 2) {
      const from = Math.max(0, stretch[i] - left)
      const to = Math.min(width, stretch[i + 1] - left)
      if (to <= from) continue
      const first = Math.floor(from)
      const last = Math.ceil(to) - 1
      if (first === last) {
        coverage[start + first] += (to - from) * share
        continue
      }
      coverage[start + first] += (first + 1 - from) * share
      for (let px = first + 1; px < last; px++) coverage[start + px] += share
      coverage[start + last] += (to - last) * share
    }
  })
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < mask.length; i++) mask[i] = Math.round(Math.min(1, coverage[i]) * 255)
  return mask
}

// Each pixel of a tile, from 0 to 255 (a "full" tile is all 255)
const valuesOf = (tile: SelectionTile, length: number) => (tile === 'full' ? new Uint8Array(length).fill(255) : tile)

// The selection after a new shape: in its place, added to it, or taken away from it. A pixel selected by both keeps
// the larger amount; taking away keeps what the shape leaves of it. Nothing left: null
export function combine(selection: Selection | null, shape: Selection, mode: SelectionMode): Selection | null {
  if (mode === 'replace') return shape.size > 0 ? shape : null
  if (!selection) return mode === 'add' && shape.size > 0 ? shape : null
  const result: Selection = new Map(selection)
  for (const [key, tile] of shape) {
    const old = result.get(key)
    if (mode === 'add') {
      if (!old || tile === 'full') result.set(key, tile)
      else if (old !== 'full')
        result.set(
          key,
          old.map((value, i) => Math.max(value, tile[i])),
        )
      continue
    }
    if (!old) continue
    if (tile === 'full') {
      result.delete(key)
      continue
    }
    const before = valuesOf(old, tile.length)
    const left = before.map((value, i) => Math.round((value * (255 - tile[i])) / 255))
    if (left.some(value => value > 0)) result.set(key, left)
    else result.delete(key)
  }
  return result.size > 0 ? result : null
}

// Everything on the paper
export function selectEverything(grid: Grid): Selection {
  const result: Selection = new Map()
  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.columns; column++) result.set(tileKey(column, row), 'full')
  }
  return result
}

// What isn't selected, and the other way round. Inverting nothing selects everything
export function invert(grid: Grid, selection: Selection | null): Selection | null {
  if (!selection) return selectEverything(grid)
  const result: Selection = new Map()
  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.columns; column++) {
      const key = tileKey(column, row)
      const tile = selection.get(key)
      if (!tile) result.set(key, 'full')
      else if (tile !== 'full')
        result.set(
          key,
          tile.map(value => 255 - value),
        )
    }
  }
  return result.size > 0 ? result : null
}

// A layer's tile with the paint taken out where it is selected (null = nothing left), for Delete
export function cutOut(tile: StoredTile, selected: SelectionTile, width: number, height: number, memory: TileMemory) {
  if (selected === 'full') return null
  const pixels = new Uint8ClampedArray(width * height * 4) // it rounds and keeps within 0–255
  pixels.set(memory.unpack(tile, width, height)) // a copy: stored pixels never change
  for (let i = 0; i < selected.length; i++) {
    if (selected[i] === 0) continue
    const keep = 1 - selected[i] / 255
    const j = i * 4
    pixels[j] *= keep
    pixels[j + 1] *= keep
    pixels[j + 2] *= keep
    pixels[j + 3] *= keep
  }
  return toStoredTile(pixels)
}
