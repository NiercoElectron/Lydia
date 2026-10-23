import { BRUSH_EXTENSION, MAX_BRUSH_FILE_BYTES, parseBrushFile, type BrushPreset } from './engine/brushFile'
import { decodeTip, type BrushTip } from './engine/brushTip'

// The brushes the user can choose from: the ones that come with Lydia (the .lydbrush files in src/brushes) and the
// ones the user added. A browser can't look into a folder of the computer by itself, so added brushes are kept by
// the browser, in its database for pages (IndexedDB). The desktop version will read them from a real folder instead
// (see decision 29)

export type LibraryBrush = {
  id: string // "built-in/<file name>" or "added/<number>"
  isBuiltIn: boolean
  preset: BrushPreset
  file: string // the text of its .lydbrush file, to export it again just as it came
}

const builtInFiles = import.meta.glob<string>('./brushes/*.lydbrush', { query: '?raw', import: 'default', eager: true })
// The order of the brushes that come with Lydia in the list (others go after them)
const BUILT_IN_ORDER = ['soft-round', 'hard-round', 'pixel', 'airbrush', 'chalk', 'calligraphy', 'dashes']
export const DEFAULT_BRUSH_ID = 'built-in/soft-round'

const builtInBrushes: LibraryBrush[] = Object.entries(builtInFiles)
  .map(([path, file]) => {
    const name = path.slice(path.lastIndexOf('/') + 1, -BRUSH_EXTENSION.length)
    return { id: `built-in/${name}`, isBuiltIn: true, preset: parseBrushFile(file, name), file }
  })
  .sort((a, b) => orderOf(a) - orderOf(b))

function orderOf(brush: LibraryBrush) {
  const index = BUILT_IN_ORDER.indexOf(brush.id.slice('built-in/'.length))
  return index === -1 ? BUILT_IN_ORDER.length : index
}

// One of the brushes that come with Lydia, by its file name ("soft-round")
export function builtInBrush(name: string) {
  const brush = builtInBrushes.find(b => b.id === `built-in/${name}`)
  if (!brush) throw new Error(`Lydia has no brush called "${name}".`)
  return brush
}

// The number an added brush is kept under in the browser's database: "added/12" -> 12
const keyOf = (id: string) => Number(id.slice('added/'.length))

// ----- Tips -----

// Each brush's tip is decoded once, the first time it is needed
const tips = new Map<string, Promise<BrushTip>>()

export function tipOf(brush: LibraryBrush) {
  let tip = tips.get(brush.id)
  if (!tip) {
    tip = decodeTip(brush.preset.tip)
    tips.set(brush.id, tip)
  }
  return tip
}

// ----- The browser's database -----

const DATABASE = 'lydia'
const STORE = 'brushes' // each record: { id: number, file: string }

type StoredBrush = { id: number; file: string }

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    // The first time, the database is created with a place for the brushes
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// Do something with the brushes in the database, and wait until it is written
async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode)
      const request = work(transaction.objectStore(STORE))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

// ----- The library -----

// All the brushes: first the ones that come with Lydia, then the added ones, in the order they were added
export async function loadBrushes(): Promise<LibraryBrush[]> {
  let stored: StoredBrush[] = []
  try {
    stored = await withStore('readonly', store => store.getAll() as IDBRequest<StoredBrush[]>)
  } catch (error) {
    console.warn('Could not read the added brushes from the browser:', error)
  }
  const added: LibraryBrush[] = []
  for (const { id, file } of stored) {
    try {
      added.push({ id: `added/${id}`, isBuiltIn: false, preset: parseBrushFile(file, 'Brush'), file })
    } catch (error) {
      console.warn(`An added brush (${id}) can't be used anymore:`, error)
    }
  }
  return [...builtInBrushes, ...added]
}

// Add brush files to the library. A file that isn't a brush that works, or that is already in the library, is left
// out with a message saying why
export async function addBrushFiles(files: File[], library: LibraryBrush[]) {
  const added: LibraryBrush[] = []
  const problems: string[] = []
  for (const file of files) {
    try {
      if (!file.name.toLowerCase().endsWith(BRUSH_EXTENSION)) {
        throw new Error(`Only Lydia brushes (${BRUSH_EXTENSION} files) can be added.`)
      }
      if (file.size > MAX_BRUSH_FILE_BYTES) throw new Error('This file is too big to be a brush.')
      const text = await file.text()
      if ([...library, ...added].some(brush => brush.file === text)) {
        throw new Error('This brush is already in the list.')
      }
      const preset = parseBrushFile(text, file.name.slice(0, -BRUSH_EXTENSION.length))
      await decodeTip(preset.tip) // a tip that can't be painted with is found now, not at the first stroke
      const id = await withStore('readwrite', store => store.add({ file: text }))
      added.push({ id: `added/${id}`, isBuiltIn: false, preset, file: text })
    } catch (error) {
      problems.push(`${file.name}: ${error instanceof Error ? error.message : 'could not be added.'}`)
    }
  }
  return { added, problems }
}

export async function removeBrush(brush: LibraryBrush) {
  if (brush.isBuiltIn) return
  await withStore('readwrite', store => store.delete(keyOf(brush.id)))
  tips.delete(brush.id)
}

// Keep a brush made in the Brush Designer. "replacing" is the id it got the last time it was saved, so saving again
// changes that brush instead of adding another one. Returns the brush's id
export async function saveBrush(file: string, replacing?: string) {
  const key = await withStore('readwrite', store =>
    replacing ? store.put({ id: keyOf(replacing), file }) : store.add({ file }),
  )
  const id = `added/${key}`
  tips.delete(id) // its tip may have changed
  return id
}
