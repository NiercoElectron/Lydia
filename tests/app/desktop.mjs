// The desktop app itself: the built pages in Electron's window, at Lydia's own address, with a drawing on the graphics card
import { execSync, spawn } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir, totalmem } from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { PORT, ROOT } from './setup.mjs'

const electron = createRequire(import.meta.url)('electron')
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}

execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' })

const userData = mkdtempSync(path.join(tmpdir(), 'lydia-desktop-'))
// Documents, and the answers to the system's windows (see electron/files.mjs)
const folder = mkdtempSync(path.join(tmpdir(), 'lydia-documents-'))
const projects = path.join(folder, 'Lydia', 'Projects')
const exportsFolder = path.join(folder, 'Lydia', 'Exports')
const env = { ...process.env, LYDIA_TEST_FOLDER: folder, LYDIA_TEST_OPEN: 'Untitled.lyd' }
delete env.ELECTRON_RUN_AS_NODE
delete env.LYDIA_DEV_URL
const problems = []
let app, browser, page

async function start() {
  app = spawn(electron, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, '--lang=en-US'], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
  })
  browser = null
  page = undefined
  for (let i = 0; i < 100 && !browser; i++) {
    await sleep(200)
    browser = await puppeteer
      .connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null })
      .catch(() => null)
  }
  check('the app starts', browser !== null)
  for (let i = 0; i < 50 && !page; i++) {
    page = (await browser.pages()).find(each => each.url().startsWith('app://'))
    if (!page) await sleep(200)
  }
  page.on('pageerror', e => problems.push('PAGE ERROR ' + e))
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warn') problems.push(m.type() + ': ' + m.text())
  })
  // Lydia's questions are the system's windows here, which a test can't answer: they would stay on the screen
  const answerYes = () => {
    window.confirm = () => true
  }
  await page.evaluateOnNewDocument(answerYes)
  await page.evaluate(answerYes)
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'New project…'))
}

process.on('exit', () => app.kill()) // also when a step fails

await start()
check('at its own address', page.url() === 'app://lydia/', page.url())

const facts = await page.evaluate(async () => ({
  platform: window.lydiaDesktop?.platform,
  hasNode: typeof require !== 'undefined' || typeof process !== 'undefined',
  fontLoaded: await document.fonts.load('16px "IBM Plex Sans"').then(list => list.length > 0),
  outside: await fetch('app://lydia/..%2F..%2Fpackage.json').then(
    response => response.status,
    () => 'refused',
  ),
  opened: window.open('about:blank') === null,
}))
problems.length = 0 // the browser's own message about the file out of reach
check('it knows it is the desktop app', facts.platform === process.platform, facts.platform)
check('the page has no access to the computer', !facts.hasNode)
check('the interface font comes with it', facts.fontLoaded)
check('files outside the app are out of reach', facts.outside !== 200, String(facts.outside))
check('no other window opens', facts.opened)

await page.evaluate(() => localStorage.setItem('lydia.desktopTest', 'kept'))
await page.reload()
await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'New project…'))
const kept = await page.evaluate(() => localStorage.getItem('lydia.desktopTest'))
check('it remembers what it keeps', kept === 'kept', kept)
await page.evaluate(() => localStorage.removeItem('lydia.desktopTest'))

await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'New project…').click())
await page.waitForSelector('dialog.new-project[open]')
await page.click('button[type=submit]')
// The built app has no window.lydia (see DrawSpace.tsx): this goes by what the screen shows
await page.waitForSelector('.draw-space canvas', { timeout: 60000 })
await page.waitForFunction(() => document.querySelectorAll('button.brush').length > 0, { timeout: 60000 })
await sleep(800)
const box = await page.$eval('.draw-space canvas', element => {
  const { left, top, width, height } = element.getBoundingClientRect()
  return { left, top, width, height }
})
const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
const clip = { x: middle.x - 100, y: middle.y - 30, width: 200, height: 60 }
// The pixels of the screen around the stroke, once the brush's outline is away from there
await page.mouse.move(box.left + 10, box.top + 10)
await sleep(300)
const before = await page.screenshot({ clip, encoding: 'base64' })
await page.mouse.move(middle.x - 60, middle.y)
await page.mouse.down()
await page.mouse.move(middle.x + 60, middle.y, { steps: 8 })
await page.mouse.up()
await page.mouse.move(box.left + 10, box.top + 10)
await sleep(500)
const after = await page.screenshot({ clip, encoding: 'base64' })
check('it paints', before !== after)

