import { LydiaError, type ErrorCode } from '../errors'

export const BRUSH_EXTENSION = '.lydbrush'
export const MAX_TIP_SIZE = 1024 // the biggest tip picture, in pixels on each side
export const MAX_GRAIN_SIZE = 1024 // the biggest paper grain picture, in pixels on each side
export const MAX_BRUSH_FILE_BYTES = 8 * 1024 ** 2 // a tip and a grain of 1024×1024 full of detail are well under this
export const TIP_SIZES = [256, 512, 1024] // the papers the Brush Designer offers for drawing a tip
export const DEFAULT_TIP_SIZE = 512
export const PIXEL_TIP_SIZES = [16, 32, 64] // the papers for drawing a pixel brush's tip, pixel by pixel
export const DEFAULT_PIXEL_TIP_SIZE = 32
const MAX_NAME_LENGTH = 100

// How copies of the tip are placed along a stroke (see dabs.ts)
export type BrushShape = {
  spacing: number // the distance between dabs, as a fraction of the brush size
  angle: number // how much the tip is turned, in degrees, clockwise
  followStroke: boolean // the tip also turns with the direction of the stroke
  angleJitter: number // each dab is turned by a random amount: 0 = never, 1 = any angle
  scatter: number // each dab is moved by a random amount, up to this fraction of the brush size
  flow: number // how much paint each dab puts down, from 0 to 1
  wash: boolean // the stroke doesn't pile up over itself: each pixel keeps the most paint one dab gave it
  pressureSize: boolean // the pen's pressure changes the size of the dabs
  pressureFlow: boolean // the pen's pressure changes how much paint each dab puts down
  // Filtered noise in each dab (see noiseDabs.ts): how much of the paint it decides (0 = no noise), how many grains
  // fit across the tip, how many layers of finer grains are added, how many times longer than tall the grains are
  // (streaks across the tip), and its contrast
  noiseMode: NoiseMode // how the noise forms the dabs: "mix", "drops" or "worn" (see noiseDabs.ts)
  noiseAmount: number
  noiseGrain: number
  noiseLayers: number
  noiseStretch: number
  noiseContrast: number
  noisePerStroke: boolean // the noise changes with each stroke, not each dab, so its streaks run along the stroke
  pixel: PixelTip // whether the brush paints whole pixels of the paper
  // The paper's grain (see grain.ts), with a grain picture: how deep its grooves are, from 0 (no grain) to 1, and how
  // big its picture is on the paper (1 = a pixel of the picture on each pixel of the paper)
  grainDepth: number
  grainScale: number
}

// "none": a smooth brush, its tip's picture resized to any size. "round": a pixel brush with a round tip, worked out
// for each size (see pixelTip.ts). "drawn": a pixel brush whose tip was drawn pixel by pixel: its picture, each pixel
// painting fully or not at all, at a whole multiple of its size (1×, 2×, 3×…)
const PIXEL_TIPS = ['none', 'round', 'drawn'] as const
export type PixelTip = (typeof PIXEL_TIPS)[number]

const NOISE_MODES = ['mix', 'drops', 'worn'] as const
export type NoiseMode = (typeof NOISE_MODES)[number]

// A brush, as it is in its file: a name, the picture of its tip (a PNG image), its shape, and the picture of its
// paper grain (a PNG image), if it has one
export type BrushPreset = BrushShape & { name: string; tip: Uint8Array; grain?: Uint8Array }

export const DEFAULT_SHAPE: BrushShape = {
  spacing: 0.1,
  angle: 0,
  followStroke: false,
  angleJitter: 0,
  scatter: 0,
  flow: 1,
  wash: false,
  pressureSize: true,
  pressureFlow: false,
  noiseMode: 'mix',
  noiseAmount: 0,
  noiseGrain: 8,
  noiseLayers: 3,
  noiseStretch: 1,
  noiseContrast: 1,
  noisePerStroke: false,
  pixel: 'none',
  grainDepth: 0,
  grainScale: 1,
}

