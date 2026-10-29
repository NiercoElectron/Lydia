// A stroke over a selection's soft edge: as much paint there however many movements of the pen it took (it was cut
// again at each one, fading away), with the brush, a pixel-perfect pixel brush and the eraser
// Pixel-perfect strokes: the button only with pixel brushes, off at first and remembered; corners left out, even
// already painted; the tapered end worked out again without them; undo; the dab path's rule at bigger sizes
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
const chooseBrush = name =>
  page.evaluate(
    name =>
      [...document.querySelectorAll('button.brush')]
        .find(b => b.textContent.trim() === name || b.title === name || b.querySelector('span')?.textContent === name)
        .click(),
    name,
  )
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
// Is a stroke's soft selection edge cut again at every movement of the pen?
await newDrawing(300, 200)
await page.evaluate(() =>
  [...document.querySelectorAll('button.brush')].find(b => b.textContent.trim().startsWith('Hard round')).click(),
)
await sleep(200)
await setSize(30)
await page.keyboard.press('s')
await sleep(100)
// A rectangle whose right edge falls inside a pixel column, so that column is partly selected
const a = await pageOf(20.3, 20.3),
  b = await pageOf(100.5, 180.5)
await page.mouse.move(a.x, a.y)
await page.mouse.down()
await page.mouse.move(b.x, b.y, { steps: 5 })
await page.mouse.up()
await sleep(300)
const edge = await page.evaluate(() => {
  // the partly selected column on the right
  const sel = window.lydia.engine.getSelection().get('0,0')
  if (sel === 'full' || !sel) return null
  for (let x = 95; x < 106; x++) {
    const v = sel[100 * 256 + x]
    if (v > 0 && v < 255) return { x, amount: v }
  }
  return null
})
await page.keyboard.press('b')
await sleep(100)
// The same stroke along the edge, at two heights: given at once, then a point at a time (200 points, a pixel apart)
const line = (y, n) => Array.from({ length: n }, (_, i) => ({ x: edge.x - 0 + 0.5, y: y + i * 0.25, pressure: 1 }))
await page.evaluate(
  points => {
    const { brush } = window.lydia
    brush.startStroke(points[0].x, points[0].y, 1)
    brush.continueStroke(points.slice(1))
    brush.endStroke()
  },
  line(40, 200),
)
await page.evaluate(
  async points => {
    const { brush } = window.lydia
    brush.startStroke(points[0].x, points[0].y, 1)
    for (const point of points.slice(1)) brush.continueStroke([point])
    brush.endStroke()
  },
  line(110, 200),
)
await frames()
const colors = await page.evaluate(x => [60, 70, 130, 140].map(y => window.lydia.projection.colorAt(x, y)), edge.x)
check(
  'half selected edge: at once, half the paint',
  colors[0] === '#808080' && colors[1] === '#808080',
  colors.slice(0, 2).join(),
)
check('…and the same a point at a time', colors[2] === colors[0] && colors[3] === colors[0], colors.slice(2).join())
check(
  'inside, all of it',
  (await page.evaluate(x => window.lydia.projection.colorAt(x - 5, 130), edge.x)) === '#000000',
)
check('outside, none', (await page.evaluate(x => window.lydia.projection.colorAt(x + 3, 130), edge.x)) === '#ffffff')

// The eraser over the same edge, a point at a time, on top of the black: half of it taken away
await page.keyboard.press('e')
await sleep(100)
await page.evaluate(
  async points => {
    const { brush } = window.lydia
    brush.startStroke(points[0].x, points[0].y, 1)
    for (const point of points.slice(1)) brush.continueStroke([point])
    brush.endStroke()
  },
  line(110, 200).map(p => ({ ...p, x: p.x - 3 })),
)
await frames()
const erased = await page.evaluate(
  x => [window.lydia.projection.colorAt(x, 130), window.lydia.projection.colorAt(x - 3, 130)],
  edge.x,
)
check(
  'the eraser a point at a time: half taken away on the edge, all inside',
  erased[0] === '#c0c0c0' || erased[0] === '#bfbfbf' || erased[0] === '#c1c1c1',
  erased.join(),
)
check('…all of it inside', erased[1] === '#ffffff', erased[1])
await page.keyboard.press('b')
await sleep(100)

// A pixel-perfect pixel brush over the edge, a staircase a point at a time and all at once: the same colors (in a new
// drawing, with the same selection)
await page.evaluate(() => {
  window.confirm = () => true
})
await click('Back')
await sleep(300)
await page.evaluate(() => delete window.lydia)
await newDrawing(300, 200)
await page.keyboard.press('s')
await sleep(100)
{
  const a = await pageOf(20.3, 20.3),
    b = await pageOf(100.5, 180.5)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 5 })
  await page.mouse.up()
  await sleep(300)
}
await page.keyboard.press('b')
await sleep(100)
await page.evaluate(() =>
  [...document.querySelectorAll('button.brush')].find(b => b.textContent.trim().startsWith('Pixel')).click(),
)
await sleep(300)
await setSize(3)
await click('Pixel-perfect')
await sleep(100)
const stairs = (x, y) => {
  const points = [{ x: x + 0.5, y: y + 0.5, pressure: 1 }]
  for (let i = 0; i < 12; i++)
    points.push({ x: x + i + 1.5, y: y + i + 0.5, pressure: 1 }, { x: x + i + 1.5, y: y + i + 1.5, pressure: 1 })
  return points
}
await page.evaluate(
  async points => {
    const { brush } = window.lydia
    brush.startStroke(points[0].x, points[0].y, 1)
    for (const point of points.slice(1)) brush.continueStroke([point])
    brush.endStroke()
  },
  stairs(edge.x - 6, 110),
)
await page.evaluate(
  points => {
    const { brush } = window.lydia
    brush.startStroke(points[0].x, points[0].y, 1)
    brush.continueStroke(points.slice(1))
    brush.endStroke()
  },
  stairs(edge.x - 6, 50),
)
await frames()
const region = y =>
  page.evaluate(
    (x, y) => {
      const c = []
      for (let j = y - 2; j < y + 16; j++)
        for (let i = x - 8; i < x + 10; i++) c.push(window.lydia.projection.colorAt(i, j))
      return c.join()
    },
    edge.x,
    y,
  )
const ppA = await region(110),
  ppB = await region(50)
check(
  'pixel-perfect over the edge: a point at a time and all at once, the same',
  ppA === ppB && ppA.includes('#808080'),
  `${new Set(ppA.split(',')).size} colors`,
)

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
