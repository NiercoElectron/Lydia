// Selections: the rectangle and lasso tools, their keys and bar; a click selecting nothing; the marching ants on the
// screen; soft and hard edges; adding and taking away; the brush, the eraser and the fill bucket only inside; Delete;
// select all, deselect, invert; undoing selection changes; a rectangle on a turned view; and a big lasso on 10000²
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
async function drag(points) {
  const first = await pageOf(...points[0])
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  for (const [x, y] of points.slice(1)) {
    const p = await pageOf(x, y)
    await page.mouse.move(p.x, p.y, { steps: 4 })
  }
  await page.mouse.up()
  await sleep(50)
}
const clickPaper = async (x, y) => {
  const p = await pageOf(x, y)
  await page.mouse.click(p.x, p.y)
}
// How much a pixel is selected (0–255), or null when nothing is selected
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
const edgeValues = () =>
  page.evaluate(() => {
    const values = new Set()
    for (const tile of window.lydia.engine.getSelection()?.values() ?? [])
      if (tile !== 'full') for (const v of tile) values.add(v)
    return [...values]
  })
const shownAt = (x, y) => page.evaluate((x, y) => window.lydia.projection.colorAt(x, y), x, y)
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
// Hard round strokes straight through the engine
const stroke = (points, color, size, tool = 'brush') =>
  page.evaluate(
    async (points, color, size, tool) => {
      const library = await import('/src/brushLibrary.ts')
      const brush = library.builtInBrush('hard-round')
      const { engine } = window.lydia
      engine.setBrushTip(await library.tipOf(brush), brush.preset)
      engine.setBrush({ size, color, tool, opacity: 1 })
      window.lydia.brush.startStroke(points[0][0], points[0][1], 1)
      window.lydia.brush.continueStroke(points.slice(1).map(([x, y]) => ({ x, y, pressure: 1 })))
      window.lydia.brush.endStroke()
    },
    points,
    color,
    size,
    tool,
  )

await newDrawing(1500, 1000)

// ----- The tools and the bar -----
const labels = await page.$$eval('.tool-column button', bs => bs.map(b => b.getAttribute('aria-label')))
check(
  'the column has Rectangle select and Lasso',
  labels.includes('Rectangle select') && labels.includes('Lasso'),
  labels.join(),
)
await page.keyboard.press('s')
await sleep(50)
check(
  'S chooses Rectangle select',
  (await page.$eval('.tool-column button[aria-pressed=true]', b => b.getAttribute('aria-label'))) ===
    'Rectangle select',
)
let bar = await page.$eval('.toolbar', t => t.textContent)
check(
  'the bar shows Edges, Select all, Deselect and Invert, and no Size or Opacity',
  bar.includes('EdgesSoftHard') &&
    bar.includes('Select all') &&
    bar.includes('Deselect') &&
    bar.includes('Invert') &&
    !bar.includes('Size') &&
    !bar.includes('Opacity'),
  bar,
)
check(
  'Deselect is off with nothing selected',
  await page.$$eval('.toolbar button', bs => bs.find(b => b.textContent === 'Deselect').disabled),
)
await page.keyboard.press('l')
await sleep(50)
check(
  'L chooses Lasso',
  (await page.$eval('.tool-column button[aria-pressed=true]', b => b.getAttribute('aria-label'))) === 'Lasso',
)

