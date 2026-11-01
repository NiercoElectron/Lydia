// A folder of what stays for all drawings, as files (see electron/files.mjs)
type KeptFolder = 'brushes' | 'tray'
type KeptFile = { file: string; name: string; size: number; time: number }

// A new version of the desktop app. "isReady": downloaded, to install on closing; otherwise it has to be downloaded by hand
export type Update = { version: string; isReady: boolean }

// What only the desktop app can do (see electron/preload.cjs). It is undefined in a browser
type Desktop = {
  platform: string
  memory: { ram: number; card: number | null } // in bytes. "card": null where it can't be told
  setInterfaceSize: (percent: number) => void
  setCloseTexts: (texts: { message: string; leave: string; stay: string }) => void
  chooseToSave: (name: string) => Promise<string | null>
  chooseToOpen: () => Promise<string | null>
  exportPath: (name: string) => Promise<string>
  listKept: (folder: KeptFolder) => Promise<KeptFile[]>
  placeToKeep: (folder: KeptFolder, name: string) => Promise<string>
  keptFile: (folder: KeptFolder, name: string) => Promise<string>
  removeKept: (folder: KeptFolder, name: string) => Promise<void>
  startWriting: (file: string) => Promise<number>
  writeChunk: (id: number, bytes: Uint8Array) => Promise<void>
  finishWriting: (id: number) => Promise<void>
  abortWriting: (id: number) => Promise<void>
  sizeOf: (file: string) => Promise<number>
  readChunk: (file: string, offset: number, length: number) => Promise<Uint8Array>
  openFolder: () => Promise<string>
  takeUpdate: () => Promise<Update | null>
  onUpdate: (listener: (update: Update) => void) => void
  installUpdate: () => void
  openDownloadPage: () => void
  takeOpenedFile: () => Promise<string | null>
  onFileOpened: (listener: (file: string) => void) => void
}

export const desktop = (window as unknown as { lydiaDesktop?: Desktop }).lydiaDesktop

// Files go to the app in pieces: a big drawing is too much to hand over at once
const PIECE = 64 * 1024 * 1024

export async function writeFile(file: string, content: Blob) {
  const id = await desktop!.startWriting(file)
  try {
    for (let offset = 0; offset < content.size; offset += PIECE) {
      await desktop!.writeChunk(id, new Uint8Array(await content.slice(offset, offset + PIECE).arrayBuffer()))
    }
    await desktop!.finishWriting(id)
  } catch (error) {
    await desktop!.abortWriting(id)
    throw error
  }
}

export async function readFile(file: string) {
  const size = await desktop!.sizeOf(file)
  const bytes = new Uint8Array(size)
  for (let offset = 0; offset < size; offset += PIECE) {
    bytes.set(await desktop!.readChunk(file, offset, Math.min(PIECE, size - offset)), offset)
  }
  return bytes.buffer
}

// The name of a file, without its folder
export const baseName = (file: string) => file.split(/[\\/]/).pop() ?? file

// The name of a file, without its folder and extension
export const nameOfFile = (file: string) => baseName(file).replace(/\.[^.]*$/, '')

// Work on a folder one at a time: looking into it while a file is added would miss that file. Coming back from the
// system's window that chose the file does both at once
export function oneAtATime() {
  let last: Promise<unknown> = Promise.resolve()
  return <T>(work: () => Promise<T>) => {
    const running = last.then(work, work)
    last = running
    return running
  }
}

export const sameItems = <T>(a: T[], b: T[]) => a.length === b.length && a.every((item, index) => item === b[index])
