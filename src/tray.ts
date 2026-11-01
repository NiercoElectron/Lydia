import { baseName, desktop, oneAtATime, readFile, writeFile } from './desktop'
import { LydiaError, type ImportProblem } from './errors'

// The tray (decision 43): images imported to put into drawings, kept so they can be dragged onto a drawing again and
// again without importing them again. Each keeps its file (compressed, so small) and a small picture to show; the image
// itself is decoded again every time it goes into a drawing, so the tray holds no big images in memory. In the browser
// it lasts while Lydia is open. The desktop app keeps it as files in its Tray folder, for all drawings

export type TrayImage = {
  id: number
  name: string // the file's name without its extension, for the new layer
  file: File
  thumbnail: string // the address of its small picture (an object URL)
  width: number
  height: number
  keptAs?: string // the name of its file in the Tray folder of the desktop app
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

// ----- The folder of the desktop app -----

// What is in the folder, by the name of its file: a file is only read once
const kept = new Map<string, TrayImage>()
const inTurn = oneAtATime()
// The files of the folder that are images: anything else there is left alone
const IMAGE_FILE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i

function keepImage(name: string, image: TrayImage) {
  const keptImage = { ...image, keptAs: name }
  kept.set(name, keptImage)
  return keptImage
}

// The tray as the folder has it now
export const readTrayFolder = () =>
  inTurn(async () => {
    const files = await desktop!.listKept('tray')
    const found = files.filter(({ name }) => IMAGE_FILE.test(name))
    for (const [name, image] of kept) {
      if (found.some(each => each.name === name)) continue
      kept.delete(name)
      freeTrayImage(image)
    }
    for (const { file, name } of found) {
      if (kept.has(name)) continue
      try {
        const { added } = await makeTrayImages([new File([await readFile(file)], name)])
        // A file that doesn't open is tried again next time: it may still have been on its way here
        if (added.length > 0) keepImage(name, added[0])
      } catch (error) {
        console.warn(`The image ${name} can't be read:`, error)
      }
    }
    return [...kept.values()]
  })

// Make tray images of these files, with a copy in the folder
export const addToTrayFolder = (files: File[]) =>
  inTurn(async () => {
    const { added, problems } = await makeTrayImages(files)
    const keptImages: TrayImage[] = []
    for (const image of added) {
      try {
        const place = await desktop!.placeToKeep('tray', image.file.name)
        await writeFile(place, image.file)
        keptImages.push(keepImage(baseName(place), image))
      } catch (error) {
        freeTrayImage(image)
        problems.push({ name: image.file.name, error })
      }
    }
    return { added: keptImages, problems }
  })

export const removeFromTrayFolder = ({ keptAs }: TrayImage) =>
  inTurn(async () => {
    await desktop!.removeKept('tray', keptAs!)
    kept.delete(keptAs!)
  })