// The interface's size, with a drawing open
await page.click('.settings-menu > button')
await page.waitForFunction(() =>
  [...document.querySelectorAll('label')].some(l => l.textContent.includes('Interface size')),
)
const sizeField = async () =>
  page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find(l => l.textContent.includes('Interface size'))
    const select = label.querySelector('select')
    return { value: select.value, ratio: window.devicePixelRatio, width: innerWidth }
  })
const wide = await sizeField()
await page.evaluate(() => {
  const label = [...document.querySelectorAll('label')].find(l => l.textContent.includes('Interface size'))
  const select = label.querySelector('select')
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '150')
  select.dispatchEvent(new Event('change', { bubbles: true }))
})
await sleep(500)
const bigger = await sizeField()
check(
  'Interface size makes it bigger',
  bigger.ratio === wide.ratio * 1.5 && bigger.width < wide.width,
  JSON.stringify(bigger),
)
const canvasPixels = await page.$eval('.draw-space canvas', element => ({
  ratio: element.width / element.getBoundingClientRect().width,
}))
check('and the drawing stays sharp', Math.abs(canvasPixels.ratio - bigger.ratio) < 0.02, String(canvasPixels.ratio))
await page.reload()
await page.waitForFunction(() => document.querySelectorAll('button').length > 0)
await sleep(500)
const afterReload = await page.evaluate(() => window.devicePixelRatio)
check('and stays so', afterReload === bigger.ratio, String(afterReload))

// ----- The computer's memory -----
const memory = await page.evaluate(() => window.lydiaDesktop.memory)
check('it knows the real RAM', memory.ram === totalmem(), String(memory.ram))
if (process.platform === 'win32') check('and the graphics card', memory.card > 0, String(memory.card))
await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'New project…'))
await page.click('button[aria-label="Settings"]')
await page.waitForFunction(() => document.querySelector('.gpu-memory select'))
const firstChoice = await page.$eval('.gpu-memory select', select => ({
  shown: select.selectedOptions[0].textContent,
  isFirst: select.selectedIndex === 0,
}))
check('it chooses by itself', firstChoice.isFirst && firstChoice.shown.startsWith('Automatic ('), firstChoice.shown)
const half = memory.card / 2 / 1024 ** 3
const chosen = Number(firstChoice.shown.match(/[\d.]+/)?.[0])
if (process.platform === 'win32') {
  check('at most half of the card', chosen <= half * 1.01 && chosen * 2 > half / 2, `${chosen} of ${half * 2}`)
}
await page.reload()

// ----- Both themes -----
// The window has a color of its own, which a page without one shows: its text would be dark on dark in the light theme
for (const [theme, background, text] of [
  ['light', 'rgb(255, 255, 255)', 'rgb(0, 0, 0)'],
  ['dark', 'rgb(18, 18, 18)', 'rgb(255, 255, 255)'],
]) {
  await page.evaluate(theme => localStorage.setItem('lydia.theme', theme), theme)
  await page.reload()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'New project…'))
  await page.screenshot({ path: path.join(ROOT, 'tests/app/output', `desktop-${theme}.png`) })
  const colors = await page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.querySelector('.home')).color,
    theme: document.documentElement.dataset.theme,
  }))
  check(
    `the ${theme} theme has its own colors`,
    colors.background === background && colors.text === text,
    JSON.stringify(colors),
  )
}
await page.evaluate(() => localStorage.removeItem('lydia.theme'))
await page.reload()

