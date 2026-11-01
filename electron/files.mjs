import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { open, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

// Lydia's files on the computer: its folders in Documents, and writing and reading projects and images for the page.
// The page can only reach files that came from here: a path chosen in a window of the system, or one in these folders

const PROJECT_EXTENSION = 'lyd'
// While a file is written it has this at the end of its name, so that a failure leaves the file it replaces untouched
const WRITING = '.saving'

// A test answers the system's windows with this folder, which also takes the place of Documents
const TEST_FOLDER = process.env.LYDIA_TEST_FOLDER

const root = () => path.join(TEST_FOLDER ?? app.getPath('documents'), 'Lydia')
const projects = () => path.join(root(), 'Projects')
const exportsFolder = () => path.join(root(), 'Exports')

const allowed = new Set() // the paths the page may read and write
const writing = new Map() // what is being written: a number -> its file, and where it goes when finished
let lastWrite = 0

// A name without what the system doesn't accept in one
const safeName = name => name.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_').trim() || 'lydia'

export function allowFile(file) {
  allowed.add(path.resolve(file))
}

function check(file) {
  if (!allowed.has(path.resolve(file))) throw new Error('This file did not come from Lydia.')
  return path.resolve(file)
}

async function chooseToSave(event, name) {
  const defaultPath = path.join(projects(), `${safeName(name)}.${PROJECT_EXTENSION}`)
  if (TEST_FOLDER) {
    allowFile(defaultPath)
    return defaultPath
  }
  const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
    defaultPath,
    filters: [{ name: 'Lydia', extensions: [PROJECT_EXTENSION] }],
  })
  if (canceled || !filePath) return null
  allowFile(filePath)
  return filePath
}

async function chooseToOpen(event) {
  if (TEST_FOLDER) {
    const file = path.join(projects(), process.env.LYDIA_TEST_OPEN)
    allowFile(file)
    return file
  }
  const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    defaultPath: projects(),
    filters: [{ name: 'Lydia', extensions: [PROJECT_EXTENSION] }],
    properties: ['openFile'],
  })
  if (canceled || filePaths.length === 0) return null
  allowFile(filePaths[0])
  return filePaths[0]
}

// A place in Exports for this name, with a number when it is taken
async function exportPath(_event, name) {
  const { name: base, ext } = path.parse(safeName(name))
  for (let i = 1; ; i++) {
    const file = path.join(exportsFolder(), `${base}${i > 1 ? `-${i}` : ''}${ext}`)
    const isTaken = await stat(file).then(
      () => true,
      () => false,
    )
    if (!isTaken) {
      allowFile(file)
      return file
    }
  }
}

async function startWriting(_event, file) {
  const target = check(file)
  const handle = await open(target + WRITING, 'w')
  lastWrite += 1
  writing.set(lastWrite, { handle, target })
  return lastWrite
}

async function writeChunk(_event, id, bytes) {
  await writing.get(id).handle.writeFile(bytes)
}

async function finishWriting(_event, id) {
  const { handle, target } = writing.get(id)
  writing.delete(id)
  await handle.close()
  await rename(target + WRITING, target)
}

async function abortWriting(_event, id) {
  const entry = writing.get(id)
  if (!entry) return
  writing.delete(id)
  await entry.handle.close()
  await rm(entry.target + WRITING, { force: true })
}

async function sizeOf(_event, file) {
  return (await stat(check(file))).size
}

async function readChunk(_event, file, offset, length) {
  const handle = await open(check(file), 'r')
  try {
    const bytes = new Uint8Array(length)
    const { bytesRead } = await handle.read(bytes, 0, length, offset)
    return bytes.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

export function setUpFiles() {
  mkdirSync(projects(), { recursive: true })
  mkdirSync(exportsFolder(), { recursive: true })

  ipcMain.handle('choose-to-save', chooseToSave)
  ipcMain.handle('choose-to-open', chooseToOpen)
  ipcMain.handle('export-path', exportPath)
  ipcMain.handle('start-writing', startWriting)
  ipcMain.handle('write-chunk', writeChunk)
  ipcMain.handle('finish-writing', finishWriting)
  ipcMain.handle('abort-writing', abortWriting)
  ipcMain.handle('size-of', sizeOf)
  ipcMain.handle('read-chunk', readChunk)
  ipcMain.handle('open-folder', () => shell.openPath(root()))
}
