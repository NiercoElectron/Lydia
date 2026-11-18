import { desktop, readFile } from './desktop'
import { parseProject, type ProjectData } from './engine/projectFile'
import { LydiaError } from './errors'

// The drawings opened or saved lately in the desktop app, for the start screen (decision 92). The app keeps the list
// (see electron/recent.mjs), so that only files the person chose can be opened from it. This keeps, beside it, how
// each one looked when it was last saved or closed, and its size: a small picture, made by the drawing's engine. In a
// browser there is no list, as a page can't open a file again without it being chosen again

export type RecentDrawing = { file: string; time: number; width?: number; height?: number; picture?: string }
type Look = { width: number; height: number; picture?: string }

const LOOKS_KEY = 'lydia.recentLooks'
const PICTURE_SIDE = 160 // the longer side of a picture, in pixels: small enough to keep a dozen in the browser
const keyOf = (file: string) => file.toLowerCase() // Windows doesn't tell capitals apart in a file's name

function loadLooks(): Record<string, Look> {
  try {
    const read = JSON.parse(localStorage.getItem(LOOKS_KEY) ?? '{}')
    return typeof read === 'object' && read !== null ? read : {}
  } catch {
    return {}
  }
}

function saveLooks(looks: Record<string, Look>) {
  try {
    localStorage.setItem(LOOKS_KEY, JSON.stringify(looks))
  } catch {
    // not kept: the list shows the drawing without its picture
  }
}

// The drawings, newest first, with how they looked. The pictures of drawings no longer in the list are let go
export async function listRecentDrawings(): Promise<RecentDrawing[]> {
  if (!desktop) return []
  const list = await desktop.listRecent()
  const looks = loadLooks()
  const kept = Object.fromEntries(
    list.flatMap(({ file }) => (looks[keyOf(file)] ? [[keyOf(file), looks[keyOf(file)]]] : [])),
  )
  if (Object.keys(kept).length !== Object.keys(looks).length) saveLooks(kept)
  return list.map(each => ({ ...each, ...kept[keyOf(each.file)] }))
}

// A smaller copy of a picture, as text that can be kept
async function smaller(picture: Blob) {
  const bitmap = await createImageBitmap(picture)
  const scale = Math.min(1, PICTURE_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/webp', 0.8)
}

// How a drawing of the list looks now, as it was saved or closed. Without a picture, the one there was stays
export async function noteDrawingLook(file: string, width: number, height: number, picture: Blob | null) {
  if (!desktop) return
  const looks = loadLooks()
  const before = looks[keyOf(file)]
  looks[keyOf(file)] = { width, height, picture: picture ? await smaller(picture) : before?.picture }
  saveLooks(looks)
}

// Open a drawing of the list. One whose file is gone leaves the list, with LYD-110
export async function openRecentDrawing(file: string): Promise<ProjectData> {
  if (!desktop || !(await desktop.openRecent(file))) throw new LydiaError('LYD-110', { file })
  let bytes: ArrayBuffer
  try {
    bytes = await readFile(file)
  } catch (error) {
    if (!String(error).includes('ENOENT')) throw error // there, but it couldn't be read
    await forgetRecentDrawing(file)
    throw new LydiaError('LYD-110', { file })
  }
  return { ...parseProject(bytes), file }
}

// Take a drawing out of the list. Its file stays where it is
export async function forgetRecentDrawing(file: string) {
  if (!desktop) return
  await desktop.forgetRecent(file)
  const looks = loadLooks()
  delete looks[keyOf(file)]
  saveLooks(looks)
}
