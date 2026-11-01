import { LydiaError } from '../errors'
import type { BrushShape } from './brushFile'
import { roundTip, type BrushPicture, type ForeignBrush, type LeftOut } from './foreignBrush'

// Photoshop's brushes (.abr). Adobe doesn't describe this format, so what is read here comes from how GIMP and Krita read
// it, and from real files. Numbers go big end first. Versions 1 and 2 are a list of brushes. From version 6 there are
// sections: "samp" has the pictures, each with a key, and "desc" has the brushes themselves, in Photoshop's own way of
// describing things, naming the key of their picture. The brushes with no picture, worked out from a diameter and a
// hardness, are only there

const SECTION_TAG = '8BIM'
const SAMPLED = 2
const MAX_SIDE = 16384
const PRESSURE = 2 // the pen's pressure in Photoshop's list of what can control something
const OFF = 0

// A place in some bytes, moving forward as they are read
function createReader(bytes: Uint8Array, start = 0) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = start

  function take(size: number) {
    if (at < 0 || at + size > bytes.length) throw new LydiaError('LYD-218')
    at += size
    return at - size
  }

  const long = () => view.getInt32(take(4))
  const latin = (size: number) => {
    const from = take(size)
    return String.fromCharCode(...bytes.subarray(from, from + size))
  }

  return {
    place: () => at,
    goTo: (place: number) => {
      at = place
    },
    left: () => bytes.length - at,
    byte: () => view.getUint8(take(1)),
    short: () => view.getInt16(take(2)),
    long,
    double: () => view.getFloat64(take(8)),
    latin,
    slice: (size: number) => {
      const from = take(size)
      return bytes.subarray(from, from + size)
    },
    unicode: () => {
      const size = long()
      const from = take(size * 2)
      let text = ''
      for (let i = 0; i < size; i++) text += String.fromCharCode(view.getUint16(from + i * 2))
      return text.replace(/\0+$/, '')
    },
    // A name of Photoshop's own: its size, or 0 for four letters
    id: () => {
      const size = long()
      return latin(size === 0 ? 4 : size)
    },
  }
}

type Reader = ReturnType<typeof createReader>

// ----- Photoshop's descriptions -----

type Value = string | number | boolean | Described | Value[] | null
type Described = { [key: string]: Value; className: string }

function readValue(reader: Reader): Value {
  const kind = reader.latin(4)
  switch (kind) {
    case 'Objc':
    case 'GlbO':
      return readDescribed(reader)
    case 'VlLs': {
      const count = reader.long()
      const list: Value[] = []
      for (let i = 0; i < count; i++) list.push(readValue(reader))
      return list
    }
    case 'TEXT':
      return reader.unicode()
    case 'UntF':
      reader.latin(4) // its unit: pixels, percent or degrees, which each value here always has the same of
      return reader.double()
    case 'doub':
      return reader.double()
    case 'long':
      return reader.long()
    case 'bool':
      return reader.byte() !== 0
    case 'enum':
      reader.id()
      return reader.id()
    case 'tdta':
      reader.slice(reader.long())
      return null
    case 'type':
    case 'GlbC':
      reader.unicode()
      return reader.id()
    default:
      throw new LydiaError('LYD-218')
  }
}

function readDescribed(reader: Reader): Described {
  reader.unicode()
  const described: Described = { className: reader.id() }
  const count = reader.long()
  for (let i = 0; i < count; i++) {
    const key = reader.id()
    described[key] = readValue(reader)
  }
  return described
}

const numberIn = (described: Described, key: string, fallback: number) => {
  const value = described[key]
  return typeof value === 'number' ? value : fallback
}
const isObject = (value: Value | undefined): value is Described =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// ----- Pictures -----

// Lines compressed one by one, with the size of each first: a number below 128 copies that many bytes and one more, and
// another repeats the next byte
function unpackLines(reader: Reader, width: number, height: number) {
  const sizes = Array.from({ length: height }, () => reader.short() & 0xffff)
  const values = new Uint8Array(width * height)
  let to = 0
  for (const size of sizes) {
    const end = reader.place() + size
    while (reader.place() < end) {
      const count = reader.byte()
      if (count === 128) continue
      if (count < 128) {
        values.set(reader.slice(count + 1).subarray(0, values.length - to), to)
        to += count + 1
      } else {
        const repeated = reader.byte()
        const times = 257 - count
        values.fill(repeated, to, to + times)
        to += times
      }
    }
  }
  return values
}