// ----- Saving and exporting -----
check('the folders are there', existsSync(projects) && existsSync(exportsFolder))
const startButton = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).click(), text)
await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'New project…'))
await startButton('New project…')
await page.waitForSelector('dialog.new-project[open]')
await page.click('button[type=submit]')
await page.waitForFunction(() => document.querySelectorAll('button.brush').length > 0, { timeout: 60000 })
await sleep(800)
const stroke = async y => {
  const area = await page.$eval('.draw-space canvas', element => {
    const { left, top, width, height } = element.getBoundingClientRect()
    return { x: left + width / 2, y: top + height / 2 }
  })
  await page.mouse.move(area.x - 60, area.y + y)
  await page.mouse.down()
  await page.mouse.move(area.x + 60, area.y + y, { steps: 8 })
  await page.mouse.up()
  await sleep(300)
}
const press = async (...keys) => {
  for (const key of keys.slice(0, -1)) await page.keyboard.down(key)
  await page.keyboard.press(keys.at(-1))
  for (const key of keys.slice(0, -1).reverse()) await page.keyboard.up(key)
}
await stroke(0)
const projectFile = path.join(projects, 'Untitled.lyd')
await press('Control', 's')
await page.waitForFunction(() => document.title.includes('Untitled'), { timeout: 10000 })
check('Ctrl+S saves in Projects', existsSync(projectFile))
const firstSize = statSync(projectFile).size
check('it is a Lydia project', readFileSync(projectFile).subarray(0, 4).toString().startsWith('LYD'), String(firstSize))
check('the window shows its name', (await page.title()) === 'Untitled - Lydia', await page.title())
await stroke(40)
const whileChanged = await page.title()
check('and that it has changes', whileChanged === 'Untitled * - Lydia', whileChanged)
await press('Control', 's')
await page.waitForFunction(() => document.title === 'Untitled - Lydia', { timeout: 10000 })
await page.waitForFunction(
  () => ![...document.querySelectorAll('button')].some(b => b.textContent === 'Save' && b.disabled),
)
check(
  'Ctrl+S again goes over the same file',
  statSync(projectFile).size > firstSize,
  String(statSync(projectFile).size),
)
check('with nothing left over', readdirSync(projects).length === 1, readdirSync(projects).join())

await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Export PNG').click())
await page.waitForSelector('.notice', { timeout: 10000 })
const images = readdirSync(exportsFolder)
check('Export goes straight to Exports', images.length === 1 && images[0].endsWith('.png'), images.join())
check('with the name of the drawing', images[0]?.startsWith('Untitled-'), images[0])
check('and is a PNG', readFileSync(path.join(exportsFolder, images[0])).subarray(1, 4).toString() === 'PNG')
const shownName = await page.$eval('.notice', element => element.textContent)
check('it says so', shownName.includes(images[0]), shownName)

// Open it again, from the start screen and by the system
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Back').click())
await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Open project'))
await startButton('Open project')
await page.waitForFunction(() => document.title === 'Untitled - Lydia', { timeout: 20000 })
await page.waitForSelector('.draw-space canvas', { timeout: 20000 })
check('Open project opens it', true)
await sleep(800)
await press('Control', 's')
await sleep(800)
check('saving goes to the file it came from', readdirSync(projects).length === 1, readdirSync(projects).join())

await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Back').click())
await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Open project'))
const second = spawn(electron, ['.', `--user-data-dir=${userData}`, projectFile], { cwd: ROOT, env, stdio: 'ignore' })
await page.waitForFunction(() => document.title === 'Untitled - Lydia', { timeout: 20000 })
check('a file opened with a second Lydia opens in the first', true)
await new Promise(resolve => second.once('close', resolve))

