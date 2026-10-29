import { LydiaError, type ImportProblem } from './errors'

// The tray (decision 43): images imported to put into drawings, kept while Lydia is open so they can be dragged onto
// a drawing again and again without importing them again. Each keeps its file (compressed, so small) and a small
// picture to show; the image itself is decoded again every time it goes into a drawing, so the tray holds no big
// images in memory

export type TrayImage = {
  id: number
  name: string // the file's name without its extension, for the new layer
  file: Blob
  thumbnail: string // the address of its small picture (an object URL)
  width: number
  height: number
}

// What a tray image dragged onto the drawing carries: its id
export const TRAY_DRAG_TYPE = 'application/x-lydia-tray-image'

const THUMBNAIL_SIZE = 160 // pixels on its longer side: twice the size it is shown at, for sharp screens

let nextId = 1

export const isImageFile = (file: File) => file.type.startsWith('image/')

// Make tray images of these files. The ones the browser can't open as images are listed in "problems"
export async function makeTrayImages(files: File[]) {
  const added: TrayImage[] = []
  const problems: ImportProblem[] = []
  for (const file of files) {
    let image: ImageBitmap
    try {
      image = await createImageBitmap(file)
    } catch {
      problems.push({ name: file.name, error: new LydiaError('LYD-301') })
      continue
    }
    const { width, height } = image
    const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(width, height))
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    image.close()
    const thumbnail = URL.createObjectURL(await canvas.convertToBlob())
    const dot = file.name.lastIndexOf('.')
    const name = dot > 0 ? file.name.slice(0, dot) : file.name
    added.push({ id: nextId++, name, file, thumbnail, width, height })
  }
  return { added, problems }
}

// The image leaves the tray: free its small picture
export function freeTrayImage(image: TrayImage) {
  URL.revokeObjectURL(image.thumbnail)
}