function readPixels(reader: Reader, width: number, height: number, bits: number, isCompressed: boolean): BrushPicture {
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) throw new LydiaError('LYD-218')
  if (isCompressed) {
    if (bits !== 8) throw new LydiaError('LYD-218')
    return { width, height, values: unpackLines(reader, width, height) }
  }
  if (bits === 8) return { width, height, values: reader.slice(width * height) }
  if (bits !== 16) throw new LydiaError('LYD-218')
  const wide = reader.slice(width * height * 2)
  const values = new Uint8Array(width * height)
  for (let i = 0; i < values.length; i++) values[i] = wide[i * 2 + 1] // small end first, as GIMP reads them
  return { width, height, values }
}

// ----- Versions 1 and 2 -----

function readOldBrushes(reader: Reader, version: number, count: number, fileName: string) {
  const brushes: ForeignBrush[] = []
  for (let i = 0; i < count; i++) {
    const type = reader.short()
    const size = reader.long()
    const next = reader.place() + size
    if (type === SAMPLED) {
      reader.long()
      const spacing = reader.short()
      const name = version === 2 ? reader.unicode() : ''
      reader.byte()
      for (let side = 0; side < 4; side++) reader.short()
      const top = reader.long()
      const left = reader.long()
      const bottom = reader.long()
      const right = reader.long()
      const bits = reader.short()
      const isCompressed = reader.byte() !== 0
      brushes.push({
        name: name || `${fileName} ${i + 1}`,
        shape: { spacing: spacing / 100 },
        tip: readPixels(reader, right - left, bottom - top, bits, isCompressed),
        leftOut: [],
      })
    }
    reader.goTo(next)
  }
  return brushes
}

// ----- From version 6 -----

function readSamples(bytes: Uint8Array, subversion: number) {
  const reader = createReader(bytes)
  const pictures = new Map<string, BrushPicture>()
  while (reader.left() > 4) {
    const size = reader.long()
    const start = reader.place()
    const next = start + ((size + 3) & ~3)
    const key = reader.latin(reader.byte())
    reader.goTo(start + (subversion === 1 ? 47 : 301))
    const top = reader.long()
    const left = reader.long()
    const bottom = reader.long()
    const right = reader.long()
    const bits = reader.short()
    const isCompressed = reader.byte() !== 0
    pictures.set(key, readPixels(reader, right - left, bottom - top, bits, isCompressed))
    reader.goTo(next)
  }
  return pictures
}

// What is used of one of Photoshop's "dynamics": what controls it and how much it varies by itself
function dynamics(value: Value | undefined) {
  if (!isObject(value)) return { control: OFF, jitter: 0 }
  return { control: numberIn(value, 'bVTy', OFF), jitter: numberIn(value, 'jitter', 0) / 100 }
}

function mirrored({ width, height, values }: BrushPicture, flipX: boolean, flipY: boolean) {
  if (!flipX && !flipY) return { width, height, values }
  const turned = new Uint8Array(values.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      turned[(flipY ? height - 1 - y : y) * width + (flipX ? width - 1 - x : x)] = values[y * width + x]
    }
  }
  return { width, height, values: turned }
}

