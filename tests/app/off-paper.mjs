// Layers off the paper: moving off and back, undo, selections, Delete, the brush and the fill kept on the paper, the
// ghost, saving (version 4, or 2 when nothing is off the paper), old files, and images bigger than the paper
import fs from 'node:fs'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { CACHE_DIR, CHROME, FILES, OUT, ROOT } from './setup.mjs'
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

await newDrawing(1000, 800)
check('the zoom is 100%', (await page.evaluate(() => window.lydia.world.scale.y)) === 1)
await redSquare(880, 100, 960, 180)
check(
  'a red square at the right of the paper',
  (await isRed(900, 120)) && (await isRed(955, 175)) && (await isWhite(970, 120)),
)

// ----- Off to the right, and back -----
const ghostShown = await move(300, 0, { midway: () => page.evaluate(() => window.lydia.projection.ghost.visible) })
check('while it is moved, the ghost shows', ghostShown === true)
check('…and goes once it is put down', !(await page.evaluate(() => window.lydia.projection.ghost.visible)))
check('moved off the paper: gone from the paper', (await isWhite(900, 120)) && (await isWhite(990, 120)))
check('…but kept in tiles off the paper', (await offPaperKeys()).length > 0, (await offPaperKeys()).join(' '))
await move(-300, 0)
check(
  'moved back: the square is back, whole',
  (await isRed(880, 100)) && (await isRed(959, 179)) && (await isWhite(879, 120)) && (await isWhite(960, 120)),
)
check('…and nothing is left off the paper', (await offPaperKeys()).length === 0, (await offPaperKeys()).join(' '))
await keys('Control', 'z')
await waitIdle()
check('undo: off the paper again', (await isWhite(900, 120)) && (await offPaperKeys()).length > 0)
await keys('Control', 'z')
await waitIdle()
check('undo again: back where it was first', await isRed(900, 120))
await keys('Control', 'Shift', 'z')
await waitIdle()
await keys('Control', 'Shift', 'z')
await waitIdle()
check('redo, redo: back again', (await isRed(900, 120)) && (await offPaperKeys()).length === 0)

// ----- Off to the left (negative places), and back -----
await move(-1000, 0)
check(
  'moved off the left side: in tiles of negative columns',
  (await offPaperKeys()).some(k => k.startsWith('-')),
  (await offPaperKeys()).join(' '),
)
await move(1000, 0)
check('…and back', (await isRed(880, 100)) && (await isRed(959, 179)) && (await offPaperKeys()).length === 0)

// ----- The edge tile's part off the paper: Select all + Delete leaves it -----
await move(100, 0) // the square at 980–1060: on the paper, in the edge tile's part off it (1000–1024), and beyond
await keys('Control', 'a')
await keys('Delete')
await waitIdle()
await keys('Control', 'd')
check('Select all + Delete: nothing left on the paper', await isWhite(990, 120))
await move(-100, 0)
check(
  '…but what was off the paper is still there, also in the edge tile',
  (await isWhite(890, 120)) && (await isRed(905, 120)) && (await isRed(955, 120)),
  `${await colorAt(890, 120)} ${await colorAt(905, 120)} ${await colorAt(955, 120)}`,
)

// ----- A selection moves only what is selected, on the paper -----
await page.evaluate(() => window.lydia.engine.clearLayer())
await waitIdle()
await redSquare(880, 100, 960, 180)
await move(200, 0) // 1080–1160: off the paper
await redSquare(100, 100, 180, 180)
await keys('s')
await drag([50, 50], [300, 300])
await keys('v')
await move(0, 200)
await keys('Control', 'd')
check('with a selection: the selected square moves', (await isRed(120, 320)) && (await isWhite(120, 120)))
await move(-200, 0)
check('…and the paint off the paper, not selected, stayed where it was', await isRed(900, 120), await colorAt(900, 120))

// ----- The brush and the fill only paint on the paper -----
await page.evaluate(() => window.lydia.engine.clearLayer())
await waitIdle()
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#ff0000', opacity: 1, size: 60 }))
await keys('b')
await page.evaluate(() =>
  [...document.querySelectorAll('button.brush')].find(b => b.textContent.includes('Hard round')).click(),
)
await sleep(300)
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#ff0000', opacity: 1, size: 60 }))
const dot = await pageOf(995, 400)
await page.mouse.click(dot.x, dot.y)
await sleep(100)
await waitIdle()
await keys('v')
await move(-100, 0)
check(
  "the brush at the paper's edge painted nothing off it",
  (await isRed(880, 400)) && (await isWhite(915, 400)),
  `${await colorAt(880, 400)} ${await colorAt(915, 400)}`,
)
await page.evaluate(() => window.lydia.engine.clearLayer())
await waitIdle()
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#ff0000', opacity: 1 }))
await keys('f')
const anywhere = await pageOf(500, 400)
await page.mouse.click(anywhere.x, anywhere.y)
await sleep(100)
await waitIdle()
check('the fill covers the whole paper', (await isRed(999, 799)) && (await isRed(0, 0)))
await keys('v')
await move(-50, 0)
check(
  '…and nothing off it, also in the edge tiles',
  (await isRed(940, 400)) && (await isWhite(960, 400)),
  `${await colorAt(940, 400)} ${await colorAt(960, 400)}`,
)

