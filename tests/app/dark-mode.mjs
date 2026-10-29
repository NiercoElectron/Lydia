// Dark mode: System, Light or Dark, remembered; the gray around the paper follows
import fs from 'node:fs'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { CACHE_DIR, CHROME, OUT, ROOT } from './setup.mjs'
const server = await createServer({
  root: ROOT,
  configFile: ROOT + '/vite.config.ts',
  cacheDir: CACHE_DIR,
  server: { port: 5198, strictPort: true },
  logLevel: 'silent',
})
await server.listen()
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage()
const problems = []
page.on('pageerror', e => problems.push('PAGE ERROR ' + e))
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warn') problems.push(m.type() + ': ' + m.text())
})
await page.setViewport({ width: 1600, height: 900 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
const click = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).click(), text)
await page.goto('http://localhost:5198/', { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('lydia')
})
await page.reload({ waitUntil: 'networkidle0' })

async function newDrawing(width, height) {
  await click('New project…')
  await page.waitForSelector('dialog.new-project[open]')
  const inputs = await page.$$('dialog input[type=number]')
  for (const [i, value] of [
    [0, width],
    [1, height],
  ]) {
    await inputs[i].click({ clickCount: 3 })
    await inputs[i].type(String(value))
  }
  const isTransparent = await page.$eval(
    'dialog',
    d =>
      [...d.querySelectorAll('button')].find(b => b.textContent === 'Transparent').getAttribute('aria-pressed') ===
      'true',
  )
  if (isTransparent) await click('Transparent')
  await page.click('button[type=submit]')
  await page.waitForFunction(
    () => window.lydia?.engine && window.lydia.app.renderer && document.querySelectorAll('button.brush').length > 0,
    { timeout: 90000 },
  )
  await sleep(400)
}
const pageOf = (x, y) =>
  page.evaluate(
    (x, y) => {
      const { app, world } = window.lydia
      app.render()
      const box = app.canvas.getBoundingClientRect()
      const p = world.toGlobal({ x, y })
      return { x: box.left + p.x, y: box.top + p.y }
    },
    x,
    y,
  )
// Press at one point of the paper and move through the others, without letting go
async function press(points) {
  const first = await pageOf(...points[0])
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  for (const [x, y] of points.slice(1)) {
    const p = await pageOf(x, y)
    await page.mouse.move(p.x, p.y, { steps: 4 })
  }
}
async function drag(points) {
  await press(points)
  await page.mouse.up()
  await sleep(50)
}
const selectedAt = (x, y) =>
  page.evaluate(
    (x, y) => {
      const selection = window.lydia.engine.getSelection()
      if (!selection) return null
      const column = Math.floor(x / 256),
        row = Math.floor(y / 256)
      const tile = selection.get(column + ',' + row)
      if (!tile) return 0
      if (tile === 'full') return 255
      const width = window.lydia.projection.tiles.get(column + ',' + row).width
      return tile[(Math.floor(y) - row * 256) * width + (Math.floor(x) - column * 256)]
    },
    x,
    y,
  )
// The color in the projection (what the drawing has), and the color the screen shows right now
const shownAt = (x, y) => page.evaluate((x, y) => window.lydia.projection.colorAt(x, y), x, y)
const screenAt = (x, y) =>
  page.evaluate(
    (x, y) => {
      const { app, world } = window.lydia
      app.render()
      const gl = app.renderer.gl
      const r = app.renderer.resolution
      const p = world.toGlobal({ x, y })
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      const out = new Uint8Array(4)
      gl.readPixels(
        Math.floor(p.x * r),
        gl.drawingBufferHeight - Math.floor(p.y * r) - 1,
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        out,
      )
      return '#' + [...out.slice(0, 3)].map(v => v.toString(16).padStart(2, '0')).join('')
    },
    x,
    y,
  )