function brushOf(preset: Described, pictures: Map<string, BrushPicture>, fileName: string): ForeignBrush | null {
  const brush = preset.Brsh
  if (!isObject(brush)) return null
  const leftOut: LeftOut[] = []
  const shape: Partial<BrushShape> = {}

  let tip: BrushPicture
  const sampled = brush.sampledData
  if (typeof sampled === 'string') {
    const picture = pictures.get(sampled)
    if (picture) tip = mirrored(picture, brush.flipX === true, brush.flipY === true)
    else {
      leftOut.push('tipMissing')
      tip = roundTip(0.5)
    }
  } else {
    tip = roundTip(numberIn(brush, 'Hrdn', 100) / 100, numberIn(brush, 'Rndn', 100) / 100)
  }

  shape.spacing = brush.Intr === false ? 1 : numberIn(brush, 'Spcn', 25) / 100
  // Photoshop's angle goes the other way round from Lydia's
  shape.angle = (360 - numberIn(brush, 'Angl', 0)) % 360
  shape.pressureSize = false

  if (preset.useTipDynamics === true) {
    const size = dynamics(preset.szVr)
    const angle = dynamics(preset.angleDynamics)
    const roundness = dynamics(preset.roundnessDynamics)
    shape.pressureSize = size.control === PRESSURE
    shape.angleJitter = angle.jitter
    const others = [size, angle, roundness].some(each => each.control !== OFF && each.control !== PRESSURE)
    const otherPressure = angle.control === PRESSURE || roundness.control === PRESSURE
    if (others || otherPressure || size.jitter > 0 || roundness.jitter > 0) leftOut.push('sensors')
  }
  if (preset.usePaintDynamics === true) {
    const opacity = dynamics(preset.opVr)
    const flow = dynamics(preset.prVr)
    shape.pressureFlow = opacity.control === PRESSURE || flow.control === PRESSURE
    const isOther = [opacity, flow].some(each => each.control > PRESSURE || each.control === 1 || each.jitter > 0)
    if (isOther && !leftOut.includes('sensors')) leftOut.push('sensors')
  }
  if (preset.useScatter === true) {
    const scatter = dynamics(preset.scatterDynamics)
    shape.scatter = scatter.jitter
    if (scatter.control !== OFF) leftOut.push('sensors')
    // Photoshop puts this many dabs at each step, and Lydia one, so the steps get shorter to paint as many
    shape.spacing /= Math.max(1, numberIn(preset, 'Cnt ', 1))
  }

  if (preset.useColorDynamics === true) leftOut.push('tipColors')
  const dual = preset.dualBrush
  if (isObject(dual) && dual.useDualBrush === true) leftOut.push('secondTip')
  if (preset.useTexture === true) leftOut.push('texture')
  if (preset.Wtdg === true || preset.Nose === true || preset['Rpt '] === true) leftOut.push('effects')

  const name = typeof preset['Nm  '] === 'string' && preset['Nm  '].trim() ? preset['Nm  '].trim() : fileName
  return { name, shape, tip, leftOut: [...new Set(leftOut)] }
}

function readNewBrushes(reader: Reader, subversion: number, fileName: string) {
  const sections = new Map<string, Uint8Array>()
  while (reader.left() >= 12) {
    if (reader.latin(4) !== SECTION_TAG) break
    const key = reader.latin(4)
    sections.set(key, reader.slice(reader.long()))
  }
  const samples = sections.get('samp')
  const pictures = samples ? readSamples(samples, subversion) : new Map<string, BrushPicture>()

  const description = sections.get('desc')
  if (description) {
    const descriptionReader = createReader(description)
    descriptionReader.long() // the version of the description
    const { Brsh: list } = readDescribed(descriptionReader)
    if (Array.isArray(list)) {
      return list.flatMap(each => (isObject(each) ? (brushOf(each, pictures, fileName) ?? []) : []))
    }
  }
  // With no description, the pictures are all there is
  return [...pictures.values()].map((tip, i) => ({
    name: `${fileName} ${i + 1}`,
    shape: { spacing: 0.25 },
    tip,
    leftOut: [] as LeftOut[],
  }))
}

export function readPhotoshopBrushes(fileName: string, bytes: Uint8Array): ForeignBrush[] {
  const reader = createReader(bytes)
  const version = reader.short()
  const count = reader.short() // from version 6, a sub-version
  if (version === 1 || version === 2) return readOldBrushes(reader, version, count, fileName)
  if (version >= 6 && version <= 10 && (count === 1 || count === 2)) return readNewBrushes(reader, count, fileName)
  throw new LydiaError('LYD-219', { version: `${version}.${count}` })
}
