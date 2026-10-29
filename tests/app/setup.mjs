// What every test of the app shares (see README.md here): where the project is, where the tests write what they make
// (screenshots to look at, saved drawings they open again), Vite's cache for the tests' own server, and the browser
// that runs them
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const ROOT = resolve(here, '../..').replaceAll('\\', '/')
export const OUT = resolve(here, 'output').replaceAll('\\', '/')
mkdirSync(OUT, { recursive: true })
// Drawings saved by older versions of Lydia, which it must still open
export const FILES = resolve(here, 'files').replaceAll('\\', '/')
// Apart from the cache of the development server, so that the tests never disturb it
export const CACHE_DIR = resolve(ROOT, 'node_modules/.vite-app-tests').replaceAll('\\', '/')

// Google Chrome, or the browser in CHROME_PATH. Lydia needs WebGL 2, which Chrome has even with no window
const CHROME_PLACES = {
  win32: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
}
export const CHROME = process.env.CHROME_PATH ?? (CHROME_PLACES[process.platform] ?? []).find(path => existsSync(path))
if (!CHROME) throw new Error('Google Chrome was not found: set CHROME_PATH to the browser to run the tests with.')
