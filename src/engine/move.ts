import { toStoredTile, type StoredTile, type TileMemory } from './memory'
import type { Selection } from './selection'
import { parseTileKey, TILE_SIZE, tileKey, tileSize, tilesInRect, type Grid } from './tiles'

// Moving paint (decision 41): the move tool lifts the selected part of the active layer, or all of it when nothing is
// selected, and puts it down somewhere else, by whole pixels of the paper. While it is dragged, the screen shows it on
// its own (see showMove in projection.ts); once it is let go, the layer's new tiles are worked out here, in RAM, from
// its tiles as they were before. Paint moved off the paper is lost

// For each tile under a rectangle of the paper, the part of the rectangle inside it: where that part starts in the tile
// ("fromX", "fromY") and in the rectangle ("toX", "toY"), and its size. The part off the paper is left out
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
  left: number,
  top: number,
  width: number,
  height: number,
  each: (overlap: Overlap) => void,
) {
  const area = tilesInRect(grid, left, top, left + width, top + height)
  if (!area) return
  for (let column = area.firstColumn; column <= area.lastColumn; column++) {
    for (let row = area.firstRow; row <= area.lastRow; row++) {
      const size = tileSize(grid, column, row)
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

// The paper's rectangle a tile covers
function tileRect(grid: Grid, key: string) {
  const { column, row } = parseTileKey(key)
  return { left: column * TILE_SIZE, top: row * TILE_SIZE, ...tileSize(grid, column, row) }
}

// The tiles a move changes: the ones the moved part leaves ("lifted") and the ones it lands on
export function movedKeys(grid: Grid, lifted: Iterable<string>, dx: number, dy: number) {
  const keys = new Set<string>()
  for (const key of lifted) {
    keys.add(key)
    const { left, top, width, height } = tileRect(grid, key)
    forEachOverlap(grid, left + dx, top + dy, width, height, overlap => keys.add(overlap.key))
  }
  return keys
}

// A layer's tile after a move: what is left of it, with the moved part that lands on it over that. "tiles" are the
// layer's tiles from before the move, and "selection" what was selected (null: the whole layer moves). Undefined when
// the tile stays as it was
export function movedTile(
  grid: Grid,
  tiles: Map<string, StoredTile>,
  selection: Selection | null,
  key: string,
  dx: number,
  dy: number,
  memory: TileMemory,
) {
  const { left, top, width, height } = tileRect(grid, key)
  const pixels = new Uint8ClampedArray(width * height * 4) // it rounds and keeps within 0–255
  let isChanged = false

  // What is left: the tile without its selected part. Colors are multiplied by their alpha (see memory.ts), so taking
  // a part away multiplies all four values
  const own = tiles.get(key)
  const ownSelected = selection ? selection.get(key) : 'full'
  const isEmpty = !own || ownSelected === 'full'
  if (own) {
    if (ownSelected === 'full')
      isChanged = true // all of it moves away
    else pixels.set(memory.unpack(own, width, height)) // a copy: stored pixels never change
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
  forEachOverlap(grid, left - dx, top - dy, width, height, overlap => {
    const source = tiles.get(overlap.key)
    const selected = selection ? selection.get(overlap.key) : 'full'
    if (!source || !selected) return
    // A tile of a single color is unpacked into a shared buffer, which stays valid until the next unpack
    const sourcePixels = memory.unpack(source, overlap.tileWidth, overlap.tileHeight)
    for (let y = 0; y < overlap.height; y++) {
      const fromStart = (overlap.fromY + y) * overlap.tileWidth + overlap.fromX // in pixels
      const toStart = (overlap.toY + y) * width + overlap.toX
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
  for (const key of movedKeys(grid, selection.keys(), dx, dy)) {
    const { left, top, width, height } = tileRect(grid, key)
    const fromLeft = left - dx
    const fromTop = top - dy
    // Selected whole when everything it comes from is on the paper and selected whole
    let isWhole = fromLeft >= 0 && fromTop >= 0 && fromLeft + width <= grid.width && fromTop + height <= grid.height
    let isNothing = true
    forEachOverlap(grid, fromLeft, fromTop, width, height, overlap => {
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
    forEachOverlap(grid, fromLeft, fromTop, width, height, overlap => {
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
