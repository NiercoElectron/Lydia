import { LydiaError } from '../errors'
import { LAYER_BLEND_MODES, type BlendMode } from './layers'
import { isRulers, type Rulers } from './rulers'
import { isSymmetry, type Symmetry } from './symmetry'
import { decompress } from './lz4'
import type { StoredTile } from './memory'
import type { Point } from './selection'
import { isValidQuad, type Quad, type Rect } from './smartObject'
import { WARP_SIDES, type Warp } from './warp'
import { createGrid, TILE_SIZE, tileKey, tileSize, type Grid } from './tiles'

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

// Exported images can be enlarged, each pixel of the drawing a square of 2×2, 3×3... pixels, for pixel art (decision
// 53). Each drawing keeps its own choice
export const EXPORT_SCALES = [1, 2, 3, 4, 6, 8]
// An enlarged image must still fit: browsers make pictures up to 16384 pixels across, and it can't have more pixels
// than the biggest paper
const MAX_EXPORT_SIDE = 16384
export const fitsExport = (width: number, height: number, scale: number) =>
  width * scale <= MAX_EXPORT_SIDE && height * scale <= MAX_EXPORT_SIDE && width * height * scale ** 2 <= MAX_SIZE ** 2

// A smart object as it is opened or saved (see smartObject.ts): its source's tiles, the part of the source with paint,
// where that part's corners are on the paper, and how its pixels are worked out
export type SmartData<Tiles> = { tiles: Tiles; bounds: Rect; corners: Quad; smooth: boolean; warp?: Warp }

export type LayerData = {
  name: string
  visible: boolean
  opacity: number
  blendMode: BlendMode
  showOffPaper?: boolean // its paint off the paper shows around the paper (see outsideView.ts)
  alphaLocked?: boolean // its transparency is locked (see layers.ts)
  clipped?: boolean // it is clipped to the layers under it (see layers.ts)
  folder?: { open: boolean } // set for a folder (see isFolder in layers.ts), which has no tiles
  parent?: number // the position of the folder it is in, if any
  tiles: Map<string, StoredTile> // "column,row" -> tile
  smart?: SmartData<Map<string, StoredTile>> // for a smart object
}

// How the drawing was shown when it was saved (see view.ts), so it opens the same way: the zoom, the angle in degrees,
// the flip, and the point of the paper in the middle of the screen, which stays in the middle in a window of another
// size
export type ViewData = { zoom: number; rotation: number; flipped: boolean; center: Point }

// A drawing, as it is opened or created: its paper (size, background and resolution) and its layers, from the bottom
// to the top
export type ProjectData = {
  width: number
  height: number
  background: string | null // the paper's color ("#rrggbb"), or null for a transparent background
  dpi: number // pixels in an inch on paper
  layers: LayerData[] // empty for a new drawing (it starts with one empty layer)
  activeLayer: number // the position of the layer the brush paints on
  view?: ViewData // none for a new drawing, which shows the whole paper
  exportScale?: number // how many times bigger images are exported (see EXPORT_SCALES); 1 when missing
  colors?: string[] // the drawing's own colors in the color tray (see ColorTray.tsx), "#rrggbb"; none when missing
  symmetry?: Symmetry // see symmetry.ts; off when missing
  rulers?: Rulers // see rulers.ts; none when missing
  fromAutosave?: string // recovered from this copy (see autosave.ts): it isn't in any file yet
}

// At most this many colors in each list of the color tray
export const MAX_TRAY_COLORS = 60

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

