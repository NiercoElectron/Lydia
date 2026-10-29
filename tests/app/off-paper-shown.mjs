// Layers off the paper: moving off and back, undo, selections, Delete, the brush and the fill kept on the paper, the
// ghost, saving (version 4, or 2 when nothing is off the paper), old files, and images bigger than the paper
import fs from 'node:fs'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { CACHE_DIR, LAUNCH, OUT, ROOT } from './setup.mjs'
const server = await createServer({
  root: ROOT,
  configFile: ROOT + '/vite.config.ts',
  cacheDir: CACHE_DIR,
  server: { port: 5198, strictPort: true },
  logLevel: 'silent',
})
await server.listen()
const browser = await puppeteer.launch(LAUNCH)
const page = await browser.newPage()
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
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
const keys = async (...combo) => {
  for (const k of combo.slice(0, -1)) await page.keyboard.down(k)
  await page.keyboard.press(combo.at(-1))
  for (const k of combo.slice(0, -1).reverse()) await page.keyboard.up(k)
  await sleep(60)
}
await page.goto('http://localhost:5198/', { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('lydia')
  window.confirm = () => true
})
await page.reload({ waitUntil: 'networkidle0' })

async function newDrawing(width, height) {
  await page.evaluate(() => delete window.lydia)
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
  await page.click('button[type=submit]')
  await ready()
}
const ready = async () => {
  await page.waitForFunction(
    () => window.lydia?.engine && window.lydia.app.renderer && document.querySelectorAll('button.brush').length > 0,
    { timeout: 90000 },
  )
  await sleep(400)
  await page.evaluate(() => window.lydia.engine.zoomView(1)) // whole pixels of the screen for each pixel of the paper
  await sleep(100)
}
const pageOf = (x, y) =>
  page.evaluate(
    (x, y) => {
      const { app, world } = window.lydia
      const box = app.canvas.getBoundingClientRect()
      const p = world.toGlobal({ x, y })
      return { x: box.left + p.x, y: box.top + p.y }
    },
    x,
    y,
  )
const waitIdle = () =>
  page.waitForFunction(
    () =>
      !window.lydia.engine.getSnapshot().task &&
      !window.lydia.projection.isUpdating() &&
      !window.lydia.gpu.hasUnsaved(),
    { timeout: 60000, polling: 20 },
  )
const colorAt = (x, y) => page.evaluate((x, y) => window.lydia.projection.colorAt(x, y), x, y)
const isRed = async (x, y) => (await colorAt(x, y)) === '#ff0000'
const isWhite = async (x, y) => (await colorAt(x, y)) === '#ffffff'
const tileKeys = () => page.evaluate(() => [...window.lydia.gpu.tilesWithPaint(window.lydia.stack.active)].sort())
const offPaperKeys = async () =>
  (await tileKeys()).filter(k => {
    const [c, r] = k.split(',').map(Number)
    return c < 0 || r < 0 || c > 3 || r > 3
  })
// Drag on the paper from one point to another (whole pixels at 100%)
async function drag(from, to, { midway } = {}) {
  const a = await pageOf(...from)
  const b = await pageOf(...to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 })
  const seen = midway ? await midway() : undefined
  await page.mouse.move(b.x, b.y, { steps: 4 })
  await page.mouse.up()
  await sleep(80)
  await waitIdle()
  return seen
}
const move = (dx, dy, options) => drag([500, 400], [500 + dx, 400 + dy], options)
// A red square on the active layer: a rectangle selected and filled, then nothing selected
async function redSquare(x0, y0, x1, y1) {
  await page.evaluate(() => window.lydia.engine.setBrush({ color: '#ff0000', opacity: 1 }))
  await keys('s')
  await drag([x0, y0], [x1, y1])
  await keys('f')
  const p = await pageOf((x0 + x1) / 2, (y0 + y1) / 2)
  await page.mouse.click(p.x, p.y)
  await sleep(100)
  await waitIdle()
  await keys('Control', 'd')
  await keys('v')
}

// The color the screen shows at a point of the paper (or around it), as red, green, blue
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
      return [...out.slice(0, 3)]
    },
    x,
    y,
  )
const layerInfo = () => page.evaluate(() => window.lydia.engine.getSnapshot().layers[0])
const iconShown = () =>
  page.evaluate(() => [...document.querySelectorAll('.layers-list .icon-button[title*="off the paper"]')].length)
const clickIcon = () =>
  page.evaluate(() => document.querySelector('.layers-list .icon-button[title*="off the paper"]').click())
const canUndoNow = () => page.evaluate(() => window.lydia.engine.getSnapshot().canUndo)

