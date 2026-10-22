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
    throw new Error('The tip of this brush is not a PNG image.')
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
  if (farthest === 0) throw new Error('The tip of this brush has no paint.')
  ctx.putImageData(pixels, 0, 0)
  return { image, reach: farthest / halfSide }
}