// While a drawing with changes is open, it asks first, and the file opens after that (the dialog is accepted above)
await sleep(800)
await stroke(-40)
const other = spawn(electron, ['.', `--user-data-dir=${userData}`, projectFile], { cwd: ROOT, env, stdio: 'ignore' })
await page.waitForFunction(() => document.title === 'Untitled - Lydia', { timeout: 20000 })
check('and over a drawing with changes, after asking', true)
await new Promise(resolve => other.once('close', resolve))

// ----- Brushes and the tray, as files -----
const brushesFolder = path.join(folder, 'Lydia', 'Brushes')
const trayFolder = path.join(folder, 'Lydia', 'Tray')
check('their folders are there', existsSync(brushesFolder) && existsSync(trayFolder))
const until = async (isDone, what) => {
  for (let i = 0; i < 100 && !(await isDone()); i++) await sleep(100)
  check(what, await isDone())
}
const comeBack = async () => {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await sleep(600)
}
const brushCount = () =>
  page.$$eval('.brush-count', counts => counts.reduce((sum, each) => sum + Number(each.textContent), 0))
const brushFile = name =>
  JSON.stringify({ ...JSON.parse(readFileSync(path.join(ROOT, 'src/brushes/pencil.lydbrush'), 'utf8')), name })
const brushNames = () => readdirSync(brushesFolder).join()

const builtIn = await brushCount()
writeFileSync(path.join(brushesFolder, 'Copied here.lydbrush'), brushFile('Copied here'))
writeFileSync(path.join(brushesFolder, 'broken.lydbrush'), 'not a brush')
writeFileSync(path.join(brushesFolder, 'notes.txt'), 'not a brush')
await comeBack()
await comeBack()
check('a brush copied into the folder shows up', (await brushCount()) === builtIn + 1, String(await brushCount()))
const broken = problems.filter(problem => problem.includes('broken.lydbrush'))
check('a broken file is left out, and only said once', broken.length === 1, String(broken.length))
problems.splice(0, problems.length, ...problems.filter(problem => !broken.includes(problem)))

const toImport = path.join(folder, 'Imported here.lydbrush')
writeFileSync(toImport, brushFile('Imported here'))
await (await page.$('.brushes-panel input[type=file]')).uploadFile(toImport)
await until(
  async () => existsSync(path.join(brushesFolder, 'Imported here.lydbrush')) && (await brushCount()) === builtIn + 2,
  'an imported brush goes into the folder',
)
await page.evaluate(() =>
  [...document.querySelectorAll('.brushes-actions button')].find(b => b.textContent === 'Delete').click(),
)
await until(
  async () => !existsSync(path.join(brushesFolder, 'Imported here.lydbrush')) && (await brushCount()) === builtIn + 1,
  'and Delete takes its file away',
)
writeFileSync(path.join(brushesFolder, 'Copied here.lydbrush'), brushFile('Changed outside'))
await comeBack()
const changedName = await page.$$eval('button.brush', list => list.some(b => b.title === 'Changed outside'))
check('a file changed outside is read again', changedName && (await brushCount()) === builtIn + 1)
rmSync(path.join(brushesFolder, 'Copied here.lydbrush'))
await comeBack()
check('and one taken away is gone', (await brushCount()) === builtIn, String(await brushCount()))
writeFileSync(path.join(brushesFolder, 'Copied here.lydbrush'), brushFile('Copied here'))
await comeBack()

await page.click('.tray-button')
await page.waitForSelector('.tray-panel')
const trayCount = () => page.$$eval('.tray-images li', list => list.length)
const image = path.join(exportsFolder, images[0])
copyFileSync(image, path.join(trayFolder, 'copied.png'))
writeFileSync(path.join(trayFolder, 'notes.txt'), 'not an image')
await comeBack()
await until(async () => (await trayCount()) === 1, 'an image copied into the Tray folder shows up')
await (await page.$('.tray-panel input[type=file]')).uploadFile(image)
await until(
  async () => existsSync(path.join(trayFolder, images[0])) && (await trayCount()) === 2,
  'an imported image goes into the folder',
)
check('nothing left over', readdirSync(trayFolder).length === 3, readdirSync(trayFolder).join())
await page.evaluate(() => [...document.querySelectorAll('.tray-remove')].at(-1).click())
await until(
  async () => !existsSync(path.join(trayFolder, images[0])) && (await trayCount()) === 1,
  'and taking it out takes its file away',
)

