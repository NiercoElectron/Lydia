import type { BlendMode } from './layers'
import type { StoredTile } from './memory'
import { isValidQuad, type Quad, type Rect } from './smartObject'
import { createGrid, TILE_SIZE, tileKey, type Grid } from './tiles'

export const PROJECT_EXTENSION = '.lyd'
export const MIN_SIZE = 16
export const MAX_SIZE = 10000 // the biggest paper Lydia is made to handle well
export const DEFAULT_BACKGROUND = '#ffffff'
// How many pixels make an inch on paper: the drawing's resolution, in DPI. Each drawing has its own, chosen when it is
// created; exported images say it, so printers and other programs know their size on paper. The screen ignores it
// (decision 32). 300 DPI is the usual resolution for printing
export const DEFAULT_DPI = 300
export const MIN_DPI = 1
export const MAX_DPI = 2400
export const isDpi = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= MIN_DPI && (value as number) <= MAX_DPI

// A smart object as it is opened or saved (see smartObject.ts): its source's tiles, the part of the source with paint,
// where that part's corners are on the paper, and how its pixels are worked out
export type SmartData<Tiles> = { tiles: Tiles; bounds: Rect; corners: Quad; smooth: boolean }

export type LayerData = {
  name: string
  visible: boolean
  opacity: number
  blendMode: BlendMode
  tiles: Map<string, StoredTile> // "column,row" -> tile
  smart?: SmartData<Map<string, StoredTile>> // for a smart object
}

// A drawing, as it is opened or created: its paper (size, background and resolution) and its layers, from the bottom
// to the top
export type ProjectData = {
  width: number
  height: number
  background: string | null // the paper's color ("#rrggbb"), or null for a transparent background
  dpi: number // pixels in an inch on paper
  layers: LayerData[] // empty for a new drawing (it starts with one empty layer)
  activeLayer: number // the position of the layer the brush paints on
}

export type Paper = Pick<ProjectData, 'width' | 'height' | 'background' | 'dpi'>

export function newProject(
  width: number,
  height: number,
  background: string | null = DEFAULT_BACKGROUND,
  dpi = DEFAULT_DPI,
): ProjectData {
  return { width, height, background, dpi, layers: [], activeLayer: 0 }
}

export const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

// A layer ready to be written: each tile is either a single color or its compressed bytes
type TileToSave = { column: number; row: number; color?: number; packed?: Uint8Array }
export type LayerToSave = Omit<LayerData, 'tiles' | 'smart'> & { tiles: TileToSave[]; smart?: SmartData<TileToSave[]> }

// ----- The .lyd file (version 3) -----
//
// Bytes 0–7:   "LYDIAPRJ", to recognize the file
// Bytes 8–11:  the length of the header, in bytes (a 32-bit number, least significant byte first)
// Then:        the header, as JSON text (see FileHeader)
// Then:        the tile data: the compressed tiles one after another. The header says where each one starts
//              ("offset", counted from the start of the tile data) and how long it is ("length")
//
// Each compressed tile is in the LZ4 block format (see lz4.ts). Unpacked, it has 4 bytes per pixel (red, green, blue,
// alpha, with the color already multiplied by the alpha), rows from the top to the bottom. Tiles of a single color
// have no data: the header has their color instead. Tiles without paint are not in the file
//
// The header's "background" is the paper's color, or null when it is transparent, and "dpi" is the drawing's
// resolution. Files saved before Lydia 0.5.1 have no background (their paper is white), and files saved before 0.5.2
// have no resolution (they are 300 DPI).
//
// A smart object's layer also has "smart": its source's tiles, listed like the layer's, the rectangle of the source
// with paint ("bounds"), the corners where that rectangle is on the paper, and "smooth". A tile that the layer and its
// source share is stored once. Only files with smart objects are version 3: the others stay version 2, so that
// Lydia 0.7 can still open them

const MAGIC = 'LYDIAPRJ'
const FORMAT = 'lydia'
const VERSION = 3 // the newest version this Lydia can open
const SMART_VERSION = 3 // the first version with smart objects

type TileEntry = { column: number; row: number; color?: number; offset?: number; length?: number }

type FileHeader = {
  format: typeof FORMAT
  version: number
  width: number
  height: number
  tileSize: number
  background: string | null
  dpi: number
  activeLayer: number
  layers: (Omit<LayerData, 'tiles' | 'smart'> & { tiles: TileEntry[]; smart?: SmartData<TileEntry[]> })[]
}

// Turn a drawing into the contents of a .lyd file
export function serializeProject(
  { width, height, background, dpi }: Paper,
  activeLayer: number,
  layers: LayerToSave[],
) {
  const data: Uint8Array[] = []
  let offset = 0
  const offsets = new Map<Uint8Array, number>() // where each tile's bytes are, so a tile used twice is stored once
  const entries = (tiles: TileToSave[]): TileEntry[] =>
    tiles.map(({ column, row, color, packed }) => {
      if (!packed) return { column, row, color }
      let start = offsets.get(packed)
      if (start === undefined) {
        start = offset
        offsets.set(packed, start)
        data.push(packed)
        offset += packed.length
      }
      return { column, row, offset: start, length: packed.length }
    })
  const header: FileHeader = {
    format: FORMAT,
    version: layers.some(layer => layer.smart) ? SMART_VERSION : 2,
    width,
    height,
    tileSize: TILE_SIZE,
    background,
    dpi,
    activeLayer,
    layers: layers.map(({ tiles, smart, ...layer }) => ({
      ...layer,
      tiles: entries(tiles),
      smart: smart && { ...smart, tiles: entries(smart.tiles) },
    })),
  }

  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const start = new Uint8Array(12)
  start.set(new TextEncoder().encode(MAGIC))
  new DataView(start.buffer).setUint32(8, headerBytes.length, true)
  return new Blob([start, headerBytes, ...data] as BlobPart[], { type: 'application/octet-stream' })
}