const snapshot = () => page.evaluate(() => window.lydia.engine.getSnapshot())
const keys = async (...combo) => {
  for (const k of combo.slice(0, -1)) await page.keyboard.down(k)
  await page.keyboard.press(combo.at(-1))
  for (const k of combo.slice(0, -1).reverse()) await page.keyboard.up(k)
  await sleep(60)
}
const waitIdle = () =>
  page.waitForFunction(() => !window.lydia.engine.getSnapshot().task && !window.lydia.projection.isUpdating(), {
    timeout: 60000,
    polling: 10,
  })

// ----- Dark mode -----

const theme = () => page.evaluate(() => document.documentElement.dataset.theme)
const pressed = () =>
  page.$$eval('.theme-choice button', bs =>
    bs
      .filter(b => b.getAttribute('aria-pressed') === 'true')
      .map(b => b.textContent)
      .join(),
  )
const bodyColor = () =>
  page.evaluate(
    () => getComputedStyle(document.body).color + ' on ' + getComputedStyle(document.documentElement).colorScheme,
  )
const backdrop = () => page.evaluate(() => window.lydia.app.renderer.background.color.toHex())
const choose = async label => {
  await page.evaluate(
    label => [...document.querySelectorAll('.theme-choice button')].find(b => b.textContent === label).click(),
    label,
  )
  await sleep(100)
}

await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
await page.reload({ waitUntil: 'networkidle0' })
check(
  'it starts on System, light when the computer is light',
  (await pressed()) === 'System' && (await theme()) === 'light',
  `${await pressed()} ${await theme()}`,
)
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
await sleep(100)
check('System follows the computer when it turns dark', (await theme()) === 'dark', await theme())
const darkBody = await bodyColor()
check('…and the page gets dark', darkBody === 'rgb(255, 255, 255) on dark', darkBody)
await page.screenshot({ path: OUT + '/dark-home.png' })

await choose('Light')
check('Light makes it light, on a dark computer', (await theme()) === 'light' && (await pressed()) === 'Light')
await page.reload({ waitUntil: 'networkidle0' })
check('…and is remembered', (await theme()) === 'light' && (await pressed()) === 'Light')
await choose('Dark')
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
await sleep(100)
check('Dark stays dark on a light computer', (await theme()) === 'dark' && (await pressed()) === 'Dark')

// In a drawing: the gray around the paper follows
await page.evaluate(() => delete window.lydia)
await newDrawing(800, 600)
check('around the paper, a dark gray in dark mode', (await backdrop()) === '#2b2b2b', await backdrop())
await keys('b')
await page.click('button.tray-button')
await sleep(100)
await page.screenshot({ path: OUT + '/dark-editor.png' })
await page.click('button.tray-button')
const previewFilter = await page.$eval('.brush-preview', c => getComputedStyle(c).filter)
check("the brushes' sample strokes show white on their dark cards", previewFilter.includes('invert'), previewFilter)

// Switching while a drawing is open (from the start screen and back)
page.once('dialog', d => d.accept())
await click('Back')
await sleep(300)
await choose('Light')
await page.evaluate(() => delete window.lydia)
await newDrawing(800, 600)
check('around the paper, the middle gray in light mode', (await backdrop()) === '#808080', await backdrop())
await page.screenshot({ path: OUT + '/light-editor.png' })

// The Brush Designer too
page.once('dialog', d => d.accept())
await click('Back')
await sleep(300)
await choose('Dark')
await page.evaluate(() => delete window.lydia)
await click('Open Brush Designer')
await page.waitForFunction(() => window.lydia?.engine && document.querySelector('.designer-panel'), { timeout: 90000 })
await sleep(400)
check('the Brush Designer follows too', (await backdrop()) === '#2b2b2b', await backdrop())
await page.screenshot({ path: OUT + '/dark-designer.png' })

console.log(problems.length ? 'problems: ' + problems.slice(0, 8).join(' | ') : 'no errors or warnings in the console')
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
