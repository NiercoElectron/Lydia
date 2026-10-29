// The pixel grid: where its lines are on the screen (one pixel of the display wide), their colors on white, black,
// the two middle grays, red and the squares of a transparent background, from 800% only, G and the Grid button,
// remembered after a reload, a display at 150%, the Brush Designer, and what it costs per frame
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
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]) // the gray around the paper is the light one
const problems = []
page.on('pageerror', e => problems.push('PAGE ERROR ' + e))
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warn') problems.push(m.type() + ': ' + m.text())
})
await page.setViewport({ width: 1400, height: 900 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
const click = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).click(), text)

async function newDrawing(width, height, transparent = false) {
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
  if (isTransparent !== transparent)
    await page.evaluate(() =>
      [...document.querySelectorAll('dialog button')].find(b => b.textContent === 'Transparent').click(),
    )
  await page.click('button[type=submit]')
  await page.waitForFunction(
    () => window.lydia?.engine && window.lydia.app.renderer && document.querySelectorAll('button.brush').length > 0,
    { timeout: 90000 },
  )
  await sleep(400)
}
async function back() {
  await page.evaluate(() => {
    window.confirm = () => true
  })
  await click('Back')
  await sleep(300)
}
async function choose(name) {
  await page.evaluate(
    name =>
      [...document.querySelectorAll('button.brush')]
        .find(b => b.querySelector('.brush-name').textContent === name)
        .click(),
    name,
  )
  await sleep(250)
}
// Paint the whole paper one color (a Hard round dab far bigger than the paper)
const fill = color =>
  page.evaluate(color => {
    const { brush, engine } = window.lydia
    engine.setBrush({ color, size: 500, tool: 'brush' })
    brush.startStroke(100, 50, 1)
    brush.endStroke()
  }, color)
const setView = (zoom, x, y) =>
  page.evaluate(
    (zoom, x, y) => {
      const { world, projection } = window.lydia
      world.scale.set(zoom)
      projection.setZoom(zoom)
      world.position.set(x, y)
    },
    zoom,
    x,
    y,
  )
// Draw a frame now and read pixels of the display: a row from x0 to x1 at y, or a column from y0 to y1 at x
const readScreen = (x, y, width, height) =>
  page.evaluate(
    (x, y, width, height) => {
      const { app, pixelGrid } = window.lydia
      pixelGrid.update()
      app.render()
      const gl = app.renderer.gl
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      const out = new Uint8Array(width * height * 4)
      gl.readPixels(x, gl.drawingBufferHeight - y - height, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out)
      const pixels = []
      for (let i = 0; i < width * height; i++) pixels.push([out[i * 4], out[i * 4 + 1], out[i * 4 + 2]])
      return height === 1 ? pixels : pixels.reverse() // a column comes bottom to top
    },
    x,
    y,
    width,
    height,
  )
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2)
const isShown = () =>
  page.evaluate(() => {
    window.lydia.pixelGrid.update()
    return window.lydia.pixelGrid.isShown()
  })

// Which pixels of a row (or column) of the display are lines: lines between pixels of the paper are at
// origin + k × zoom on the screen, inside the paper only
function expectedLines(origin, zoom, resolution, from, count, paperSize) {
  const lines = new Set()
  for (let k = 1; k < paperSize; k++) lines.add(Math.floor((origin + k * zoom) * resolution))
  return Array.from({ length: count }, (_, i) => lines.has(from + i))
}

await page.goto('http://localhost:5198/', { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('lydia')
})
await page.reload({ waitUntil: 'networkidle0' })
await newDrawing(200, 100)
await choose('Hard round')

