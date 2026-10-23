export const BRUSH_EXTENSION = '.lydbrush'
export const MAX_TIP_SIZE = 1024 // the biggest tip picture, in pixels on each side
export const MAX_BRUSH_FILE_BYTES = 8 * 1024 ** 2 // a tip of 1024×1024 full of detail is well under this
export const TIP_SIZES = [256, 512, 1024] // the papers the Brush Designer offers for drawing a tip
export const DEFAULT_TIP_SIZE = 512
const MAX_NAME_LENGTH = 100

// How copies of the tip are placed along a stroke (see dabs.ts)
export type BrushShape = {
  spacing: number // the distance between dabs, as a fraction of the brush size
  angle: number // how much the tip is turned, in degrees, clockwise
  followStroke: boolean // the tip also turns with the direction of the stroke
  angleJitter: number // each dab is turned by a random amount: 0 = never, 1 = any angle
  scatter: number // each dab is moved by a random amount, up to this fraction of the brush size
  flow: number // how much paint each dab puts down, from 0 to 1
  pressureSize: boolean // the pen's pressure changes the size of the dabs
  pressureFlow: boolean // the pen's pressure changes how much paint each dab puts down
  pixel: PixelTip // whether the brush paints whole pixels of the paper
}

// "none": a smooth brush, its tip's picture resized to any size. "round": a pixel brush with a round tip, worked out
// for each size (see pixelTip.ts)
const PIXEL_TIPS = ['none', 'round'] as const
export type PixelTip = (typeof PIXEL_TIPS)[number]

// A brush, as it is in its file: a name, the picture of its tip (a PNG image) and its shape
export type BrushPreset = BrushShape & { name: string; tip: Uint8Array }

export const DEFAULT_SHAPE: BrushShape = {
  spacing: 0.1,
  angle: 0,
  followStroke: false,
  angleJitter: 0,
  scatter: 0,
  flow: 1,
  pressureSize: true,
  pressureFlow: false,
  pixel: 'none',
}

// The smallest and biggest values of each number, so a file can't make Lydia place millions of dabs
const LIMITS: { [K in keyof BrushShape]?: [number, number] } = {
  spacing: [0.01, 10],
  angleJitter: [0, 1],
  scatter: [0, 5],
  flow: [0, 1],
}

// ----- The .lydbrush file (version 1) -----
//
// A brush is a small JSON text file, for example:
//
// {
//   "format": "lydia-brush",
//   "version": 1,
//   "name": "Soft round",
//   "spacing": 0.1,
//   ...the other fields of BrushShape...
//   "tip": "data:image/png;base64,iVBORw0KGgo..."
// }
//
// "tip" is the picture of the brush tip, a PNG image of up to 1024×1024: black paints, white or transparent doesn't,
// gray paints lightly. "pixel" is "round" for a pixel brush, which works out its tip for each size: its picture is then
// only for versions of Lydia without pixel brushes, which paint with it as a smooth brush. A missing field takes its
// usual value (DEFAULT_SHAPE), and fields Lydia doesn't know are left alone, so a file from a newer version of the
// same format still opens. A brush file is only data: nothing in it is ever run, so brushes downloaded from anywhere
// are safe to add

const FORMAT = 'lydia-brush'
const VERSION = 1
const PNG_DATA_URL = 'data:image/png;base64,'
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

// Read a .lydbrush file. Throws an Error with a message for the user when the file can't be used
export function parseBrushFile(text: string, fallbackName: string): BrushPreset {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('This is not a Lydia brush.')
  }
  if (!isRecord(data) || data.format !== FORMAT) throw new Error('This is not a Lydia brush.')
  if (typeof data.version !== 'number' || data.version > VERSION) {
    throw new Error('This brush was made by a newer version of Lydia. Update Lydia to use it.')
  }

  if (typeof data.tip !== 'string' || !data.tip.startsWith(PNG_DATA_URL)) {
    throw new Error('The tip of this brush is not a PNG image.')
  }
  const tip = fromBase64(data.tip.slice(PNG_DATA_URL.length))
  const { width, height } = pngSize(tip)
  if (width > MAX_TIP_SIZE || height > MAX_TIP_SIZE) {
    throw new Error(
      `The tip of this brush is too big (${width}×${height} pixels). The biggest is ${MAX_TIP_SIZE}×${MAX_TIP_SIZE}.`,
    )
  }

  const shape = { ...DEFAULT_SHAPE }
  for (const key of Object.keys(DEFAULT_SHAPE) as (keyof BrushShape)[]) {
    const value = data[key]
    if (typeof shape[key] === 'boolean' && typeof value === 'boolean') {
      ;(shape[key] as boolean) = value
    } else if (typeof shape[key] === 'number' && typeof value === 'number' && Number.isFinite(value)) {
      const [min, max] = LIMITS[key] ?? [-Infinity, Infinity]
      ;(shape[key] as number) = Math.min(max, Math.max(min, value))
    }
  }
  shape.angle = ((shape.angle % 360) + 360) % 360
  shape.pixel = PIXEL_TIPS.find(pixelTip => pixelTip === data.pixel) ?? DEFAULT_SHAPE.pixel

  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : fallbackName
  return { ...shape, name: name.slice(0, MAX_NAME_LENGTH), tip }
}

// The text of a .lydbrush file for this brush
export function serializeBrushFile({ name, tip, ...shape }: BrushPreset) {
  const file = { format: FORMAT, version: VERSION, name, ...shape, tip: PNG_DATA_URL + toBase64(tip) }
  return JSON.stringify(file, null, 2) + '\n'
}

// A file name for a brush: "Soft round" -> "soft-round.lydbrush"
export function brushFileName(name: string) {
  const simple = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return (simple || 'brush') + BRUSH_EXTENSION
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// The size of a PNG image, from its first bytes: the signature, then the "IHDR" part with the width and the height
function pngSize(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const isPng =
    png.length >= 24 &&
    PNG_SIGNATURE.every((byte, i) => png[i] === byte) &&
    String.fromCharCode(...png.subarray(12, 16)) === 'IHDR'
  const width = isPng ? view.getUint32(16) : 0
  const height = isPng ? view.getUint32(20) : 0
  if (width === 0 || height === 0) throw new Error('The tip of this brush is not a PNG image.')
  return { width, height }
}

function fromBase64(text: string) {
  let binary: string
  try {
    binary = atob(text)
  } catch {
    throw new Error('The tip of this brush is not a PNG image.')
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function toBase64(bytes: Uint8Array) {
  let binary = ''
  const CHUNK = 0x8000 // String.fromCharCode takes a limited number of arguments at once
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}