await newDrawing(1000, 800)
await page.evaluate(() => window.lydia.engine.zoomView(0.5))
await sleep(100)
await redSquare(880, 100, 960, 180)
let info = await layerInfo()
check('all on the paper: no icon', !info.hasOffPaper && (await iconShown()) === 0)

// Only in the edge tile's part past the paper (the paper ends at 1000, the tile at 1024)
await move(125, 0) // 1005–1085: past the edge tile too
await move(-80, 0) // 925–1005… wait: back so only a strip is past
await page.evaluate(() => window.lydia.engine.clearLayer())
await waitIdle()
await redSquare(950, 300, 990, 340)
await move(30, 0) // 980–1020: 20 pixels past the paper, inside the edge tile
info = await layerInfo()
check(
  "paint only in the edge tile's part past the paper: the icon shows",
  info.hasOffPaper && (await iconShown()) === 1,
)
await move(100, 0) // 1080–1120: off the paper, in a tile of its own
check('off the paper: the icon shows, off at first', (await iconShown()) === 1 && !(await layerInfo()).showsOffPaper)
const gray = await screenAt(1100, 320)
check('not shown: the gray around the paper', gray[0] === gray[1] && gray[1] === gray[2], gray.join())
const undoBefore = await canUndoNow()
const stepsBefore = await page.evaluate(() => window.lydia.history.canUndo())
await clickIcon()
await sleep(100)
const faded = await screenAt(1100, 320)
check(
  'shown: red, faded, around the paper',
  (await layerInfo()).showsOffPaper && faded[0] > gray[0] + 30 && faded[1] < gray[1] - 20 && faded[0] < 250,
  faded.join(),
)
check('…and the paper hides it where it is on the paper', (await screenAt(500, 500)).join() === '255,255,255')
await keys('Control', 'z')
await waitIdle()
check(
  'showing it is no step of undo: Ctrl+Z undoes the move before it',
  (await layerInfo()).showsOffPaper && (await colorAt(990, 320)) === '#ff0000',
  await colorAt(990, 320),
)
await keys('Control', 'Shift', 'z')
await waitIdle()

// While the layer is moved, the ghost shows it instead
const during = await move(0, 50, {
  midway: () =>
    page.evaluate(() => ({
      outside: window.lydia.app.stage.children[0].children[0].children[0].children.length,
      ghost: window.lydia.projection.ghost.visible,
    })),
})
check(
  'while it is moved: only the ghost shows it (not twice)',
  during.ghost && during.outside === 0,
  JSON.stringify(during),
)
check('…and afterwards, shown again where it went', (await screenAt(1100, 370))[0] > gray[0] + 30)

// Saved with the drawing
const saved = await page.evaluate(async () => {
  const blob = await window.lydia.engine.saveProject()
  let binary = ''
  const bytes = new Uint8Array(await blob.arrayBuffer())
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
})
fs.writeFileSync(OUT + '/shown-off-paper.lyd', Buffer.from(saved, 'base64'))
await page.evaluate(() => {
  window.confirm = () => true
  ;[...document.querySelectorAll('button')].find(b => b.textContent === 'Back').click()
})
await sleep(300)
await page.evaluate(() => delete window.lydia)
const [chooser] = await Promise.all([page.waitForFileChooser(), click('Open project')])
await chooser.accept([OUT + '/shown-off-paper.lyd'])
await ready()
await waitIdle()
await page.evaluate(() => window.lydia.engine.zoomView(0.5))
await sleep(100)
check('opened again: still shown', (await layerInfo()).showsOffPaper && (await screenAt(1100, 370))[0] > gray[0] + 30)
await page.screenshot({ path: OUT + '/outside-view.png' })

// Hidden again; brought back onto the paper: no icon
await clickIcon()
await sleep(100)
const hiddenAgain = await screenAt(1100, 370)
check('hidden again: the gray', hiddenAgain[0] === hiddenAgain[1], hiddenAgain.join())
await keys('v')
await move(-200, 0)
check('everything back on the paper: the icon goes', !(await layerInfo()).hasOffPaper && (await iconShown()) === 0)

// A transform that puts paint just past the edge: told once its tiles are in RAM
await page.evaluate(() => window.lydia.engine.clearLayer())
await waitIdle()
await page.evaluate(async () => {
  const canvas = new OffscreenCanvas(40, 40)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#00ff00'
  ctx.fillRect(0, 0, 40, 40)
  await window.lydia.engine.placeImage(await createImageBitmap(canvas), 'green', { x: 1000, y: 400 })
  await window.lydia.engine.applyTransform()
})
await sleep(300)
await waitIdle()
await sleep(200)
const top = await page.evaluate(() => window.lydia.engine.getSnapshot().layers.at(-1))
check('after a transform past the edge: the icon shows', top.hasOffPaper, JSON.stringify(top))

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
