import { LydiaError } from '../errors'
import type { BrushPicture, ForeignBrush, LeftOut } from './foreignBrush'

// GIMP's brushes, which Krita uses too. A .gbr is a header with the numbers big end first, and then the pixels. A .gih is
// two lines of text and then a .gbr for each picture of its tip

const HEADER_V1 = 20
const MAGIC_AT = 20
const GIMP_MAGIC = 'GIMP'
const NAME_AT_V2 = 28
const MAX_SIDE = 10000 // the most GIMP itself reads
const GRAY = 1
const GRAY_ALPHA = 2
const RGBA = 4
const LINE_END = 10

type GimpTip = { name: string; spacing: number | null; picture: BrushPicture; hasColors: boolean; end: number }

// One .gbr starting at "start". In a gray one 255 paints fully, and in one with colors the alpha says how much it paints
export function readGbr(bytes: Uint8Array, start = 0): GimpTip {
  if (start + HEADER_V1 > bytes.length) throw new LydiaError('LYD-218')
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, bytes.byteLength - start)
  const headerSize = view.getUint32(0)
  const version = view.getUint32(4)
  const width = view.getUint32(8)
  const height = view.getUint32(12)
  const depth = view.getUint32(16)
  const hasMagic =
    version > 1 && String.fromCharCode(...bytes.subarray(start + MAGIC_AT, start + MAGIC_AT + 4)) === GIMP_MAGIC
  const isKnown = version === 1 || hasMagic
  const size = width * height * depth
  const isSane = width > 0 && height > 0 && width <= MAX_SIDE && height <= MAX_SIDE
  if (!isKnown || !isSane || headerSize < HEADER_V1 || start + headerSize + size > bytes.length) {
    throw new LydiaError('LYD-218')
  }
  if (depth !== GRAY && depth !== GRAY_ALPHA && depth !== RGBA) throw new LydiaError('LYD-218')

  const nameStart = start + (version === 1 ? HEADER_V1 : NAME_AT_V2)
  const nameBytes = bytes.subarray(nameStart, start + headerSize)
  const nameEnd = nameBytes.indexOf(0)
  const name = new TextDecoder().decode(nameEnd < 0 ? nameBytes : nameBytes.subarray(0, nameEnd)).trim()

  const pixels = bytes.subarray(start + headerSize, start + headerSize + size)
  const values = new Uint8Array(width * height)
  let hasColors = false
  for (let i = 0; i < values.length; i++) {
    values[i] = pixels[i * depth + depth - 1]
    if (depth === RGBA) {
      const at = i * RGBA
      if (pixels[at] !== pixels[at + 1] || pixels[at + 1] !== pixels[at + 2]) hasColors = true
    }
  }
  return {
    name,
    spacing: version === 1 ? null : view.getUint32(24) / 100,
    picture: { width, height, values },
    hasColors,
    end: start + headerSize + size,
  }
}

// The first picture of a .gih: a Lydia brush has one tip, and the others are left out
export function readGih(bytes: Uint8Array) {
  const firstLine = bytes.indexOf(LINE_END)
  const secondLine = bytes.indexOf(LINE_END, firstLine + 1)
  if (firstLine < 0 || secondLine < 0) throw new LydiaError('LYD-218')
  const name = new TextDecoder().decode(bytes.subarray(0, firstLine)).trim()
  const cells = Number.parseInt(new TextDecoder().decode(bytes.subarray(firstLine + 1, secondLine)), 10)
  if (!(cells > 0)) throw new LydiaError('LYD-218')
  const tip = readGbr(bytes, secondLine + 1)
  return { ...tip, name: name || tip.name, frames: cells }
}

export function readGimpBrush(fileName: string, bytes: Uint8Array): ForeignBrush[] {
  const isPipe = fileName.toLowerCase().endsWith('.gih')
  const tip = isPipe ? readGih(bytes) : { ...readGbr(bytes), frames: 1 }
  const leftOut: LeftOut[] = []
  if (tip.hasColors) leftOut.push('tipColors')
  if (tip.frames > 1) leftOut.push('tipFrames')
  return [
    {
      name: tip.name || fileName,
      shape: tip.spacing === null ? {} : { spacing: tip.spacing },
      tip: tip.picture,
      leftOut,
    },
  ]
}
