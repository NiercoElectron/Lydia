import { app, ipcMain } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { allowFile } from './files.mjs'

// The drawings opened or saved lately, newest first, for the start screen (decision 92). They are kept here, in the
// app's own folder, and not by the page: the page may only read the files the person chose (see files.mjs), and only
// a drawing chosen in the system's window, saved there or opened with Lydia gets into this list. So a page can't make
// Lydia read any other file by putting it in the list. The page keeps its own pictures of them (see recentDrawings.ts)

const MOST = 12
const place = () => path.join(app.getPath('userData'), 'recent-drawings.json')

let list = null // { file, time }[], read from the disk the first time it is needed

async function recent() {
  if (list) return list
  try {
    const read = JSON.parse(await readFile(place(), 'utf8'))
    list = Array.isArray(read)
      ? read.filter(each => typeof each?.file === 'string' && typeof each?.time === 'number').slice(0, MOST)
      : []
  } catch {
    list = [] // none yet, or a file that can't be read: it starts again
  }
  return list
}

async function keep(changed) {
  list = changed
  try {
    await mkdir(path.dirname(place()), { recursive: true })
    await writeFile(place(), JSON.stringify(list))
  } catch (error) {
    console.warn('Could not keep the recent drawings:', error) // they stay for as long as the app is open
  }
}

const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

// A drawing the person chose, saved or opened with Lydia goes first in the list
export async function noteRecent(file) {
  const others = (await recent()).filter(each => !same(each.file, file))
  await keep([{ file: path.resolve(file), time: Date.now() }, ...others].slice(0, MOST))
}

export function setUpRecent() {
  ipcMain.handle('list-recent', async () => recent())
  // Opening one: only a file in the list can be read, and it goes first again
  ipcMain.handle('open-recent', async (_event, file) => {
    if (!(await recent()).some(each => same(each.file, file))) return false
    allowFile(file)
    await noteRecent(file)
    return true
  })
  ipcMain.handle('forget-recent', async (_event, file) => {
    await keep((await recent()).filter(each => !same(each.file, file)))
  })
}