// ----- The .lyd file (version 4) -----
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
// have no resolution (they are 300 DPI). Since 0.8.3, "view" is how the drawing was shown (see ViewData); a file without
// it, or with one that makes no sense, opens showing the whole paper.
//
// A smart object's layer also has "smart": its source's tiles, listed like the layer's, the rectangle of the source
// with paint ("bounds"), the corners where that rectangle is on the paper, and "smooth". A tile that the layer and its
// source share is stored once. Only files with smart objects are version 3: the others stay version 2, so that
// Lydia 0.7 can still open them. Since 0.15, "smart" can have "warp", the mesh that bends it (see warp.ts): older
// versions don't know it, and show the layer's tiles, bent as they were saved, until it is transformed again.
//
// In versions 2 and 3, tiles are on the paper, and the ones at its right and bottom edges are cut there. Since Lydia
// 0.10, layers can have paint off the paper (decision 49): a drawing with some is version 4, where every tile is whole
// (TILE_SIZE × TILE_SIZE) and can be anywhere (its column and row can be negative), and so can a smart object's
// source and "bounds". A drawing with nothing off the paper is still saved as version 2 or 3, so older versions of
// Lydia can open it. A layer's "showOffPaper" (since 0.10) says it shows its paint off the paper; it is false when
// missing, its "alphaLocked" (since 0.11) that its transparency is locked, and its "clipped" (since 0.11) that it is
// clipped to the layers under it, both false when missing. Its "blendMode" is
// one of LAYER_BLEND_MODES (before 0.11, only "normal" or "multiply"), or "pass-through" for a folder. Since 0.11,
// "folder" makes a layer a folder (see isFolder in layers.ts), with no tiles, and "parent" is the position of the
// folder a layer or folder is in: a folder is above what is in it, and all that is between them is in it too. The
// header's
// "exportScale" (since 0.10) is how many times bigger images are exported; 1 when missing. "symmetry" (since 0.17) is
// how strokes are mirrored (see symmetry.ts), left out when off, and "rulers" (since 0.17) what strokes follow (see
// rulers.ts), left out when there are none; older versions of Lydia don't know them

const MAGIC = 'LYDIAPRJ'
const FORMAT = 'lydia'
const VERSION = 4 // the newest version this Lydia can open
const SMART_VERSION = 3 // the first version with smart objects
const WHOLE_TILES_VERSION = 4 // the first version with whole tiles, off the paper too
// How far from the paper's corner a tile can be, in tiles each way: far beyond anything a drawing needs, so a damaged
// file can't make Lydia go through millions of places
const MAX_TILE_INDEX = 4096

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
  view?: ViewData
  exportScale?: number
  colors?: string[] // older versions of Lydia don't know it, and open the file without them
  symmetry?: Symmetry
  rulers?: Rulers
  layers: (Omit<LayerData, 'tiles' | 'smart'> & { tiles: TileEntry[]; smart?: SmartData<TileEntry[]> })[]
}

