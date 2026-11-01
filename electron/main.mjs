import { app, BrowserWindow, dialog, Menu, net, protocol, shell } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

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
      buttons: ['Close without saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'There are changes that are not saved.',
    })
    if (answer === 0) event.preventDefault()
  })

  window.loadURL(DEV_URL ?? HOME)
}

// Only one Lydia at a time for now: all windows would share the same autosaves and brushes
if (!app.requestSingleInstanceLock()) app.quit()

app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows()
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

app.whenReady().then(() => {
  protocol.handle(SCHEME, serveBuiltApp)
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
