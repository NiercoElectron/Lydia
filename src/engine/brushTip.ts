import { LydiaError, type ErrorCode } from '../errors'
import { MAX_GRAIN_SIZE } from './brushFile'

// A brush tip ready to paint with: a white picture with the amount of paint in its alpha, so the brush can tint it
// with any color
export type BrushTip = {
  image: HTMLCanvasElement
  // How far from the center the paint goes, as a fraction of half of the picture's longer side: 1 for a round tip,
  // up to √2 for a square one (its corners). Tells which tiles a dab can touch, however it is turned
  reach: number
  // The brush's paper grain (see grain.ts), if it has one: how high the paper is at each pixel, in red, green and
  // blue alike, from 0 (the bottom of a groove) to 255 (the top)
  grain: HTMLCanvasElement | null
}

// A PNG picture on a canvas of its size, as it is, its colors not changed to the screen's. "code": the error when it
// can't be read
async function pngCanvas(png: Uint8Array, code: ErrorCode) {
  let bitmap: ImageBitmap
  try {
    const blob = new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' })
    bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  } catch {
    throw new LydiaError(code)
  }
  const image = document.createElement('canvas')
  image.width = bitmap.width
  image.height = bitmap.height
  const ctx = image.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return { image, ctx }
}

// How much a pixel of a picture paints, from 0 to 255: black fully, white or transparent not at all
function paintOf(data: Uint8ClampedArray, i: number) {
  const lightness = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  return Math.round(((255 - lightness) * data[i + 3]) / 255)
}

// Turn the PNG picture of a tip (black paints, white or transparent doesn't), and of its paper grain if it has one
// (darker is higher), into a tip ready to paint with
export async function decodeTip(png: Uint8Array, grainPng?: Uint8Array): Promise<BrushTip> {
  const { image, ctx } = await pngCanvas(png, 'LYD-203')
  const { width, height } = image

  const pixels = ctx.getImageData(0, 0, width, height)
  const data = pixels.data
  const halfSide = Math.max(width, height) / 2
  let farthest = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const paint = paintOf(data, i)
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = paint
      if (paint === 0) continue
      // How far the far corner of this pixel is from the center of the picture
      const cornerX = Math.abs(x + 0.5 - width / 2) + 0.5
      const cornerY = Math.abs(y + 0.5 - height / 2) + 0.5
      farthest = Math.max(farthest, Math.hypot(cornerX, cornerY))
    }
  }
  if (farthest === 0) throw new LydiaError('LYD-205')
  ctx.putImageData(pixels, 0, 0)
  return { image, reach: farthest / halfSide, grain: grainPng ? await decodeGrain(grainPng) : null }
}

// Turn the PNG picture of a paper grain into the heights of the paper (see BrushTip)
async function decodeGrain(png: Uint8Array) {
  const { image, ctx } = await pngCanvas(png, 'LYD-215')
  const pixels = ctx.getImageData(0, 0, image.width, image.height)
  const data = pixels.data
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = paintOf(data, i)
    data[i + 3] = 255
  }
  ctx.putImageData(pixels, 0, 0)
  return image
}

// Any image as the picture of a paper grain: in grays, as a PNG of up to MAX_GRAIN_SIZE on each side (a bigger one is
// made smaller), transparent places white
export async function grainFromImage(file: Blob): Promise<Uint8Array> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new LydiaError('LYD-217')
  }
  const scale = Math.min(1, MAX_GRAIN_SIZE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = pixels.data
  for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = 255 - paintOf(data, i)
  ctx.putImageData(pixels, 0, 0)
  const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!png) throw new LydiaError('LYD-217')
  return new Uint8Array(await png.arrayBuffer())
}

const TIP_MARGIN = 2 // white pixels kept around the paint, so the edge of a turned dab fades out instead of being cut

// Whether a pixel of a drawn pixel tip paints: where it is darker than middle gray (see brushFile.ts)
export const PIXEL_PAINTS = 128

// The tip drawn in the Brush Designer, from a picture of its paper (white where nothing is painted), as a PNG cut down
// to the painted part, like Photoshop does when it defines a brush: the brush size then measures the drawing, not
// the paper. Null when nothing is painted. A pixel brush's tip ("pixel") is cut with no margin, every pixel of it
// black, which paints, or white
export async function tipFromPicture(picture: Blob, pixel = false): Promise<Uint8Array | null> {
  const bitmap = await createImageBitmap(picture)
  const { width, height } = bitmap
  const paper = document.createElement('canvas')
  paper.width = width
  paper.height = height
  const ctx = paper.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  // The box around everything that isn't white (for a pixel tip, that is darker than middle gray)
  const data = ctx.getImageData(0, 0, width, height).data
  const isPainted = (i: number) =>
    pixel
      ? 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < PIXEL_PAINTS
      : !(data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255)
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isPainted((y * width + x) * 4)) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }
  if (right === -1) return null

  const margin = pixel ? 0 : TIP_MARGIN
  const tip = document.createElement('canvas')
  tip.width = right - left + 1 + 2 * margin
  tip.height = bottom - top + 1 + 2 * margin
  const tipCtx = tip.getContext('2d')!
  if (pixel) {
    const pixels = tipCtx.createImageData(tip.width, tip.height)
    for (let y = 0; y < tip.height; y++) {
      for (let x = 0; x < tip.width; x++) {
        const level = isPainted(((top + y) * width + left + x) * 4) ? 0 : 255
        pixels.data.set([level, level, level, 255], (y * tip.width + x) * 4)
      }
    }
    tipCtx.putImageData(pixels, 0, 0)
  } else {
    tipCtx.fillStyle = '#fff'
    tipCtx.fillRect(0, 0, tip.width, tip.height)
    tipCtx.drawImage(
      paper,
      left,
      top,
      right - left + 1,
      bottom - top + 1,
      margin,
      margin,
      right - left + 1,
      bottom - top + 1,
    )
  }
  const png = await new Promise<Blob | null>(resolve => tip.toBlob(resolve, 'image/png'))
  if (!png) throw new LydiaError('LYD-213')
  return new Uint8Array(await png.arrayBuffer())
}
