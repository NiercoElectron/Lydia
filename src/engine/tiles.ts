// The paper is divided into a grid of square tiles. Each layer keeps only the tiles that have paint, so memory grows
// with what is painted, not with the size of the paper
export const TILE_SIZE = 256

// The grid of tiles that covers a paper of this size. The last column and row are cut at the edge of the paper
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

// The size of a tile in pixels, smaller at the right and bottom edges of the paper
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