// ----- When it shows -----
const fitZoom = await page.evaluate(() => window.lydia.world.scale.x)
check(
  'the button is on at first',
  await page.$eval(
    '.toolbar button[title*="Pixel grid"]',
    b => b.getAttribute('aria-pressed') === 'true' && b.textContent === 'Grid',
  ),
)
check(`no grid at the zoom that shows the whole paper (${Math.round(fitZoom * 100)}%)`, !(await isShown()))
await setView(7.9, 50.3, 40.7)
check('no grid at 790%', !(await isShown()))
await setView(8, 50.3, 40.7)
check('the grid at 800%', await isShown())

// ----- Where the lines are, and their colors -----
const ZOOM = 10,
  X = 50.3,
  Y = 40.7
await setView(ZOOM, X, Y)
const rowY = Math.floor(Y + 50.5 * ZOOM) // the middle of a row of pixels of the paper, away from the lines across
const columnX = Math.floor(X + 30.5 * ZOOM)
const width = 600
const wantRow = expectedLines(X, ZOOM, 1, 60, width, 200)
const wantColumn = expectedLines(Y, ZOOM, 1, 60, 500, 100)
const colors = [
  ['white paper', null, [255, 255, 255], [191, 191, 191]],
  ['black', '#000000', [0, 0, 0], [64, 64, 64]],
  ['middle gray (128)', '#808080', [128, 128, 128], [64, 64, 64]],
  ['middle gray (127)', '#7f7f7f', [127, 127, 127], [191, 191, 191]],
  ['red', '#ff0000', [255, 0, 0], [191, 64, 64]],
]
for (const [name, color, under, line] of colors) {
  if (color) await fill(color)
  const row = await readScreen(60, rowY, width, 1)
  const column = await readScreen(columnX, 60, 1, 500)
  const rowOk = row.every((p, i) => near(p, wantRow[i] ? line : under))
  const columnOk = column.every((p, i) => near(p, wantColumn[i] ? line : under))
  const bad = row.findIndex((p, i) => !near(p, wantRow[i] ? line : under))
  check(
    `on ${name}: lines of ${line.join(',')} exactly between the pixels, one pixel of the display wide, down and across`,
    rowOk && columnOk,
    bad >= 0 ? `column ${60 + bad}: ${row[bad]} (line expected: ${wantRow[bad]})` : '',
  )
}
// One black pixel near the top of the red paper: on the screen where it belongs, not upside down
await choose('Pixel')
await page.evaluate(() => {
  const { brush, engine } = window.lydia
  engine.setBrush({ color: '#000000', size: 1 })
  brush.startStroke(40.5, 10.5, 1)
  brush.endStroke()
})
const dotColumn = await readScreen(Math.floor(X + 40.5 * ZOOM), Math.floor(Y + 8.5 * ZOOM), 1, 41) // paper rows 8.5 to 12.5
check(
  'a pixel painted near the top shows there on the screen, the right way up',
  near(dotColumn[0], [255, 0, 0]) && near(dotColumn[20], [0, 0, 0]) && near(dotColumn[40], [255, 0, 0]),
  `${dotColumn[0]} / ${dotColumn[20]} / ${dotColumn[40]}`,
)
await choose('Hard round')
const outside = await readScreen(20, rowY, 20, 1)
check(
  'nothing is drawn outside the paper',
  outside.every(p => near(p, [128, 128, 128])),
  String(outside[0]),
)

// ----- Off and on: G, the button, remembered -----
await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('KeyG')
await sleep(100)
const rowOff = await readScreen(60, rowY, width, 1)
check(
  'G turns it off: no lines, and the button shows it',
  !(await isShown()) &&
    rowOff.every(p => near(p, [255, 0, 0])) &&
    (await page.$eval('.toolbar button[title*="Pixel grid"]', b => b.getAttribute('aria-pressed'))) === 'false',
)
await back()
await page.reload({ waitUntil: 'networkidle0' })
await newDrawing(200, 100)
await setView(ZOOM, X, Y)
check('it stays off after a reload', !(await isShown()))
await click('Grid')
await sleep(100)
check('the Grid button turns it on again', await isShown())

