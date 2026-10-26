import { toStoredTile, type StoredTile, type TileMemory } from './memory'
import type { Selection } from './selection'
import {
  parseTileKey,
  TILE_SIZE,
  tileKey,
  tileSize,
  tilesInRect,
  tilesTouching,
  wholeTileMask,
  type Grid,
} from './tiles'

// Moving paint (decision 41): the move tool lifts the selected part of the active layer, or all of it when nothing is
// selected, and puts it down somewhere else, by whole pixels of the paper. While it is dragged, the screen shows it on
// its own (see showMove in projection.ts); once it is let go, the layer's new tiles are worked out here, in RAM, from
// its tiles as they were before. Paint moved off the paper is kept, in the layer's tiles off it (decision 49), and comes
// back when it is moved onto the paper again. The selection moves along, but only on the paper

// For each tile under a rectangle, the part of the rectangle inside it: where that part starts in the tile ("fromX",
// "fromY") and in the rectangle ("toX", "toY"), and its size. A layer's tiles are whole, wherever they are; a
// selection's ("onPaper") are only on the paper, cut at its edge, and the part of the rectangle off it is left out
type Overlap = {
  key: string
  tileWidth: number
  tileHeight: number
  fromX: number
  fromY: number
  toX: number
  toY: number
  width: number
  height: number
}

function forEachOverlap(
  grid: Grid,
  onPaper: boolean,
  left: number,
  top: number,
  width: number,
  height: number,
  each: (overlap: Overlap) => void,
) {
  const area = onPaper
    ? tilesInRect(grid, left, top, left + width, top + height)
    : tilesTouching(left, top, left + width, top + height)
  if (!area) return
  for (let column = area.firstColumn; column <= area.lastColumn; column++) {
    for (let row = area.firstRow; row <= area.lastRow; row++) {
      const size = onPaper ? tileSize(grid, column, row) : { width: TILE_SIZE, height: TILE_SIZE }
      const x0 = Math.max(left, column * TILE_SIZE)
      const x1 = Math.min(left + width, column * TILE_SIZE + size.width)
      const y0 = Math.max(top, row * TILE_SIZE)
      const y1 = Math.min(top + height, row * TILE_SIZE + size.height)
      each({
        key: tileKey(column, row),
        tileWidth: size.width,
        tileHeight: size.height,
        fromX: x0 - column * TILE_SIZE,
        fromY: y0 - row * TILE_SIZE,
        toX: x0 - left,
        toY: y0 - top,
        width: x1 - x0,
        height: y1 - y0,
      })
    }
  }
}

// The rectangle a tile covers: a layer's whole tile, or a selection's tile on the paper ("onPaper")
function tileRect(grid: Grid, onPaper: boolean, key: string) {
  const { column, row } = parseTileKey(key)
  const size = onPaper ? tileSize(grid, column, row) : { width: TILE_SIZE, height: TILE_SIZE }
  return { left: column * TILE_SIZE, top: row * TILE_SIZE, ...size }
}

// The tiles a move changes: the ones the moved part leaves ("lifted") and the ones it lands on. A layer's tiles, or a
// selection's ("onPaper")
export function movedKeys(grid: Grid, lifted: Iterable<string>, dx: number, dy: number, onPaper = false) {
  const keys = new Set<string>()
  for (const key of lifted) {
    keys.add(key)
    const { left, top, width, height } = tileRect(grid, onPaper, key)
    forEachOverlap(grid, onPaper, left + dx, top + dy, width, height, overlap => keys.add(overlap.key))
  }
  return keys
}