// Turn a drawing into the contents of a .lyd file. "wholeTiles": its tiles are whole, some of them off the paper
// (version 4); otherwise they are on the paper, cut at its edge
export function serializeProject(
  {
    width,
    height,
    background,
    dpi,
    exportScale = 1,
    colors = [],
    symmetry,
    rulers,
  }: Paper & Pick<ProjectData, 'exportScale' | 'colors' | 'symmetry' | 'rulers'>,
  activeLayer: number,
  view: ViewData,
  layers: LayerToSave[],
  wholeTiles: boolean,
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
    version: wholeTiles ? WHOLE_TILES_VERSION : layers.some(layer => layer.smart) ? SMART_VERSION : 2,
    width,
    height,
    tileSize: TILE_SIZE,
    background,
    dpi,
    activeLayer,
    view,
    exportScale,
    colors: colors.length > 0 ? colors : undefined,
    symmetry: symmetry?.mode === 'off' ? undefined : symmetry,
    rulers: rulers?.list.length ? rulers : undefined,
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

// Whether each layer's folder is a folder above it, with all that is between them in it too (see isFolder in
// layers.ts)
function areFoldersWhole(layers: LayerData[]) {
  const isAbove = layers.every(
    ({ parent }, index) => parent === undefined || (parent > index && parent < layers.length),
  )
  if (!isAbove) return false // checked first, so that going from folder to folder always goes up, and ends
  const isIn = (index: number, folder: number) => {
    for (let parent = layers[index].parent; parent !== undefined; parent = layers[parent].parent) {
      if (parent === folder) return true
    }
    return false
  }
  return layers.every(({ parent }, index) => {
    if (parent === undefined) return true
    if (!layers[parent].folder) return false
    for (let between = index + 1; between < parent; between++) if (!isIn(between, parent)) return false
    return true
  })
}

// Read the contents of a .lyd file back into a drawing. Throws an Error with a message for the user if the file can't
// be opened
export function parseProject(file: ArrayBuffer): ProjectData {
  const bytes = new Uint8Array(file)
  const startsWith = (text: string) => new TextDecoder().decode(bytes.subarray(0, text.length)) === text

  if (!startsWith(MAGIC)) {
    // Lydia 0.1 saved projects as plain JSON text
    if (startsWith('{"format":"lydia"')) {
      throw new LydiaError('LYD-102')
    }
    throw new LydiaError('LYD-101')
  }
  const damaged = () => new LydiaError('LYD-104')
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
    throw new LydiaError('LYD-103')
  }

  const { width, height, tileSize, background, dpi, activeLayer, view, exportScale, colors, symmetry, rulers, layers } =
    header
  const isSize = (n: unknown) => isInteger(n) && n >= MIN_SIZE && n <= MAX_SIZE
  if (!isSize(width) || !isSize(height) || tileSize !== TILE_SIZE || !Array.isArray(layers)) throw damaged()
  const grid = createGrid(width as number, height as number)
  const isWhole = header.version >= WHOLE_TILES_VERSION

  // A list of tiles from the header. Tiles stored as bytes are views into the file's bytes, without copying them. In
  // older files, the tiles at the paper's edges are cut there: they are made whole
  function readTiles(entries: unknown[]) {
    const tiles = new Map<string, StoredTile>()
    for (const entry of entries) {
      if (!isObject(entry)) throw damaged()
      const { column, row, color, offset, length } = entry
      if (!isInteger(column) || !isInteger(row)) throw damaged()
      const isInPlace = isWhole
        ? Math.abs(column) <= MAX_TILE_INDEX && Math.abs(row) <= MAX_TILE_INDEX
        : column >= 0 && column < grid.columns && row >= 0 && row < grid.rows
      if (!isInPlace) throw damaged()
      let tile: StoredTile
      if (color !== undefined) {
        if (!isInteger(color) || color < 0 || color > 0xffffffff) throw damaged()
        tile = { color, lastUsed: 0 }
      } else {
        if (!isInteger(offset) || !isInteger(length) || offset < 0 || length <= 0) throw damaged()
        if (dataStart + offset + length > bytes.length) throw damaged()
        tile = { packed: new Uint8Array(file, dataStart + offset, length), lastUsed: 0 }
      }
      tiles.set(tileKey(column, row), isWhole ? tile : wholeTile(grid, column, row, tile, damaged))
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
        !(
          (LAYER_BLEND_MODES as readonly unknown[]).includes(layer.blendMode) ||
          (layer.blendMode === 'pass-through' && layer.folder !== undefined)
        ) ||
        !Array.isArray(layer.tiles)
      ) {
        throw damaged()
      }
      const { name, visible, opacity } = layer
      const blendMode = layer.blendMode as BlendMode // checked above
      const data: LayerData = { name, visible, opacity, blendMode, tiles: readTiles(layer.tiles) }
      if (layer.showOffPaper === true) data.showOffPaper = true
      if (layer.alphaLocked === true) data.alphaLocked = true
      if (layer.clipped === true) data.clipped = true
      if (layer.folder !== undefined) {
        const { folder } = layer
        if (!isObject(folder) || typeof folder.open !== 'boolean' || data.tiles.size > 0 || layer.smart !== undefined) {
          throw damaged()
        }
        data.folder = { open: folder.open }
      }
      if (layer.parent !== undefined) {
        if (!isInteger(layer.parent)) throw damaged()
        data.parent = layer.parent
      }
      if (layer.smart !== undefined) {
        const smart = layer.smart
        if (
          !isObject(smart) ||
          !Array.isArray(smart.tiles) ||
          !isBounds(smart.bounds, grid, isWhole) ||
          !isCorners(smart.corners) ||
          typeof smart.smooth !== 'boolean' ||
          (smart.warp !== undefined && !isWarp(smart.warp))
        ) {
          throw damaged()
        }
        data.smart = {
          tiles: readTiles(smart.tiles),
          bounds: smart.bounds,
          corners: smart.corners,
          smooth: smart.smooth,
          ...(smart.warp !== undefined && { warp: smart.warp }),
        }
      }
      return data
    }),
    activeLayer: 0,
  }
  if (!areFoldersWhole(project.layers)) throw damaged()
  if (isInteger(activeLayer) && activeLayer >= 0 && activeLayer < project.layers.length) {
    project.activeLayer = activeLayer
  }
  if (isView(view)) project.view = view
  if (isSymmetry(symmetry, grid.width, grid.height)) project.symmetry = symmetry
  if (isRulers(rulers)) project.rulers = rulers
  if (EXPORT_SCALES.includes(exportScale as number)) project.exportScale = exportScale as number
  if (Array.isArray(colors)) {
    const kept = colors.filter(isColor).map(color => color.toLowerCase())
    if (kept.length > 0) project.colors = kept.slice(0, MAX_TRAY_COLORS)
  }
  return project
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isInteger(value: unknown): value is number {
  return Number.isInteger(value)
}