// ----- A transparent background: lines over the squares -----
await back()
await newDrawing(200, 100, true)
await setView(ZOOM, X, Y)
const checkerRow = await readScreen(60, rowY, width, 1)
const overSquares = checkerRow.every((p, i) =>
  wantRow[i]
    ? near(p, [191, 191, 191]) || near(p, [140, 140, 140])
    : near(p, [255, 255, 255]) || near(p, [204, 204, 204]),
)
check('on a transparent background, the lines show on both kinds of squares (191 on white, 140 on gray)', overSquares)

// ----- What it looks like -----
await back()
await newDrawing(24, 16)
await choose('Pixel')
const art = [
  ['#000000', 4, 4],
  ['#808080', 10, 4],
  ['#ff0000', 16, 4],
  ['#2050ff', 4, 10],
  ['#ffd000', 10, 10],
  ['#7f7f7f', 16, 10],
]
for (const [color, x, y] of art)
  await page.evaluate(
    (color, x, y) => {
      const { brush, engine } = window.lydia
      engine.setBrush({ color, size: 5, tool: 'brush' })
      brush.startStroke(x + 0.5, y + 0.5, 1)
      brush.endStroke()
    },
    color,
    x,
    y,
  )
await setView(36, 20, 40)
await sleep(300)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/pixel-grid.png' })

// ----- What it costs: frames of a 10000×10000 drawing at 800%, with and without the grid -----
await back()
await newDrawing(10000, 10000)
await choose('Hard round')
await page.evaluate(() => {
  const { brush, engine } = window.lydia
  engine.setBrush({ color: '#3060c0', size: 500 })
  brush.startStroke(5000, 5000, 1)
  brush.endStroke()
})
await setView(8, -39000, -39000)
const frameTimes = await page.evaluate(() => {
  const { app, pixelGrid, engine } = window.lydia
  const gl = app.renderer.gl
  const time = () => {
    const t = performance.now()
    for (let i = 0; i < 50; i++) {
      pixelGrid.update()
      app.render()
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    return (performance.now() - t) / 50
  }
  time() // warm up
  const on = time()
  engine.setPixelGrid(false)
  const off = time()
  engine.setPixelGrid(true)
  return { on: on.toFixed(2), off: off.toFixed(2) }
})
console.log(`   a frame at 800% on 10000×10000: ${frameTimes.on} ms with the grid, ${frameTimes.off} ms without`)

// ----- A display at 150%: still one pixel of the display -----
await back()
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1.5 })
await page.reload({ waitUntil: 'networkidle0' })
await newDrawing(200, 100)
await choose('Hard round')
await fill('#000000')
await setView(ZOOM, X, Y)
const res = await page.evaluate(() => window.lydia.app.renderer.resolution)
const hiRowY = Math.floor((Y + 50.5 * ZOOM) * res)
const hiRow = await readScreen(100, hiRowY, 900, 1)
const wantHi = expectedLines(X, ZOOM, res, 100, 900, 200)
const hiOk = hiRow.every((p, i) => near(p, wantHi[i] ? [64, 64, 64] : [0, 0, 0]))
check(
  `at ${res * 100}% display scale, each line is one pixel of the display, in the right place`,
  res === 1.5 && hiOk && wantHi.filter(Boolean).length > 50,
)

// ----- The Brush Designer has it too -----
await back()
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 })
await page.reload({ waitUntil: 'networkidle0' })
await click('Open Brush Designer')
await page.waitForFunction(() => window.lydia?.engine && window.lydia.app.renderer, { timeout: 90000 })
await sleep(400)
await setView(12, 30, 30)
check(
  'the Brush Designer has the Grid button, and the grid',
  (await page.$$eval('button', bs => bs.some(b => b.textContent === 'Grid'))) && (await isShown()),
)

console.log(problems.length ? 'problems:\n' + problems.slice(0, 8).join('\n') : 'no errors or warnings in the console')
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
