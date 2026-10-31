import { LydiaError } from './errors'
import type { StoredTile } from './engine/memory'
import {
  parseProject,
  serializeProject,
  type LayerData,
  type LayerToSave,
  type Paper,
  type ProjectData,
  type ViewData,
} from './engine/projectFile'
import { parseTileKey } from './engine/tiles'

// Autosave (decision 75): copies of the drawings being worked on, kept in the browser, for when it closes or crashes
// with changes that weren't saved. A copy can be left half written at any moment, so it is made in an order where that
// doesn't matter:
//
// - The tiles first, each a record of its own. Stored tiles never change (see memory.ts), so a tile already written is
//   never written again, and each autosave only costs what changed.
// - Then, in one transaction, the list of what the drawing has, and the tiles no longer in it are deleted. Until that
//   transaction ends the last copy is whole, and afterwards the new one is.
//
// There is a database of its own for it: the brushes' stays as it is. It keeps, in three places:
// - "drawings": what the Recover list shows
// - "contents": the layers, with each tile as a color or the number of its record
// - "tiles": the compressed tiles, by the drawing and their number

const DATABASE = 'lydia-autosave'
const DRAWINGS = 'drawings'
const CONTENTS = 'contents'
const TILES = 'tiles'
export const MAX_AUTOSAVED = 5 // the most recent ones kept
const TILES_AT_ONCE = 32 // written in one transaction, so a big drawing never takes the browser for long
const UNFINISHED_MS = 60 * 60 * 1000 // a first copy still unfinished after this long was left by a crash

// A drawing as it was at one moment, kept for writing: its tiles can go on changing in the layers meanwhile. "thumbnail"
// is null when there is no graphics card to make one
type SavedPaper = Paper & Pick<ProjectData, 'exportScale' | 'colors' | 'symmetry' | 'rulers'>
export type DrawingSnapshot = {
  paper: SavedPaper
  activeLayer: number
  view: ViewData
  layers: LayerData[]
  thumbnail: Blob | null
}

export function projectOf({ paper, layers, activeLayer, view }: DrawingSnapshot): ProjectData {
  return { ...paper, layers, activeLayer, view }
}

export type AutosavedDrawing = {
  id: string
  time: number // when it was written, in milliseconds since 1970
  width: number
  height: number
  thumbnail: Blob | null
  isComplete: boolean // false until its first copy is whole
  isSaved: boolean // it was saved as a file since: there is nothing to recover, and its tiles wait for the next autosave
}

type SavedTile = { column: number; row: number; color?: number; tile?: number }
type SavedLayer<Tiles> = Omit<LayerToSave, 'tiles' | 'smart'> & {
  tiles: Tiles
  smart?: Omit<NonNullable<LayerToSave['smart']>, 'tiles'> & { tiles: Tiles }
}
type Contents = {
  id: string
  paper: SavedPaper
  activeLayer: number
  view: ViewData
  layers: SavedLayer<SavedTile[]>[]
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      database.createObjectStore(DRAWINGS, { keyPath: 'id' })
      database.createObjectStore(CONTENTS, { keyPath: 'id' })
      database.createObjectStore(TILES)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// Do something in the database, and wait until it is written
async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction) => T,
  durability: IDBTransactionDurability = 'default',
) {
  const database = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const running = database.transaction(stores, mode, { durability })
      const result = work(running)
      running.oncomplete = () => resolve(result)
      running.onerror = () => reject(running.error)
      running.onabort = () => reject(running.error)
    })
  } finally {
    database.close()
  }
}

// The records of a drawing's tiles: its id goes first in their keys
const tilesOf = (id: string) => IDBKeyRange.bound([id], [id, []])

function removeDrawing(running: IDBTransaction, id: string) {
  running.objectStore(DRAWINGS).delete(id)
  running.objectStore(CONTENTS).delete(id)
  running.objectStore(TILES).delete(tilesOf(id))
}

export const deleteAutosaved = (id: string) =>
  transaction([DRAWINGS, CONTENTS, TILES], 'readwrite', running => removeDrawing(running, id))

async function allDrawings() {
  const request = await transaction([DRAWINGS], 'readonly', running => running.objectStore(DRAWINGS).getAll())
  return request.result as AutosavedDrawing[]
}

// The drawings that can be recovered, the newest first. First copies left unfinished by a crash are cleared away here
export async function listAutosaved() {
  const drawings = await allDrawings()
  const now = Date.now()
  const abandoned = drawings.filter(({ isComplete, time }) => !isComplete && now - time > UNFINISHED_MS)
  for (const { id } of abandoned) await deleteAutosaved(id)
  return drawings.filter(({ isComplete, isSaved }) => isComplete && !isSaved).sort((a, b) => b.time - a.time)
}

// A drawing from its copy, by the same road as a file, so a copy is checked like one
export async function loadAutosaved(id: string): Promise<ProjectData> {
  const read = await transaction([CONTENTS, TILES], 'readonly', running => ({
    contents: running.objectStore(CONTENTS).get(id) as IDBRequest<Contents | undefined>,
    keys: running.objectStore(TILES).getAllKeys(tilesOf(id)),
    tiles: running.objectStore(TILES).getAll(tilesOf(id)) as IDBRequest<Uint8Array[]>,
  }))
  const contents = read.contents.result
  if (!contents) throw new LydiaError('LYD-107')
  const bytes = new Map<number, Uint8Array>()
  read.keys.result.forEach((key, index) => bytes.set((key as [string, number])[1], read.tiles.result[index]))
  const withBytes = (tiles: SavedTile[]) =>
    tiles.map(({ column, row, color, tile }) => {
      if (color !== undefined) return { column, row, color }
      const packed = bytes.get(tile!)
      if (!packed) throw new LydiaError('LYD-107')
      return { column, row, packed }
    })
  const layers: LayerToSave[] = contents.layers.map(({ tiles, smart, ...layer }) => ({
    ...layer,
    tiles: withBytes(tiles),
    smart: smart && { ...smart, tiles: withBytes(smart.tiles) },
  }))
  const file = serializeProject(contents.paper, contents.activeLayer, contents.view, layers, true)
  return { ...parseProject(await file.arrayBuffer()), fromAutosave: id }
}

