// The paper is divided into a grid of square tiles. Each layer keeps only the tiles that have paint, so memory grows
// with what is painted, not with the size of the paper. A layer's tiles are always whole (TILE_SIZE × TILE_SIZE) and
// can be anywhere, off the paper too (decision 49): paint moved or put off the paper is kept there, not shown, and
// comes back when it is moved onto the paper again. What belongs to the paper itself (the picture the screen shows,
// selections, the strokes being painted, the fill) only has the tiles on the paper, cut at its edge
export const TILE_SIZE = 256

// How many whole tiles fit in this many GB (each pixel takes 4 bytes)
export function tilesInGigabytes(gigabytes: number) {
  return Math.floor((gigabytes * 1024 ** 3) / (TILE_SIZE * TILE_SIZE * 4))
}

// The grid of tiles that covers a paper of this size. On the paper, the last column and row are cut at its edge
// (10000 is not a multiple of 256)
export type Grid = {
  width: number
  height: number
  columns: number
  rows: number
}

export function createGrid(width: number, height: number): Grid {
  return { width, height, columns: Math.ceil(width / TILE_SIZE), rows: Math.ceil(height / TILE_SIZE) }
}

// The name of a tile in maps: "column,row"
export function tileKey(column: number, row: number) {
  return `${column},${row}`
}

export function parseTileKey(key: string) {
  const [column, row] = key.split(',').map(Number)
  return { column, row }
}

// Whether the tile at this column and row is on the paper (in part, at its right and bottom edges)
export function isOnPaper(grid: Grid, column: number, row: number) {
  return column >= 0 && row >= 0 && column < grid.columns && row < grid.rows
}

// The size of the part of a tile on the paper, in pixels: smaller at the right and bottom edges of the paper
export function tileSize(grid: Grid, column: number, row: number) {
  return {
    width: Math.min(TILE_SIZE, grid.width - column * TILE_SIZE),
    height: Math.min(TILE_SIZE, grid.height - row * TILE_SIZE),
  }
}

// Call "callback" for every tile of the paper
export function forEachTile(grid: Grid, callback: (column: number, row: number) => void) {
  for (let column = 0; column < grid.columns; column++) {
    for (let row = 0; row < grid.rows; row++) callback(column, row)
  }
}

// The tiles a rectangle covers, on the paper or off it
export function tilesTouching(left: number, top: number, right: number, bottom: number) {
  return {
    firstColumn: Math.floor(left / TILE_SIZE),
    lastColumn: Math.ceil(right / TILE_SIZE) - 1,
    firstRow: Math.floor(top / TILE_SIZE),
    lastRow: Math.ceil(bottom / TILE_SIZE) - 1,
  }
}

// The part of a layer's whole tile that is on the paper ("width" × "height", see tileSize), from its pixels: the same
// pixels for a tile all on the paper, and a copy of the part on the paper at its right and bottom edges
export function paperPart(pixels: Uint8ClampedArray, width: number, height: number) {
  if (width === TILE_SIZE && height === TILE_SIZE) return pixels
  const part = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    part.set(pixels.subarray(y * TILE_SIZE * 4, (y * TILE_SIZE + width) * 4), y * width * 4)
  return part
}

// A mask of a tile's part on the paper (a selection's, a fill's: one value per pixel, or "full" for all of it) as a
// mask of a layer's whole tile: the same mask for a tile all on the paper, and at the paper's right and bottom edges, a
// mask of the whole tile with nothing off the paper ("full" there is "fullValue" on every pixel on the paper)
export function wholeTileMask(grid: Grid, key: string, mask: Uint8Array | 'full', fullValue: number) {
  const { column, row } = parseTileKey(key)
  const { width, height } = tileSize(grid, column, row)
  if (width === TILE_SIZE && height === TILE_SIZE) return mask
  const whole = new Uint8Array(TILE_SIZE * TILE_SIZE)
  for (let y = 0; y < height; y++) {
    if (mask === 'full') whole.fill(fullValue, y * TILE_SIZE, y * TILE_SIZE + width)
    else whole.set(mask.subarray(y * width, (y + 1) * width), y * TILE_SIZE)
  }
  return whole
}

// The tiles a rectangle of the paper covers (the part outside the paper is cut off), or null if it is all outside
export function tilesInRect(grid: Grid, left: number, top: number, right: number, bottom: number) {
  left = Math.max(0, left)
  top = Math.max(0, top)
  right = Math.min(grid.width, right)
  bottom = Math.min(grid.height, bottom)
  if (left >= right || top >= bottom) return null
  return {
    firstColumn: Math.floor(left / TILE_SIZE),
    lastColumn: Math.ceil(right / TILE_SIZE) - 1,
    firstRow: Math.floor(top / TILE_SIZE),
    lastRow: Math.ceil(bottom / TILE_SIZE) - 1,
  }
}