// ----- A rectangle -----
await page.keyboard.press('s')
await drag([
  [200.3, 200.3],
  [600.6, 500.6],
])
check(
  'dragging selects a rectangle',
  (await selectedAt(400, 350)) === 255 && (await selectedAt(100, 100)) === 0 && (await selectedAt(700, 350)) === 0,
  String(await selectedAt(400, 350)),
)
const soft = await edgeValues()
check(
  'soft edges: pixels on the edge are selected in part',
  soft.some(v => v > 0 && v < 255),
  `${soft.length} values`,
)
check(
  'Deselect is on with a selection',
  await page.$$eval('.toolbar button', bs => !bs.find(b => b.textContent === 'Deselect').disabled),
)
// The ants: black and white dashes along the edge on the screen
const ants = await page.evaluate(async () => {
  const { app, world } = window.lydia
  await new Promise(r => requestAnimationFrame(r))
  app.render()
  const gl = app.renderer.gl
  const edge = world.toGlobal({ x: 400, y: 200.3 })
  const inside = world.toGlobal({ x: 400, y: 350 })
  const read = (p, n) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const out = new Uint8Array(4 * n * 5)
    gl.readPixels(
      Math.floor(p.x - n / 2),
      gl.drawingBufferHeight - Math.floor(p.y) - 3,
      n,
      5,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      out,
    )
    let black = 0
    for (let i = 0; i < out.length; i += 4) if (out[i] < 20 && out[i + 1] < 20 && out[i + 2] < 20) black++
    return black
  }
  return { edge: read(edge, 40), inside: read(inside, 40) }
})
check('marching ants show along the edge, not inside', ants.edge >= 10 && ants.inside === 0, JSON.stringify(ants))
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/selection-rect.png' })
await clickPaper(1000, 800)
check('a click with the rectangle tool selects nothing', (await selectedAt(400, 350)) === null)
await keys('Control', 'z')
check('Ctrl+Z brings the selection back', (await selectedAt(400, 350)) === 255)

// ----- Hard edges -----
await click('Hard')
await drag([
  [200.3, 200.3],
  [600.6, 500.6],
])
const hard = await edgeValues()
check(
  'hard edges: every pixel is selected whole or not at all',
  hard.every(v => v === 0 || v === 255),
  JSON.stringify(hard.slice(0, 6)),
)
await click('Soft')

// ----- Adding and taking away -----
await drag([
  [200, 200],
  [600, 500],
])
await page.keyboard.down('Shift')
await drag([
  [500, 400],
  [900, 700],
])
await page.keyboard.up('Shift')
check(
  'Shift + drag adds',
  (await selectedAt(300, 300)) === 255 && (await selectedAt(800, 650)) === 255 && (await selectedAt(800, 300)) === 0,
)
await page.keyboard.down('Alt')
await drag([
  [300, 300],
  [400, 400],
])
await page.keyboard.up('Alt')
check('Alt + drag takes away', (await selectedAt(350, 350)) === 0 && (await selectedAt(250, 250)) === 255)

// ----- The lasso -----
await page.keyboard.press('l')
await drag([
  [1000, 200],
  [1300, 200],
  [1150, 450],
  [1000, 200],
])
check(
  'the lasso selects inside its outline',
  (await selectedAt(1150, 280)) === 255 && (await selectedAt(1020, 420)) === 0 && (await selectedAt(300, 300)) === 0,
  String(await selectedAt(1150, 280)),
)

// ----- Painting only inside -----
await page.keyboard.press('s')
await drag([
  [200, 200],
  [600, 500],
])
await stroke(
  [
    [50, 350],
    [1450, 350],
  ],
  '#000000',
  40,
)
check(
  'the brush paints only inside the selection',
  (await shownAt(400, 350)) === '#000000' &&
    (await shownAt(100, 350)) === '#ffffff' &&
    (await shownAt(800, 350)) === '#ffffff',
  `${await shownAt(400, 350)} ${await shownAt(100, 350)}`,
)
await keys('Control', 'a')
check('Ctrl+A selects everything', (await selectedAt(1, 1)) === 255 && (await selectedAt(1499, 999)) === 255)
await stroke(
  [
    [50, 600],
    [1450, 600],
  ],
  '#000000',
  40,
)
check(
  'with everything selected, the brush paints everywhere',
  (await shownAt(100, 600)) === '#000000' && (await shownAt(1400, 600)) === '#000000',
)
await keys('Control', 'd')
check('Ctrl+D selects nothing', (await selectedAt(400, 350)) === null)
await page.keyboard.press('s')
await drag([
  [200, 200],
  [600, 500],
])
await stroke(
  [
    [50, 600],
    [1450, 600],
  ],
  '#ffffff',
  60,
  'eraser',
)
check('the eraser erases only inside the selection (none here)', (await shownAt(100, 600)) === '#000000')
await stroke(
  [
    [50, 450],
    [1450, 450],
  ],
  '#ffffff',
  40,
  'eraser',
)
await stroke(
  [
    [50, 700],
    [1450, 700],
  ],
  '#000000',
  40,
)
check('…and nothing outside it', (await shownAt(100, 700)) === '#ffffff')