// A rectangle of whole pixels: inside the paper, or with whole tiles ("isWhole") anywhere tiles can be
function isBounds(value: unknown, grid: Grid, isWhole: boolean): value is Rect {
  if (!isObject(value)) return false
  const { x, y, width, height } = value
  if (!isInteger(x) || !isInteger(y) || !isInteger(width) || !isInteger(height)) return false
  if (width <= 0 || height <= 0) return false
  if (!isWhole) return x >= 0 && y >= 0 && x + width <= grid.width && y + height <= grid.height
  const far = MAX_TILE_INDEX * TILE_SIZE
  return Math.abs(x) <= far && Math.abs(y) <= far && width <= 2 * far && height <= 2 * far
}

// A tile from a file of version 2 or 3 as a whole tile: the same tile when it is all on the paper; at the paper's right
// and bottom edges, where it was cut, its pixels with nothing around them. "damaged" makes the error for bytes that
// don't unpack
function wholeTile(grid: Grid, column: number, row: number, tile: StoredTile, damaged: () => Error): StoredTile {
  const { width, height } = tileSize(grid, column, row)
  if (width === TILE_SIZE && height === TILE_SIZE) return tile
  const part = new Uint8ClampedArray(width * height * 4)
  if (tile.color !== undefined) {
    new Uint32Array(part.buffer).fill(tile.color)
  } else {
    try {
      decompress(tile.packed!, part)
    } catch {
      throw damaged()
    }
  }
  const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4)
  for (let y = 0; y < height; y++) pixels.set(part.subarray(y * width * 4, (y + 1) * width * 4), y * TILE_SIZE * 4)
  return { pixels, lastUsed: 0 }
}

// How a drawing can be shown (see ViewData). A view that isn't one only loses the view, not the drawing
function isView(value: unknown): value is ViewData {
  if (!isObject(value) || !isObject(value.center)) return false
  const { zoom, rotation, flipped, center } = value
  return (
    typeof zoom === 'number' &&
    zoom > 0 &&
    Number.isFinite(zoom) &&
    Number.isFinite(rotation) &&
    typeof flipped === 'boolean' &&
    Number.isFinite(center.x) &&
    Number.isFinite(center.y)
  )
}

const isPoint = (point: unknown) => isObject(point) && Number.isFinite(point.x) && Number.isFinite(point.y)

// A mesh a smart object can have (see warp.ts)
function isWarp(value: unknown): value is Warp {
  if (!isObject(value) || !WARP_SIDES.includes(value.side as number) || !Array.isArray(value.points)) return false
  return value.points.length === (value.side as number) ** 2 && value.points.every(isPoint)
}

// Four corners a smart object can have (see isValidQuad)
function isCorners(value: unknown): value is Quad {
  if (!Array.isArray(value) || value.length !== 4) return false
  return value.every(isPoint) && isValidQuad(value as Quad)
}
