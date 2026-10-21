import type { Stroke } from './types'
import { createCanvas, drawStrokes } from './render'

// Draw the strokes on a white background and return the result as a PNG image
export async function renderPng(strokes: Stroke[], width: number, height: number): Promise<Blob> {
  // Draw the strokes on their own transparent canvas first, so the eraser only removes strokes
  const drawing = createCanvas(width, height)
  drawStrokes(drawing.getContext('2d')!, strokes)

  // Then paint a white background and put the drawing on top of it
  const image = createCanvas(width, height)
  const ctx = image.getContext('2d')!
  ctx.fillStyle = '#ffffff' // white background for now, until projects have their own
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(drawing, 0, 0)

  // toBlob uses a callback; wrap it in a Promise so we can await it
  const blob = await new Promise<Blob | null>(resolve => image.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not create the PNG image.')
  return blob
}

// Make the browser download a file by clicking a temporary link that points to it
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url)) // free the memory once the download has started
}