// ----- The fill bucket only inside -----
await page.keyboard.press('f')
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#e04020', opacity: 1 }))
await clickPaper(300, 250)
await waitIdle()
check(
  'the fill bucket fills only inside the selection',
  (await shownAt(300, 250)) === '#e04020' &&
    (await shownAt(100, 100)) === '#ffffff' &&
    (await shownAt(700, 250)) === '#ffffff',
  `${await shownAt(300, 250)} ${await shownAt(100, 100)}`,
)

// ----- Delete -----
await page.keyboard.press('Delete')
await waitIdle()
check(
  'Delete takes the paint out of the selection',
  (await shownAt(300, 250)) === '#ffffff' &&
    (await shownAt(400, 350)) === '#ffffff' &&
    (await shownAt(1400, 600)) === '#000000',
  `${await shownAt(300, 250)} ${await shownAt(1400, 600)}`,
)
await keys('Control', 'z')
await waitIdle()
check('Delete can be undone', (await shownAt(300, 250)) === '#e04020')

// ----- Invert -----
await page.keyboard.press('s')
await sleep(50)
await click('Invert')
check("Invert selects what wasn't selected", (await selectedAt(400, 350)) === 0 && (await selectedAt(100, 100)) === 255)
await keys('Control', 'z')
check('…and can be undone', (await selectedAt(400, 350)) === 255 && (await selectedAt(100, 100)) === 0)

// ----- A rectangle on a turned view stays along the sides of the paper -----
await page.keyboard.press('r')
const c = await page.evaluate(() => {
  const b = window.lydia.app.canvas.getBoundingClientRect()
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
})
await page.mouse.move(c.x + 200, c.y)
await page.mouse.down()
for (let i = 1; i <= 10; i++) {
  const a = (((30 * i) / 10) * Math.PI) / 180
  await page.mouse.move(c.x + 200 * Math.cos(a), c.y + 200 * Math.sin(a))
}
await page.mouse.up()
await page.keyboard.press('s')
await drag([
  [300, 300],
  [700, 600],
])
check(
  'on a turned view, the rectangle follows the sides of the paper',
  (await selectedAt(310, 590)) === 255 && (await selectedAt(690, 310)) === 255 && (await selectedAt(250, 450)) === 0,
)
await click('Straighten')

// ----- 10000×10000 -----
await page.evaluate(() => {
  window.confirm = () => true
})
await click('Back')
await sleep(300)
await newDrawing(10000, 10000)
const big = await page.evaluate(async () => {
  const selection = await import('/src/engine/selection.ts')
  const grid = { width: 10000, height: 10000, columns: 40, rows: 40 }
  const points = Array.from({ length: 2000 }, (_, i) => ({
    x: 5000 + 4900 * Math.cos((i * Math.PI) / 1000),
    y: 5000 + 4900 * Math.sin((i * Math.PI) / 1000),
  }))
  let t = performance.now()
  const tiles = selection.polygonTiles(grid, points, false)
  const ms = performance.now() - t
  let full = 0
  for (const tile of tiles.values()) if (tile === 'full') full++
  return { ms, tiles: tiles.size, full }
})
check(
  'a lasso round the whole of 10000×10000 is worked out quickly',
  big.ms < 400,
  `${big.ms.toFixed(0)} ms, ${big.tiles} tiles (${big.full} whole)`,
)
await keys('Control', 'a')
const frame = await page.evaluate(async () => {
  const { app, world, projection } = window.lydia
  const time = () => {
    const t = performance.now()
    for (let i = 0; i < 20; i++) {
      world.position.x += 1
      window.lydia.selectionView.update()
      app.render()
    }
    app.renderer.gl.readPixels(0, 0, 1, 1, app.renderer.gl.RGBA, app.renderer.gl.UNSIGNED_BYTE, new Uint8Array(4))
    return (performance.now() - t) / 20
  }
  return { everything: time() }
})
check(
  'with everything selected on 10000×10000, a frame while moving the view stays short',
  frame.everything < 10,
  `${frame.everything.toFixed(1)} ms`,
)

console.log(problems.length ? 'problems:\n' + problems.slice(0, 8).join('\n') : 'no errors or warnings in the console')
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