// Keeps the copy of one drawing. "pack": a tile's compressed bytes. "replaces": the copy this drawing was recovered
// from, which goes away once there is something newer
export function createAutosaver(pack: (tile: StoredTile) => Promise<Uint8Array>, replaces?: string) {
  const id = crypto.randomUUID()
  const numbers = new WeakMap<StoredTile, number>() // the record of each tile already written
  let nextNumber = 0
  let used = new Map<number, StoredTile>() // the records the last copy needs
  let hasStarted = false
  let replaced = replaces
  let lastThumbnail: Blob | null = null
  let lastSave: Promise<void> = Promise.resolve()

  async function dropReplaced() {
    if (replaced) await deleteAutosaved(replaced)
    replaced = undefined
  }

  function summary({ paper, thumbnail }: DrawingSnapshot, isComplete: boolean): AutosavedDrawing {
    const { width, height } = paper
    lastThumbnail = thumbnail ?? lastThumbnail
    return { id, time: Date.now(), width, height, thumbnail: lastThumbnail, isComplete, isSaved: false }
  }

  async function writeTiles(tiles: StoredTile[]) {
    const packed = await Promise.all(tiles.map(pack))
    const first = nextNumber
    nextNumber += tiles.length
    await transaction([TILES], 'readwrite', running => {
      const store = running.objectStore(TILES)
      packed.forEach((bytes, index) => store.put(bytes, [id, first + index]))
    })
    // Only now: a disk that is full leaves them unwritten, for the next autosave to try again
    tiles.forEach((tile, index) => numbers.set(tile, first + index))
  }

  // Write the tiles of this snapshot that aren't written yet, and the list of what it has
  async function write(snapshot: DrawingSnapshot) {
    if (!hasStarted) {
      await transaction([DRAWINGS], 'readwrite', running => running.objectStore(DRAWINGS).put(summary(snapshot, false)))
      hasStarted = true
    }

    const tileMaps = snapshot.layers.flatMap(({ tiles, smart }) => (smart ? [tiles, smart.tiles] : [tiles]))
    const missing = new Set<StoredTile>()
    for (const tiles of tileMaps) {
      for (const tile of tiles.values()) if (tile.color === undefined && !numbers.has(tile)) missing.add(tile)
    }
    const waiting = [...missing]
    for (let at = 0; at < waiting.length; at += TILES_AT_ONCE) await writeTiles(waiting.slice(at, at + TILES_AT_ONCE))

    const inUse = new Map<number, StoredTile>()
    const saved = (tiles: Map<string, StoredTile>) =>
      [...tiles].map(([key, tile]): SavedTile => {
        const { column, row } = parseTileKey(key)
        if (tile.color !== undefined) return { column, row, color: tile.color }
        const number = numbers.get(tile)!
        inUse.set(number, tile)
        return { column, row, tile: number }
      })
    const contents: Contents = {
      id,
      paper: snapshot.paper,
      activeLayer: snapshot.activeLayer,
      view: snapshot.view,
      layers: snapshot.layers.map(({ tiles, smart, ...layer }) => ({
        ...layer,
        tiles: saved(tiles),
        smart: smart && { ...smart, tiles: saved(smart.tiles) },
      })),
    }
    const stale = new Map([...used].filter(([number]) => !inUse.has(number)))
    const drawn = [DRAWINGS, CONTENTS, TILES]
    await transaction(
      drawn,
      'readwrite',
      running => {
        running.objectStore(CONTENTS).put(contents)
        running.objectStore(DRAWINGS).put(summary(snapshot, true))
        for (const number of stale.keys()) running.objectStore(TILES).delete([id, number])
      },
      'strict',
    )
    used = inUse
    // Undo can bring back a tile that left the drawing: it has to be written again then
    for (const tile of stale.values()) numbers.delete(tile)
    await dropReplaced()

    // Only the newest are kept
    const older = (await allDrawings()).sort((a, b) => b.time - a.time).slice(MAX_AUTOSAVED)
    for (const drawing of older) if (drawing.id !== id) await deleteAutosaved(drawing.id)
  }

  // One copy at a time: the numbers of the tiles go from one to the next
  function save(snapshot: DrawingSnapshot) {
    lastSave = lastSave.catch(() => {}).then(() => write(snapshot))
    return lastSave
  }

  // The drawing was saved as a file: there is nothing to recover. Its tiles stay for the next autosave, which then only
  // writes what changed
  async function markSaved() {
    await dropReplaced()
    if (!hasStarted) return
    await transaction([DRAWINGS], 'readwrite', running => {
      const store = running.objectStore(DRAWINGS)
      const request = store.get(id) as IDBRequest<AutosavedDrawing | undefined>
      request.onsuccess = () => {
        if (request.result) store.put({ ...request.result, isSaved: true })
      }
    })
  }

  // The drawing was closed with nothing to recover
  async function close() {
    await dropReplaced()
    if (hasStarted) await deleteAutosaved(id)
    hasStarted = false
  }

  return { id, save, markSaved, close }
}

export type Autosaver = ReturnType<typeof createAutosaver>