// ----- Saving -----
const saveVersion = () =>
  page.evaluate(async () => {
    const blob = await window.lydia.engine.saveProject()
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const length = new DataView(bytes.buffer).getUint32(8, true)
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + length)))
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return { version: header.version, base64: btoa(binary) }
  })
const offSave = await saveVersion() // the fill moved 50 to the left: some of it is off the paper
check('a drawing with paint off the paper is saved as version 4', offSave.version === 4, offSave.version)
fs.writeFileSync(OUT + '/off-paper.lyd', Buffer.from(offSave.base64, 'base64'))
await move(50, 0)
const onSave = await saveVersion()
check('with nothing off the paper, as version 2, for older Lydias', onSave.version === 2, onSave.version)
fs.writeFileSync(OUT + '/on-paper.lyd', Buffer.from(onSave.base64, 'base64'))

async function openFile(path) {
  await page.evaluate(() => {
    window.confirm = () => true
    ;[...document.querySelectorAll('button')].find(b => b.textContent === 'Back').click()
  })
  await sleep(300)
  await page.evaluate(() => delete window.lydia)
  const [chooser] = await Promise.all([page.waitForFileChooser(), click('Open project')])
  await chooser.accept([path])
  await ready()
  await waitIdle()
}
await openFile(OUT + '/off-paper.lyd')
check('opened again: what was on the paper', (await isRed(900, 400)) && (await isWhite(960, 400)))
await keys('v')
await move(50, 0)
check(
  '…and what was off it comes back',
  (await isRed(999, 400)) && (await isRed(0, 400)),
  `${await colorAt(999, 400)} ${await colorAt(0, 400)}`,
)
await openFile(OUT + '/on-paper.lyd')
check('version 2 opens: the whole paper red', (await isRed(999, 799)) && (await isRed(0, 0)))
await keys('v')
await move(-30, -30)
check(
  '…its edge tiles made whole, with nothing off the paper',
  (await isRed(969, 769)) && (await isWhite(975, 400)) && (await isWhite(400, 775)),
  `${await colorAt(969, 769)} ${await colorAt(975, 400)} ${await colorAt(400, 775)}`,
)

// An older file, with a smart object (version 3, 1500×1000)
await openFile(FILES + '/smart-object-v3.lyd')
const edges = await page.evaluate(() => {
  const sizes = []
  for (const layer of window.lydia.stack.layers) {
    for (const tiles of [layer.tiles, layer.smart?.source.tiles].filter(Boolean)) {
      for (const tile of tiles.values()) if (tile.pixels) sizes.push(tile.pixels.length)
    }
  }
  return sizes
})
check(
  'a version 3 file opens, its unpacked tiles whole',
  edges.every(length => length === 256 * 256 * 4),
  edges.join(' '),
)

// ----- An image bigger than the paper keeps its size -----
await page.evaluate(() => {
  window.confirm = () => true
  ;[...document.querySelectorAll('button')].find(b => b.textContent === 'Back').click()
})
await sleep(300)
await newDrawing(1000, 800)
const placed = await page.evaluate(async () => {
  const canvas = new OffscreenCanvas(1500, 1200)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(0, 0, 1500, 1200)
  ctx.fillStyle = '#0000ff'
  ctx.fillRect(0, 0, 100, 100) // its top left corner blue, off the paper once centered
  const image = await createImageBitmap(canvas)
  await window.lydia.engine.placeImage(image, 'big', { x: 500, y: 400 })
  return { ghost: window.lydia.projection.ghost.visible, bounds: window.lydia.engine.getSnapshot().transform && true }
})
check('placing it: the ghost shows what is off the paper', placed.ghost)
await page.screenshot({ path: OUT + '/off-paper-ghost.png' })
await page.evaluate(() => window.lydia.engine.applyTransform())
await sleep(200)
await waitIdle()
const object = await page.evaluate(() => window.lydia.stack.active.smart?.bounds)
check('an image of 1500×1200 keeps its size', object?.width === 1500 && object?.height === 1200, JSON.stringify(object))
check(
  '…in tiles off the paper too',
  (await offPaperKeys()).some(k => k.startsWith('-')),
  (await offPaperKeys()).slice(0, 4).join(' '),
)
await keys('v')
await move(250, 200) // its corner: from (-250, -200) to (0, 0)
check(
  '…and its corner off the paper can be moved onto it',
  (await colorAt(50, 50)) === '#0000ff',
  await colorAt(50, 50),
)

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
