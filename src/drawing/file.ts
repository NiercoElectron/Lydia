import type { Stroke } from './types'
import { drawStrokes } from './render'

// Draw the strokes on a new, off-screen canvas and download it as a PNG file
export async function exportPng(strokes: Stroke[], width: number, height: number, fileName: string) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  drawStrokes(ctx, strokes, '#ffffff') // white background for now, until projects have their own

  // toBlob uses a callback; wrap it in a Promise so we can await it
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not create the PNG image')

  // Download the file by clicking a temporary link that points to the image
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url)) // free the memory once the download has started
}
