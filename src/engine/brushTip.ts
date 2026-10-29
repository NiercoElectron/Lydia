import { LocalizedError } from '../localizedError'
// A brush tip ready to paint with: a white picture with the amount of paint in its alpha, so the brush can tint it
// with any color
export type BrushTip = {
  image: HTMLCanvasElement
  // How far from the center the paint goes, as a fraction of half of the picture's longer side: 1 for a round tip,
  // up to √2 for a square one (its corners). Tells which tiles a dab can touch, however it is turned
  reach: number
}

// Turn the PNG picture of a tip (black paints, white or transparent doesn't) into a tip ready to paint with
export async function decodeTip(png: Uint8Array): Promise<BrushTip> {
  let bitmap: ImageBitmap
  try {
    const blob = new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' })
    bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  } catch {
    throw new LocalizedError('The tip of this brush is not a PNG image.')
  }
  const { width, height } = bitmap
  const image = document.createElement('canvas')
  image.width = width
  image.height = height
  const ctx = image.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const pixels = ctx.getImageData(0, 0, width, height)
  const data = pixels.data
  const halfSide = Math.max(width, height) / 2
  let farthest = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const lightness = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      const paint = Math.round(((255 - lightness) * data[i + 3]) / 255)
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = paint
      if (paint === 0) continue
      // How far the far corner of this pixel is from the center of the picture
      const cornerX = Math.abs(x + 0.5 - width / 2) + 0.5
      const cornerY = Math.abs(y + 0.5 - height / 2) + 0.5
      farthest = Math.max(farthest, Math.hypot(cornerX, cornerY))
    }
  }
  if (farthest === 0) throw new LocalizedError('The tip of this brush has no paint.')
  ctx.putImageData(pixels, 0, 0)
  return { image, reach: farthest / halfSide }
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
  if (!png) throw new LocalizedError('Could not make a picture of the tip.')
  return new Uint8Array(await png.arrayBuffer())
}
