// Straight lines: Shift + click from where the last stroke ended, shown while Shift is held, Ctrl keeping the angle
// (pixel art steps for pixel brushes, 15 degrees for the others), Bresenham for pixel brushes, undo, the eraser
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
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}

// ----- In the app -----
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage()
const problems = []
page.on('pageerror', e => problems.push('PAGE ERROR ' + e))
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warn') problems.push(m.type() + ': ' + m.text())
})
await page.setViewport({ width: 1600, height: 900 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
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
      const box = app.canvas.getBoundingClientRect()
      const p = world.toGlobal({ x, y })
      return { x: box.left + p.x, y: box.top + p.y }
    },
    x,
    y,
  )
const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
const setSize = size =>
  page.evaluate(size => {
    const input = document.querySelector('label[title^="Brush size"] input[type=range]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(size))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, size)
const ppButton = () =>
  page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Pixel-perfect')
    return button ? button.getAttribute('aria-pressed') : null
  })
const colorAt = (x, y) => page.evaluate((x, y) => window.lydia.projection.colorAt(x, y), x, y)
const isPainted = async (x, y) => (await colorAt(x, y)) !== '#ffffff'
const moveTo = async (x, y) => {
  const p = await pageOf(x, y)
  await page.mouse.move(p.x, p.y)
  await frames()
}
const paintedIn = (x, y, w, h) =>
  page.evaluate(
    (x, y, w, h) => {
      const painted = []
      for (let j = y; j < y + h; j++)
        for (let i = x; i < x + w; i++) if (window.lydia.projection.colorAt(i, j) !== '#ffffff') painted.push([i, j])
      return painted
    },
    x,
    y,
    w,
    h,
  )
const clickAt = async (x, y, ...keys) => {
  for (const k of keys) await page.keyboard.down(k)
  const p = await pageOf(x, y)
  await page.mouse.move(p.x, p.y)
  await frames()
  await page.mouse.down()
  await page.mouse.up()
  for (const k of keys.reverse()) await page.keyboard.up(k)
  await sleep(120)
}
const chooseBrush = name =>
  page.evaluate(
    name => [...document.querySelectorAll('button.brush')].find(b => b.textContent.trim().startsWith(name)).click(),
    name,
  )

// ----- The rules -----
const { pixelLinePoints } = await server.ssrLoadModule('/src/engine/dabs.ts')
const { straightLineEnd } = await server.ssrLoadModule('/src/engine/straightLine.ts')
const round = { pixel: 'round', pressureSize: true }
const corners = points => points.map(p => `${p.x - 0.5},${p.y - 0.5}`)
const flat = pixelLinePoints(round, 1, { x: 0.5, y: 0.5, pressure: 1 }, { x: 20.5, y: 10.5, pressure: 1 })
check(
  '2:1, Bresenham: 21 pixels, one per column, two in each row but the last',
  flat.length === 21 &&
    new Set(flat.map(p => p.x)).size === 21 &&
    [...Array(10).keys()].every(row => flat.filter(p => p.y === row + 0.5).length === 2),
  corners(flat).join(' '),
)
const back = pixelLinePoints(round, 1, { x: 20.5, y: 10.5, pressure: 1 }, { x: 0.5, y: 0.5, pressure: 1 })
check(
  'drawn the other way, from its own start to its own end',
  back[0].x === 20.5 && back.at(-1).x === 0.5 && back.length === 21,
)
const steep = pixelLinePoints(round, 1, { x: 0.5, y: 0.5, pressure: 1 }, { x: 3.5, y: 9.5, pressure: 1 })
check('steep: one per row', steep.length === 10 && new Set(steep.map(p => p.y)).size === 10)
check(
  '1:3, whole steps: three in each of the first columns, from the start',
  [0, 1, 2].every(column => steep.filter(p => p.x === column + 0.5).length === 3),
  corners(steep).join(' '),
)
const loose = pixelLinePoints(round, 1, { x: 0.5, y: 0.5, pressure: 1 }, { x: 7.5, y: 3.5, pressure: 1 })
check(
  '7:3, not whole steps: the pixels nearest the line',
  corners(loose).join(' ') === '0,0 1,0 2,1 3,1 4,2 5,2 6,3 7,3',
  corners(loose).join(' '),
)
const even = pixelLinePoints(round, 4, { x: 10, y: 10, pressure: 1 }, { x: 20, y: 10, pressure: 1 })
check(
  'size 4: centers on the corners between pixels',
  even.every(p => Number.isInteger(p.x) && Number.isInteger(p.y)) && even.length === 11,
)
const half = pixelLinePoints(round, 4, { x: 10, y: 10, pressure: 0.5 }, { x: 20, y: 10, pressure: 1 })
check(
  "the click's pressure for the whole line, sizing it (2 at half of 4)",
  half.every(p => p.pressure === 0.5) && half[0].x === 10,
)
const snapped = straightLineEnd({ x: 10.5, y: 10.5 }, { x: 30.2, y: 19.7 }, true, true)
check('pixel angle: toward 2:1, ten whole steps', snapped.x === 30.5 && snapped.y === 20.5, JSON.stringify(snapped))
const snapped3 = straightLineEnd({ x: 0, y: 0 }, { x: -2.2, y: 6.9 }, true, true)
check('pixel angle: 1:3 going left and down', snapped3.x === -2 && snapped3.y === 6, JSON.stringify(snapped3))
const free = straightLineEnd({ x: 0, y: 0 }, { x: 7, y: 3 }, false, true)
check('without Ctrl: where the pointer is', free.x === 7 && free.y === 3)
const smooth = straightLineEnd({ x: 0, y: 0 }, { x: 100, y: 52 }, true, false)
const smoothAngle = (Math.atan2(smooth.y, smooth.x) * 180) / Math.PI
check(
  'smooth angle: 27° goes to 30°',
  Math.abs(smoothAngle - 30) < 1e-9 &&
    Math.abs(Math.hypot(smooth.x, smooth.y) - (100 * Math.cos(Math.PI / 6) + 52 * Math.sin(Math.PI / 6))) < 1e-9,
  smoothAngle.toFixed(3),
)

// ----- In the app -----
await newDrawing(300, 200)
await chooseBrush('Pixel')
await sleep(300)
await setSize(1)
await sleep(100)
await clickAt(150.5, 150.5, 'Shift')
check('Shift + click before any stroke: a dot, as a click', (await paintedIn(140, 140, 20, 20)).length === 1)
await clickAt(10.5, 10.5)
// The line shown while Shift is held: from the dot's pixel to the pointer
await page.keyboard.down('Shift')
const pointerAt = await pageOf(60.5, 40.5)
await page.mouse.move(pointerAt.x, pointerAt.y)
await frames()
await frames()
const outlineBox = () =>
  page.evaluate(() => {
    const g = window.lydia.app.stage.children.at(-1)
    const b = g.getBounds()
    return { visible: g.visible, w: b.width, h: b.height }
  })
const preview = await outlineBox()
const from = await pageOf(10.5, 10.5)
check(
  'with Shift held, the line shows from the last stroke to the pointer',
  preview.visible && preview.w > (pointerAt.x - from.x) * 0.9,
  JSON.stringify(preview),
)
await page.keyboard.up('Shift')
await frames()
await frames()
const hidden = await outlineBox()
check('without Shift, only the outline again', hidden.w < 30, JSON.stringify(hidden))

// Shift + Ctrl + click near 2:1: a line of equal steps of 2
await clickAt(40.2, 25.3, 'Shift', 'Control')
const line21 = await paintedIn(5, 5, 45, 30)
const rows = new Map()
for (const [, y] of line21) rows.set(y, (rows.get(y) ?? 0) + 1)
const inner = [...rows.entries()].filter(([y]) => y > 10 && y < 25)
check(
  'Ctrl near 2:1: from (10, 10) to (40, 25), 31 pixels',
  line21.length === 31 && line21.some(([x, y]) => x === 40 && y === 25),
  `${line21.length}`,
)
check(
  '…two in every row between, one per column',
  inner.every(([, n]) => n === 2) && new Set(line21.map(([x]) => x)).size === 31,
)
// Chained, without Ctrl: from (40, 25) to wherever the pointer is; one per column
await clickAt(80.5, 33.5, 'Shift')
const second = await paintedIn(41, 20, 45, 20)
check(
  'chained from the end of the last line, one pixel in each column',
  second.length >= 39 && second.length <= 41 && new Set(second.map(([x]) => x)).size === second.length,
  `${second.length}`,
)
// Undo takes away only the last line
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await sleep(200)
check(
  'undo: only the last line goes',
  (await paintedIn(41, 20, 45, 20)).length === 0 && (await paintedIn(5, 5, 45, 30)).length === 31,
)

// A smooth brush, Shift + Ctrl at about 27°: on the 30° line
await chooseBrush('Hard round')
await sleep(300)
await setSize(5)
await sleep(100)
await clickAt(100.5, 100.5)
await clickAt(200.5, 152.5, 'Shift', 'Control')
const along = 100 * Math.cos(Math.PI / 6) + 52 * Math.sin(Math.PI / 6)
const mid = { x: 100.5 + (Math.cos(Math.PI / 6) * along) / 2, y: 100.5 + (Math.sin(Math.PI / 6) * along) / 2 }
const onLine = await page.evaluate(({ x, y }) => window.lydia.projection.colorAt(Math.floor(x), Math.floor(y)), mid)
const offLine = await page.evaluate(
  ({ x, y }) => window.lydia.projection.colorAt(Math.floor(x), Math.floor(y + 6)),
  mid,
)
check(
  'smooth brush with Ctrl: painted along 30°, not beside it',
  onLine === '#000000' && offLine === '#ffffff',
  `${onLine} ${offLine}`,
)

// The eraser: a line taken out of the 2:1 line, across it
await page.keyboard.press('e')
await sleep(100)
await clickAt(25.5, 5.5)
await clickAt(25.5, 30.5, 'Shift')
check(
  'the eraser erases along a straight line',
  (await paintedIn(24, 5, 3, 30)).length === 0 && (await paintedIn(5, 5, 45, 30)).length > 20,
)

await page.screenshot({ path: OUT + '/lines.png' })
check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
