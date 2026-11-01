// What only the desktop app can do (see electron/preload.cjs). It is undefined in a browser
type Desktop = {
  platform: string
  setInterfaceSize: (percent: number) => void
  setCloseTexts: (texts: { message: string; leave: string; stay: string }) => void
  chooseToSave: (name: string) => Promise<string | null>
  chooseToOpen: () => Promise<string | null>
  exportPath: (name: string) => Promise<string>
  startWriting: (file: string) => Promise<number>
  writeChunk: (id: number, bytes: Uint8Array) => Promise<void>
  finishWriting: (id: number) => Promise<void>
  abortWriting: (id: number) => Promise<void>
  sizeOf: (file: string) => Promise<number>
  readChunk: (file: string, offset: number, length: number) => Promise<Uint8Array>
  openFolder: () => Promise<string>
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

// The name of a file, without its folder and extension
export const nameOfFile = (file: string) => (file.split(/[\\/]/).pop() ?? file).replace(/\.[^.]*$/, '')