// The smallest and biggest values of each number, so a file can't make Lydia place millions of dabs
const LIMITS: { [K in keyof BrushShape]?: [number, number] } = {
  spacing: [0.01, 10],
  angleJitter: [0, 1],
  scatter: [0, 5],
  flow: [0, 1],
  noiseAmount: [0, 1],
  noiseGrain: [1, 64],
  noiseLayers: [1, 4],
  noiseStretch: [1, 16],
  noiseContrast: [0.1, 10],
  grainDepth: [0, 1],
  grainScale: [0.1, 10],
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
// only for versions of Lydia without pixel brushes, which paint with it as a smooth brush. It is "drawn" for a pixel
// brush that paints its picture as it is, where it is darker than middle gray, at a whole multiple of its size;
// versions of Lydia before 0.9.0, which brought them, paint it as a smooth brush.
//
// "grain", if there is one, is the picture of the paper's grain, a PNG image of up to 1024×1024 that repeats across
// the paper: darker is higher, where light pressure already paints, and lighter is the grooves, which only more
// pressure fills ("grainDepth" says how deep they are). Versions of Lydia before 0.14.0, which brought it, paint
// without it.
//
// A missing field takes its usual value (DEFAULT_SHAPE), and fields Lydia doesn't know are left alone, so a file from
// a newer version of the same format still opens. A brush file is only data: nothing in it is ever run, so brushes downloaded from anywhere
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
    throw new LydiaError('LYD-201')
  }
  if (!isRecord(data) || data.format !== FORMAT) throw new LydiaError('LYD-201')
  if (typeof data.version !== 'number' || data.version > VERSION) {
    throw new LydiaError('LYD-202')
  }

  if (typeof data.tip !== 'string' || !data.tip.startsWith(PNG_DATA_URL)) {
    throw new LydiaError('LYD-203')
  }
  const tip = fromBase64(data.tip.slice(PNG_DATA_URL.length), 'LYD-203')
  const { width, height } = pngSize(tip, 'LYD-203')
  if (width > MAX_TIP_SIZE || height > MAX_TIP_SIZE) {
    throw new LydiaError('LYD-204', { width, height, max: MAX_TIP_SIZE })
  }

  let grain: Uint8Array | undefined
  if (data.grain !== undefined) {
    if (typeof data.grain !== 'string' || !data.grain.startsWith(PNG_DATA_URL)) throw new LydiaError('LYD-215')
    grain = fromBase64(data.grain.slice(PNG_DATA_URL.length), 'LYD-215')
    const size = pngSize(grain, 'LYD-215')
    if (size.width > MAX_GRAIN_SIZE || size.height > MAX_GRAIN_SIZE) {
      throw new LydiaError('LYD-216', { ...size, max: MAX_GRAIN_SIZE })
    }
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
  shape.noiseLayers = Math.round(shape.noiseLayers)
  shape.noiseMode = NOISE_MODES.find(mode => mode === data.noiseMode) ?? DEFAULT_SHAPE.noiseMode
  shape.pixel = PIXEL_TIPS.find(pixelTip => pixelTip === data.pixel) ?? DEFAULT_SHAPE.pixel

  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : fallbackName
  return { ...shape, name: name.slice(0, MAX_NAME_LENGTH), tip, ...(grain && { grain }) }
}

// The text of a .lydbrush file for this brush
export function serializeBrushFile({ name, tip, grain, ...shape }: BrushPreset) {
  const file = {
    format: FORMAT,
    version: VERSION,
    name,
    ...shape,
    tip: PNG_DATA_URL + toBase64(tip),
    ...(grain && { grain: PNG_DATA_URL + toBase64(grain) }),
  }
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

// The size of a PNG image, from its first bytes: the signature, then the "IHDR" part with the width and the height.
// "code": the error when it isn't one
function pngSize(png: Uint8Array, code: ErrorCode) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const isPng =
    png.length >= 24 &&
    PNG_SIGNATURE.every((byte, i) => png[i] === byte) &&
    String.fromCharCode(...png.subarray(12, 16)) === 'IHDR'
  const width = isPng ? view.getUint32(16) : 0
  const height = isPng ? view.getUint32(20) : 0
  if (width === 0 || height === 0) throw new LydiaError(code)
  return { width, height }
}

function fromBase64(text: string, code: ErrorCode) {
  let binary: string
  try {
    binary = atob(text)
  } catch {
    throw new LydiaError(code)
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
