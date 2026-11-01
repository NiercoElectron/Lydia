import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { allowFile, setUpFiles } from './files.mjs'

// The desktop app: a window that shows Lydia. It is the same app as in the browser, built by Vite into "dist", and this
// file adds what a browser can't do

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BUILT_APP = path.join(HERE, '..', 'dist')
// In development, the page comes from Vite's server (see scripts/desktop.mjs)
const DEV_URL = process.env.LYDIA_DEV_URL
// Lydia's own address. With one, the pages find their files as they do on a web server, and what the browser keeps
// (settings, brushes, autosaves) belongs to one place that doesn't change between versions
const SCHEME = 'app'
const HOST = 'lydia'
const HOME = `${SCHEME}://${HOST}/`
// The pages run only what comes with Lydia: nothing from the internet, even if a file opened in it tried
const CONTENT_POLICY = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
].join('; ')

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

// A project the system asked to open, until the page takes it
let openedFile = null
// The words of the question on closing, in the interface's language, from the page
let closeTexts = {
  message: 'There are changes that are not saved.',
  leave: 'Close without saving',
  stay: 'Cancel',
}

// On Windows a file opened with Lydia comes as an argument, when it starts and when a second Lydia starts
const projectIn = args => args.slice(1).find(arg => arg.toLowerCase().endsWith('.lyd')) ?? null

function openProject(file) {
  allowFile(file)
  const [window] = BrowserWindow.getAllWindows()
  if (window) {
    if (window.isMinimized()) window.restore()
    window.focus()
  }
  if (window && !window.webContents.isLoading()) window.webContents.send('file-opened', file)
  else openedFile = file
}

// A file of the built app for each address, and never one outside its folder
async function serveBuiltApp(request) {
  const wanted = decodeURIComponent(new URL(request.url).pathname)
  const file = path.normalize(path.join(BUILT_APP, wanted === '/' ? 'index.html' : wanted))
  if (!file.startsWith(BUILT_APP + path.sep)) return new Response(null, { status: 404 })
  const response = await net.fetch(pathToFileURL(file).href).catch(() => new Response(null, { status: 404 }))
  const headers = new Headers(response.headers)
  headers.set('Content-Security-Policy', CONTENT_POLICY)
  return new Response(response.body, { status: response.status, headers })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1600,
    height: 900,
    show: false,
    backgroundColor: '#1e1e1e',
    title: 'Lydia',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(HERE, 'preload.cjs'),
    },
  })
  window.once('ready-to-show', () => {
    window.maximize()
    window.show()
  })

  // Links open in the computer's browser, and the window never leaves Lydia
  const isOwn = url => url.startsWith(DEV_URL ?? HOME)
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isOwn(url)) event.preventDefault()
  })

  // A page that asks before closing (changes not saved) only gets an answer here: Electron shows nothing by itself, and
  // the window would just refuse to close
  window.webContents.on('will-prevent-unload', event => {
    const answer = dialog.showMessageBoxSync(window, {
      type: 'warning',
      buttons: [closeTexts.leave, closeTexts.stay],
      defaultId: 1,
      cancelId: 1,
      message: closeTexts.message,
    })
    if (answer === 0) event.preventDefault()
  })

  window.loadURL(DEV_URL ?? HOME)
}

// Only one Lydia at a time for now: all windows would share the same autosaves and brushes
if (!app.requestSingleInstanceLock()) app.quit()

app.on('second-instance', (_event, args) => {
  const file = projectIn(args)
  if (file) {
    openProject(file)
    return
  }
  const [window] = BrowserWindow.getAllWindows()
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

// On macOS a file opened with Lydia comes as an event, also before the window exists
app.on('open-file', (event, file) => {
  event.preventDefault()
  openProject(file)
})

ipcMain.on('close-texts', (_event, texts) => {
  closeTexts = texts
})

ipcMain.handle('take-opened-file', () => {
  const file = openedFile
  openedFile = null
  return file
})

app.whenReady().then(() => {
  protocol.handle(SCHEME, serveBuiltApp)
  setUpFiles()
  const started = projectIn(process.argv)
  if (started) openProject(started)
  // macOS needs the standard menu for its own keys (Cmd+Q, copy, paste in text fields). Lydia has its menus in the window
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
