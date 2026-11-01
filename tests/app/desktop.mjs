// The desktop app itself: the built pages in Electron's window, at Lydia's own address, with a drawing on the graphics card
import { execSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
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
const app = spawn(electron, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, '--lang=en-US'], {
  cwd: ROOT,
  env,
  stdio: 'ignore',
})

process.on('exit', () => app.kill()) // also when a step fails

let browser = null
for (let i = 0; i < 100 && !browser; i++) {
  await sleep(200)
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null }).catch(() => null)
}
check('the app starts', browser !== null)

let page
for (let i = 0; i < 50 && !page; i++) {
  page = (await browser.pages()).find(each => each.url().startsWith('app://'))
  if (!page) await sleep(200)
}
const problems = []
page.on('pageerror', e => problems.push('PAGE ERROR ' + e))
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warn') problems.push(m.type() + ': ' + m.text())
})
await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'New project…'))
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

// ----- Saving and exporting -----
check('the folders are there', existsSync(projects) && existsSync(exportsFolder))
page.on('dialog', dialog => dialog.accept())
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
