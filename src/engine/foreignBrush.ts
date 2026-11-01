import { paintOf } from './brushTip'
import { MAX_GRAIN_SIZE, MAX_TIP_SIZE, type BrushPreset, type BrushShape, DEFAULT_SHAPE } from './brushFile'

// Brushes made for other apps, read into what a Lydia brush can hold. Each format has its own file (gimpBrush.ts,
// photoshopBrush.ts and kritaBrush.ts). What a brush has and Lydia doesn't stays out of it, and is listed, so a brush that
// paints differently from its original says why (decision 85)

// What a brush can have that stays out, named for people in the report (see BrushImportReport.tsx)
export const LEFT_OUT = [
  'engine', // it doesn't paint with copies of a tip
  'tipColors', // its tip has colors of its own
  'tipFrames', // its tip is many pictures, changing as it paints
  'tipMissing', // its tip isn't in the file, or can't be read: it paints with a round one
  'curves', // its own curves for the pen's pressure
  'sensors', // what changes it isn't only the pressure: speed, tilt, fading...
  'secondTip', // a second tip, cutting the first one
  'texture', // a texture that couldn't be read or has no equivalent
  'effects', // a way of mixing, wet edges, airbrush, noise...
] as const
export type LeftOut = (typeof LEFT_OUT)[number]

// A picture of how much each pixel paints, from 0 to 255, or for a grain, how high the paper is there: 255 is the top,
// which paints with the least pressure
export type BrushPicture = { width: number; height: number; values: Uint8Array }

export type ForeignBrush = {
  name: string
  shape: Partial<BrushShape>
  tip: BrushPicture
  grain?: BrushPicture
  leftOut: LeftOut[]
}

// The bytes of a PNG picture of this tip or grain, made smaller when it doesn't fit. In the file, a tip is black with an
// alpha, and a grain is darker where it is higher (see brushFile.ts)
async function pngOf({ width, height, values }: BrushPicture, biggest: number, isTip: boolean) {
  const image = new ImageData(width, height)
  for (let i = 0; i < values.length; i++) {
    if (isTip)
      image.data[i * 4 + 3] = values[i] // black, more or less transparent
    else {
      image.data.fill(255 - values[i], i * 4, i * 4 + 3)
      image.data[i * 4 + 3] = 255
    }
  }
  const whole = new OffscreenCanvas(width, height)
  whole.getContext('2d')!.putImageData(image, 0, 0)
  const scale = Math.min(1, biggest / Math.max(width, height))
  if (scale === 1) return new Uint8Array(await (await whole.convertToBlob({ type: 'image/png' })).arrayBuffer())
  const small = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
  const context = small.getContext('2d')!
  context.imageSmoothingQuality = 'high'
  context.drawImage(whole, 0, 0, small.width, small.height)
  return new Uint8Array(await (await small.convertToBlob({ type: 'image/png' })).arrayBuffer())
}

// The Lydia brush this one becomes
export async function toPreset({ name, shape, tip, grain }: ForeignBrush): Promise<BrushPreset> {
  return {
    ...DEFAULT_SHAPE,
    ...shape,
    name,
    tip: await pngOf(tip, MAX_TIP_SIZE, true),
    ...(grain && { grain: await pngOf(grain, MAX_GRAIN_SIZE, false), grainDepth: shape.grainDepth ?? 1 }),
  }
}

// A round tip, for a brush whose own can't be used: "hardness" is the part of its radius that paints fully. "ratio" is how
// much narrower than wide it is. "spikes" above 2 fold it into a star, and "isSquare" makes it a rectangle
export function roundTip(hardness: number, ratio = 1, spikes = 2, isSquare = false): BrushPicture {
  const SIDE = 256
  const values = new Uint8Array(SIDE * SIDE)
  const radius = SIDE / 2
  const height = Math.max(0.01, ratio)
  const spike = spikes > 2 ? (2 * Math.PI) / spikes : 0
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      let right = (x + 0.5 - radius) / radius
      let down = (y + 0.5 - radius) / radius / height
      if (spike) {
        const far = Math.hypot(right, down)
        let angle = Math.atan2(Math.abs(down), Math.abs(right)) % spike
        if (angle > spike / 2) angle = spike - angle
        right = far * Math.cos(angle)
        down = far * Math.sin(angle)
      }
      const reach = isSquare ? Math.max(Math.abs(right), Math.abs(down)) : Math.hypot(right, down)
      const paint = reach >= 1 ? 0 : reach <= hardness ? 1 : (1 - reach) / (1 - hardness)
      values[y * SIDE + x] = Math.round(paint * 255)
    }
  }
  return { width: SIDE, height: SIDE, values }
}

// A PNG image as a tip (black paints, white or transparent doesn't), and whether it has colors of its own
export async function tipOfPng(png: Uint8Array) {
  const { width, height, data } = await pixelsOfPng(png)
  const values = new Uint8Array(width * height)
  let hasColors = false
  for (let i = 0; i < values.length; i++) {
    values[i] = paintOf(data, i * 4)
    const isGray = data[i * 4] === data[i * 4 + 1] && data[i * 4 + 1] === data[i * 4 + 2]
    if (!isGray && data[i * 4 + 3] > 0) hasColors = true
  }
  return { picture: { width, height, values }, hasColors }
}

export async function pixelsOfPng(png: Uint8Array) {
  const blob = new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' })
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return context.getImageData(0, 0, canvas.width, canvas.height)
}