// The Brush Designer saves into the folder too: a new file for a copy, and the same file for its changes
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Back').click())
await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Brush Designer'))
await startButton('Brush Designer')
await page.waitForSelector('.designer-start select.start-brush')
await page.waitForFunction(() => document.querySelector('select.start-brush').options.length > 1)
await page.select('select.start-brush', 'added/Copied here.lydbrush')
await startButton('Open Brush Designer')
await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Save copy'), {
  timeout: 30000,
})
await sleep(800)
await startButton('Save copy')
await until(() => brushNames().includes('Copied here copy.lydbrush'), 'the Brush Designer keeps a copy in the folder')
const nameField = await page.$('.name-row input')
await nameField.click({ clickCount: 3 })
await nameField.type('Renamed')
await page.waitForFunction(() =>
  [...document.querySelectorAll('button')].some(b => b.textContent === 'Save changes' && !b.disabled),
)
await startButton('Save changes')
await until(
  () => readFileSync(path.join(brushesFolder, 'Copied here copy.lydbrush'), 'utf8').includes('Renamed'),
  'and saving changes goes over that file',
)
check('with no new file', readdirSync(brushesFolder).length === 4, brushNames())
rmSync(path.join(brushesFolder, 'broken.lydbrush'))
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Back').click())
await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'New project…'))

// ----- Closing all of a sudden -----
// The autosave stays in what the app keeps by itself (decision 87): here it must bring a drawing back after a crash
await page.evaluate(() => localStorage.setItem('lydia.autosave', '1'))
await startButton('New project…')
await page.waitForSelector('dialog.new-project[open]')
await page.click('button[type=submit]')
await page.waitForFunction(() => document.querySelectorAll('button.brush').length > 0, { timeout: 60000 })
await sleep(800)
await stroke(0)
// Lydia out of sight goes on keeping copies, and no frames are drawn for a window out of sight unless it asks for them
await page.evaluate(() => window.lydiaDesktop.minimize())
const hasCopy = () =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('lydia-autosave', 1)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const database = request.result
          const all = database.transaction('drawings').objectStore('drawings').getAll()
          all.onsuccess = () => {
            database.close()
            resolve(all.result.some(drawing => drawing.isComplete && !drawing.isSaved))
          }
        }
      }),
  )
let copied = false
for (let i = 0; i < 40 && !copied; i++) {
  await sleep(2000)
  copied = await hasCopy()
}
check('the drawing is autosaved', copied)
await browser.disconnect()
app.kill('SIGKILL')
await sleep(2000)
await start()
await page.waitForSelector('.recover', { timeout: 10000 })
check('after a crash it is in Recover', true)
await page.evaluate(() => [...document.querySelectorAll('.recover button')].find(b => b.textContent === 'Open').click())
await page.waitForSelector('.draw-space canvas', { timeout: 30000 })
check('and opens', true)
await page.waitForFunction(() => document.querySelectorAll('button.brush').length > 0, { timeout: 60000 })
await sleep(500)
check('the brushes are still there', (await brushCount()) === builtIn + 2, String(await brushCount()))
await page.click('.tray-button')
await page.waitForSelector('.tray-panel')
await until(async () => (await trayCount()) === 1, 'and so is the tray')

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.disconnect()
app.kill()
await sleep(500)
try {
  rmSync(userData, { recursive: true, force: true })
  rmSync(folder, { recursive: true, force: true })
} catch {
  // Windows may still hold a file for a moment; it is in the temporary folder
}
process.exit(failures ? 1 : 0)
