import { app, BrowserWindow, ipcMain, net, shell } from 'electron'
import electronUpdater from 'electron-updater'

// Updates from GitHub Releases, in the background (decision 87). On Windows a new version is downloaded, and installs when
// Lydia closes, or at once if asked, always after the usual question about changes that aren't saved. macOS only lets a
// signed app replace itself, which this one isn't yet, so there it tells of a new version and shows where to get it

const { autoUpdater } = electronUpdater

const REPOSITORY = 'NiercoElectron/Lydia'
const LATEST = `https://api.github.com/repos/${REPOSITORY}/releases/latest`
const DOWNLOAD_PAGE = `https://github.com/${REPOSITORY}/releases/latest`
const FIRST_CHECK_MS = 10 * 1000 // Lydia starts first
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

const FAKE_UPDATE = process.env.LYDIA_TEST_UPDATE // a test's version, as if it had just been downloaded

let update = null // the new version: { version, isReady }, with isReady false when it has to be downloaded by hand
let isInstallWanted = false

function tellOfUpdate(window, version, isReady) {
  update = { version, isReady }
  window?.webContents.send('update', update)
}

// "1.0.10" is newer than "1.0.9"
function isNewer(version, than) {
  const numbers = text => text.split('.').map(Number)
  const [a, b] = [numbers(version), numbers(than)]
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

async function checkOnMac() {
  const response = await net.fetch(LATEST, { headers: { 'User-Agent': 'Lydia' } })
  if (!response.ok) return
  const version = (await response.json()).tag_name.replace(/^v/, '')
  if (isNewer(version, app.getVersion())) tellOfUpdate(BrowserWindow.getAllWindows()[0], version, false)
}

function check() {
  const checking = process.platform === 'darwin' ? checkOnMac() : autoUpdater.checkForUpdates()
  // No internet is no reason to bother anyone: the next check tries again
  checking.catch(error => console.warn('Could not look for updates:', error.message))
}

// Close the window first, which asks about changes that aren't saved. Saying no leaves Lydia open: running the installer
// right away would close it anyway
function installNow() {
  if (!update?.isReady) return
  isInstallWanted = true
  BrowserWindow.getAllWindows()[0]?.close()
}

// When the last window is closed. Returns whether it takes care of closing Lydia
export function installIfWanted() {
  if (!isInstallWanted) return false
  if (FAKE_UPDATE) app.quit()
  else autoUpdater.quitAndInstall(true, true)
  return true
}

export function setUpUpdates() {
  ipcMain.handle('take-update', () => update)
  ipcMain.on('install-update', installNow)
  ipcMain.on('open-download-page', () => shell.openExternal(DOWNLOAD_PAGE))

  if (FAKE_UPDATE) {
    update = { version: FAKE_UPDATE, isReady: true }
    return
  }
  if (!app.isPackaged) return // the code being worked on has nothing to update

  autoUpdater.autoDownload = process.platform !== 'darwin'
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', ({ version }) => {
    tellOfUpdate(BrowserWindow.getAllWindows()[0], version, true)
  })
  autoUpdater.on('error', error => console.warn('Could not update:', error.message))

  setTimeout(check, FIRST_CHECK_MS)
  setInterval(check, CHECK_EVERY_MS)
}