// A layer's tile after a move: what is left of it, with the moved part that lands on it over that. "tiles" are the
// layer's tiles from before the move, and "selection" what was selected (null: the whole layer moves, off the paper
// too). Undefined when the tile stays as it was
export function movedTile(
  grid: Grid,
  tiles: Map<string, StoredTile>,
  selection: Selection | null,
  key: string,
  dx: number,
  dy: number,
  memory: TileMemory,
) {
  // How much of a tile is selected, as a mask of the whole tile: the selection is only on the paper
  const selectedIn = (at: string) => {
    if (!selection) return 'full'
    const selected = selection.get(at)
    return selected && wholeTileMask(grid, at, selected, 255)
  }
  const { left, top } = tileRect(grid, false, key)
  const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4) // it rounds and keeps within 0–255
  let isChanged = false

  // What is left: the tile without its selected part. Colors are multiplied by their alpha (see memory.ts), so taking
  // a part away multiplies all four values
  const own = tiles.get(key)
  const ownSelected = selectedIn(key)
  const isEmpty = !own || ownSelected === 'full'
  if (own) {
    if (ownSelected === 'full')
      isChanged = true // all of it moves away
    else pixels.set(memory.unpack(own, TILE_SIZE, TILE_SIZE)) // a copy: stored pixels never change
    if (ownSelected && ownSelected !== 'full') {
      isChanged = true
      for (let i = 0; i < ownSelected.length; i++) {
        if (ownSelected[i] === 0) continue
        const keep = 1 - ownSelected[i] / 255
        const j = i * 4
        pixels[j] *= keep
        pixels[j + 1] *= keep
        pixels[j + 2] *= keep
        pixels[j + 3] *= keep
      }
    }
  }

  // The moved part that lands here comes from this tile's rectangle moved back, which can cover up to four tiles
  forEachOverlap(grid, false, left - dx, top - dy, TILE_SIZE, TILE_SIZE, overlap => {
    const source = tiles.get(overlap.key)
    const selected = selectedIn(overlap.key)
    if (!source || !selected) return
    // A tile of a single color is unpacked into a shared buffer, which stays valid until the next unpack
    const sourcePixels = memory.unpack(source, TILE_SIZE, TILE_SIZE)
    for (let y = 0; y < overlap.height; y++) {
      const fromStart = (overlap.fromY + y) * TILE_SIZE + overlap.fromX // in pixels
      const toStart = (overlap.toY + y) * TILE_SIZE + overlap.toX
      // Landing whole where nothing is left: the pixels as they are
      if (isEmpty && selected === 'full') {
        pixels.set(sourcePixels.subarray(fromStart * 4, (fromStart + overlap.width) * 4), toStart * 4)
        isChanged = true
        continue
      }
      // Otherwise each pixel, as much as it was selected, over what is left
      for (let x = 0; x < overlap.width; x++) {
        const s = (fromStart + x) * 4
        const share = selected === 'full' ? 1 : selected[fromStart + x] / 255
        const alpha = sourcePixels[s + 3] * share
        if (alpha === 0) continue
        isChanged = true
        const keep = 1 - alpha / 255
        const t = (toStart + x) * 4
        pixels[t] = sourcePixels[s] * share + pixels[t] * keep
        pixels[t + 1] = sourcePixels[s + 1] * share + pixels[t + 1] * keep
        pixels[t + 2] = sourcePixels[s + 2] * share + pixels[t + 2] * keep
        pixels[t + 3] = alpha + pixels[t + 3] * keep
      }
    }
  })

  return isChanged ? toStoredTile(pixels) : undefined
}

// The selection moved along with the paint. What goes off the paper is no longer selected (null: nothing is left)
export function shiftSelection(grid: Grid, selection: Selection, dx: number, dy: number): Selection | null {
  const result: Selection = new Map()
  for (const key of movedKeys(grid, selection.keys(), dx, dy, true)) {
    const { left, top, width, height } = tileRect(grid, true, key)
    const fromLeft = left - dx
    const fromTop = top - dy
    // Selected whole when everything it comes from is on the paper and selected whole
    let isWhole = fromLeft >= 0 && fromTop >= 0 && fromLeft + width <= grid.width && fromTop + height <= grid.height
    let isNothing = true
    forEachOverlap(grid, true, fromLeft, fromTop, width, height, overlap => {
      const selected = selection.get(overlap.key)
      if (selected !== 'full') isWhole = false
      if (selected) isNothing = false
    })
    if (isNothing) continue
    if (isWhole) {
      result.set(key, 'full')
      continue
    }
    const mask = new Uint8Array(width * height)
    forEachOverlap(grid, true, fromLeft, fromTop, width, height, overlap => {
      const selected = selection.get(overlap.key)
      if (!selected) return
      for (let y = 0; y < overlap.height; y++) {
        const fromStart = (overlap.fromY + y) * overlap.tileWidth + overlap.fromX
        const toStart = (overlap.toY + y) * width + overlap.toX
        if (selected === 'full') mask.fill(255, toStart, toStart + overlap.width)
        else mask.set(selected.subarray(fromStart, fromStart + overlap.width), toStart)
      }
    })
    let selected = 0 // how many pixels are selected at all, and how many whole
    let whole = 0
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] > 0) selected++
      if (mask[i] === 255) whole++
    }
    if (selected > 0) result.set(key, whole === mask.length ? 'full' : mask)
  }
  return result.size > 0 ? result : null
}