// Read the contents of a .lyd file back into a drawing. Throws an Error with a message for the user if the file can't
// be opened
export function parseProject(file: ArrayBuffer): ProjectData {
  const bytes = new Uint8Array(file)
  const startsWith = (text: string) => new TextDecoder().decode(bytes.subarray(0, text.length)) === text

  if (!startsWith(MAGIC)) {
    // Lydia 0.1 saved projects as plain JSON text
    if (startsWith('{"format":"lydia"')) {
      throw new Error('This project was made with Lydia 0.1, and this version of Lydia can no longer open it.')
    }
    throw new Error('This file is not a Lydia project.')
  }
  const damaged = () => new Error('This project file is damaged.')
  if (bytes.length < 12) throw damaged()

  const headerLength = new DataView(file).getUint32(8, true)
  const dataStart = 12 + headerLength
  if (dataStart > bytes.length) throw damaged()
  let header: unknown
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, dataStart)))
  } catch {
    throw damaged()
  }
  if (!isObject(header) || header.format !== FORMAT) throw damaged()
  if (typeof header.version !== 'number' || header.version > VERSION) {
    throw new Error('This project was made with a newer version of Lydia. Update Lydia to open it.')
  }

  const { width, height, tileSize, background, dpi, activeLayer, layers } = header
  const isSize = (n: unknown) => isInteger(n) && n >= MIN_SIZE && n <= MAX_SIZE
  if (!isSize(width) || !isSize(height) || tileSize !== TILE_SIZE || !Array.isArray(layers)) throw damaged()
  const grid = createGrid(width as number, height as number)

  // A list of tiles from the header. Tiles stored as bytes are views into the file's bytes, without copying them
  function readTiles(entries: unknown[]) {
    const tiles = new Map<string, StoredTile>()
    for (const entry of entries) {
      if (!isObject(entry)) throw damaged()
      const { column, row, color, offset, length } = entry
      const isInGrid =
        isInteger(column) && isInteger(row) && column >= 0 && column < grid.columns && row >= 0 && row < grid.rows
      if (!isInGrid) throw damaged()
      if (color !== undefined) {
        if (!isInteger(color) || color < 0 || color > 0xffffffff) throw damaged()
        tiles.set(tileKey(column, row), { color, lastUsed: 0 })
      } else {
        if (!isInteger(offset) || !isInteger(length) || offset < 0 || length <= 0) throw damaged()
        if (dataStart + offset + length > bytes.length) throw damaged()
        tiles.set(tileKey(column, row), { packed: new Uint8Array(file, dataStart + offset, length), lastUsed: 0 })
      }
    }
    return tiles
  }

  const project: ProjectData = {
    width: grid.width,
    height: grid.height,
    background: background === null ? null : isColor(background) ? background : DEFAULT_BACKGROUND,
    dpi: isDpi(dpi) ? dpi : DEFAULT_DPI,
    layers: layers.map(layer => {
      if (
        !isObject(layer) ||
        typeof layer.name !== 'string' ||
        typeof layer.visible !== 'boolean' ||
        typeof layer.opacity !== 'number' ||
        !(layer.opacity >= 0 && layer.opacity <= 1) ||
        (layer.blendMode !== 'normal' && layer.blendMode !== 'multiply') ||
        !Array.isArray(layer.tiles)
      ) {
        throw damaged()
      }
      const { name, visible, opacity, blendMode } = layer
      const data: LayerData = { name, visible, opacity, blendMode, tiles: readTiles(layer.tiles) }
      if (layer.smart !== undefined) {
        const smart = layer.smart
        if (
          !isObject(smart) ||
          !Array.isArray(smart.tiles) ||
          !isBounds(smart.bounds, grid) ||
          !isCorners(smart.corners) ||
          typeof smart.smooth !== 'boolean'
        ) {
          throw damaged()
        }
        data.smart = {
          tiles: readTiles(smart.tiles),
          bounds: smart.bounds,
          corners: smart.corners,
          smooth: smart.smooth,
        }
      }
      return data
    }),
    activeLayer: 0,
  }
  if (isInteger(activeLayer) && activeLayer >= 0 && activeLayer < project.layers.length) {
    project.activeLayer = activeLayer
  }
  return project
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isInteger(value: unknown): value is number {
  return Number.isInteger(value)
}

// A rectangle of whole pixels inside the paper
function isBounds(value: unknown, grid: Grid): value is Rect {
  if (!isObject(value)) return false
  const { x, y, width, height } = value
  if (!isInteger(x) || !isInteger(y) || !isInteger(width) || !isInteger(height)) return false
  return x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= grid.width && y + height <= grid.height
}

// Four corners a smart object can have (see isValidQuad)
function isCorners(value: unknown): value is Quad {
  if (!Array.isArray(value) || value.length !== 4) return false
  const isPoint = (point: unknown) => isObject(point) && Number.isFinite(point.x) && Number.isFinite(point.y)
  return value.every(isPoint) && isValidQuad(value as Quad)
}
