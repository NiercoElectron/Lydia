import type { BlendMode } from './layers'
import type { StoredTile } from './memory'
import { createGrid, TILE_SIZE, tileKey } from './tiles'

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

export type LayerData = {
  name: string
  visible: boolean
  opacity: number
  blendMode: BlendMode
  tiles: Map<string, StoredTile> // "column,row" -> tile
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
export type LayerToSave = Omit<LayerData, 'tiles'> & {
  tiles: { column: number; row: number; color?: number; packed?: Uint8Array }[]
}

// ----- The .lyd file (version 2) -----
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
// have no resolution (they are 300 DPI)

const MAGIC = 'LYDIAPRJ'
const FORMAT = 'lydia'
const VERSION = 2

type TileEntry = { column: number; row: number; color?: number; offset?: number; length?: number }

type FileHeader = {
  format: typeof FORMAT
  version: typeof VERSION
  width: number
  height: number
  tileSize: number
  background: string | null
  dpi: number
  activeLayer: number
  layers: (Omit<LayerData, 'tiles'> & { tiles: TileEntry[] })[]
}

// Turn a drawing into the contents of a .lyd file
export function serializeProject(
  { width, height, background, dpi }: Paper,
  activeLayer: number,
  layers: LayerToSave[],
) {
  const data: Uint8Array[] = []
  let offset = 0
  const header: FileHeader = {
    format: FORMAT,
    version: VERSION,
    width,
    height,
    tileSize: TILE_SIZE,
    background,
    dpi,
    activeLayer,
    layers: layers.map(({ tiles, ...layer }) => ({
      ...layer,
      tiles: tiles.map(({ column, row, color, packed }) => {
        if (!packed) return { column, row, color }
        const entry = { column, row, offset, length: packed.length }
        data.push(packed)
        offset += packed.length
        return entry
      }),
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
      const tiles = new Map<string, StoredTile>()
      for (const entry of layer.tiles) {
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
          // A view into the file's bytes, without copying them
          tiles.set(tileKey(column, row), { packed: new Uint8Array(file, dataStart + offset, length), lastUsed: 0 })
        }
      }
      return { name: layer.name, visible: layer.visible, opacity: layer.opacity, blendMode: layer.blendMode, tiles }
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
