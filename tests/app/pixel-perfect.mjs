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

// ----- The rule itself, on the dab path -----
const { createDabPath, withoutCorners, isCorner } = await server.ssrLoadModule('/src/engine/dabs.ts')
const pixelShape = {
  pixel: 'round',
  spacing: 0.01,
  flow: 1,
  pressureSize: false,
  pressureFlow: false,
  angle: 0,
  angleJitter: 0,
  scatter: 0,
  followStroke: false,
  noisePerStroke: false,
}
function pathDabs(size, points) {
  const path = createDabPath(pixelShape, size, { seed: 1 })
  return [...path.start(points[0]), ...path.moveTo(points.slice(1)), ...path.end()]
}
// A line drawn by hand at about 45°, a little wobbly, so it turns between going mostly across and mostly down
const wobbly = []
for (let i = 0; i <= 200; i++)
  wobbly.push({ x: 10.3 + i * 0.5 + Math.sin(i / 2) * 0.6, y: 10.6 + i * 0.5, pressure: 1 })
for (const size of [1, 3, 4]) {
  const raw = pathDabs(size, wobbly)
  const kept = withoutCorners(raw)
  let corners = 0,
    broken = 0
  for (let i = 2; i < kept.length; i++) if (isCorner(kept[i - 2], kept[i - 1], kept[i])) corners++
  for (let i = 1; i < kept.length; i++)
    if (Math.max(Math.abs(kept[i].x - kept[i - 1].x), Math.abs(kept[i].y - kept[i - 1].y)) > 1) broken++
  let rawCorners = 0
  for (let i = 2; i < raw.length; i++) if (isCorner(raw[i - 2], raw[i - 1], raw[i])) rawCorners++
  check(
    `size ${size}: ${rawCorners} corners taken out of ${raw.length} dabs, none left, no gap`,
    rawCorners > 0 && corners === 0 && broken === 0,
    `${corners} left, ${broken} gaps`,
  )
  check(`size ${size}: the first and last dabs kept`, kept[0] === raw[0] && kept.at(-1) === raw.at(-1))
}
const straight = pathDabs(1, [
  { x: 5.5, y: 5.5, pressure: 1 },
  { x: 40.5, y: 5.5, pressure: 1 },
])
check(
  'a straight line keeps every pixel',
  withoutCorners(straight).length === straight.length && straight.length === 36,
  String(straight.length),
)
const back = [
  { x: 1.5, y: 1.5, size: 1 },
  { x: 2.5, y: 1.5, size: 1 },
  { x: 1.5, y: 1.5, size: 1 },
]
check('going back the same way is no corner', !isCorner(...back))
const sizes = [
  { x: 1.5, y: 1.5, size: 1 },
  { x: 2.5, y: 1.5, size: 1 },
  { x: 2.5, y: 2.5, size: 2 },
]
check('where the size changes, no corner', !isCorner(...sizes))

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
// The painted pixels in this part of the paper, as "x,y"
const paintedIn = (x, y, w, h) =>
  page.evaluate(
    (x, y, w, h) => {
      const painted = []
      for (let j = y; j < y + h; j++)
        for (let i = x; i < x + w; i++)
          if (window.lydia.projection.colorAt(i, j) !== '#ffffff') painted.push(`${i},${j}`)
      return painted
    },
    x,
    y,
    w,
    h,
  )
// Doubled corners in a line of one pixel: squares of 2×2 pixels with 3 or 4 of them painted
function doubledCorners(painted) {
  const set = new Set(painted)
  let count = 0
  for (const p of painted) {
    const [x, y] = p.split(',').map(Number)
    const square = [
      [x, y],
      [x + 1, y],
      [x, y + 1],
      [x + 1, y + 1],
    ].filter(([i, j]) => set.has(`${i},${j}`)).length
    if (square >= 3) count++
  }
  return count
}
// A staircase drawn with the mouse: a pixel across, then a pixel down, "steps" times. "during" sees the pixels after
// each movement, while the stroke goes on
async function staircase(x, y, steps, during) {
  await moveTo(x + 0.5, y + 0.5)
  await page.mouse.down()
  await frames()
  for (let i = 0; i < steps; i++) {
    await moveTo(x + i + 1.5, y + i + 0.5)
    if (during) await during()
    await moveTo(x + i + 1.5, y + i + 1.5)
    if (during) await during()
  }
  await page.mouse.up()
  await sleep(150)
}
// The same, given to the brush directly, at exact places of the paper, one point at a time
const staircasePoints = (x, y, steps) => {
  const points = [{ x: x + 0.5, y: y + 0.5, pressure: 1 }]
  for (let i = 0; i < steps; i++)
    points.push({ x: x + i + 1.5, y: y + i + 0.5, pressure: 1 }, { x: x + i + 1.5, y: y + i + 1.5, pressure: 1 })
  return points
}
const strokeDirectly = points =>
  page.evaluate(async points => {
    const { brush, engine } = window.lydia
    brush.startStroke(points[0].x, points[0].y, 1)
    for (const point of points.slice(1)) {
      brush.continueStroke([point])
      await new Promise(r => requestAnimationFrame(r))
    }
    brush.endStroke()
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  }, points)
// The pixels the round tip paints at size 1 or 3 (a plus) for these dabs
function tipPixels(dabs) {
  const set = new Set()
  for (const { x, y, size } of dabs) {
    const left = x - size / 2,
      top = y - size / 2
    const cells =
      size === 1
        ? [[0, 0]]
        : [
            [1, 0],
            [0, 1],
            [1, 1],
            [2, 1],
            [1, 2],
          ]
    for (const [i, j] of cells) set.add(`${left + i},${top + j}`)
  }
  return [...set].sort()
}

await newDrawing(400, 150)
check('not with a smooth brush', (await ppButton()) === null)
await page.evaluate(() =>
  [...document.querySelectorAll('button.brush')].find(b => b.textContent.trim().startsWith('Pixel')).click(),
)
await sleep(300)
check('with the Pixel brush, off at first', (await ppButton()) === 'false')
await setSize(1)
await sleep(100)

await staircase(10, 10, 8)
const off = await paintedIn(8, 8, 14, 14)
check('off: doubled corners painted', doubledCorners(off) > 0, `${doubledCorners(off)}`)

await click('Pixel-perfect')
await sleep(100)
check('the button turns on', (await ppButton()) === 'true')
const steps = []
await staircase(40, 10, 8, async () => steps.push(new Set(await paintedIn(38, 8, 14, 14))))
const on = await paintedIn(38, 8, 14, 14)
const erasedWhilePainting = steps.some((set, i) => steps.slice(i + 1).some(later => [...set].some(p => !later.has(p))))
check('on: a corner painted as the pen enters it goes again while painting', erasedWhilePainting)
check(
  'on: no doubled corners',
  doubledCorners(on) === 0 && on.length >= 9,
  `${doubledCorners(on)} in ${on.length} pixels`,
)

await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await sleep(200)
check(
  'one undo takes the whole stroke away',
  (await paintedIn(38, 8, 14, 14)).length === 0 && (await paintedIn(8, 8, 14, 14)).join() === off.join(),
)
await page.keyboard.down('Control')
await page.keyboard.down('Shift')
await page.keyboard.press('z')
await page.keyboard.up('Shift')
await page.keyboard.up('Control')
await sleep(200)
check('redo brings it back as it was', (await paintedIn(38, 8, 14, 14)).join() === on.join())

// Given exactly, the strokes paint just what the rule says (see the top), at sizes 1 and 3, also where a corner
// painted earlier is taken out of a tile painted again
const tipShape = { ...pixelShape, spacing: 0.01 }
for (const [size, x, y] of [
  [1, 10, 60],
  [3, 40, 60],
  [1, 250, 60],
]) {
  await setSize(size)
  await sleep(100)
  const points = staircasePoints(x, y, 12)
  await strokeDirectly(points)
  const path = createDabPath(tipShape, size, { seed: 1 })
  const expected = tipPixels(withoutCorners([...path.start(points[0]), ...path.moveTo(points.slice(1)), ...path.end()]))
  const all = tipPixels([...createDabPath(tipShape, size, { seed: 1 }).start(points[0])])
  const painted = (await paintedIn(x - 3, y - 3, 20, 20)).sort()
  check(
    `exactly at size ${size}${x === 250 ? ', across tiles (256 and up)' : ''}: the pixels the rule leaves`,
    painted.join() === expected.join(),
    `${painted.length} painted, ${expected.length} expected`,
  )
}

// Soft paint put back exactly: a stroke given a point at a time (each corner painted, then put back) and the same
// stroke given at once (each corner left out before it is painted) come out the same, color for color. Its start
// fades and it is long enough that the end changes nothing, so nothing is painted again afterwards
await page.evaluate(() => {
  window.lydia.brush.settings.taper = { start: 30, end: 0, thins: 'opacity' }
})
await setSize(3)
await sleep(100)
const colorsIn = (x, y, w, h) =>
  page.evaluate(
    (x, y, w, h) => {
      const colors = []
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) colors.push(window.lydia.projection.colorAt(i, j))
      return colors.join()
    },
    x,
    y,
    w,
    h,
  )
await strokeDirectly(staircasePoints(10, 95, 40))
await page.evaluate(
  points => {
    const { brush } = window.lydia
    brush.startStroke(points[0].x, points[0].y, 1)
    brush.continueStroke(points.slice(1))
    brush.endStroke()
  },
  staircasePoints(110, 95, 40),
)
await frames()
const pointByPoint = await colorsIn(7, 92, 48, 48),
  atOnce = await colorsIn(107, 92, 48, 48)
check(
  'soft paint: a point at a time and all at once, the same colors',
  pointByPoint === atOnce && pointByPoint.includes('#000000') && new Set(pointByPoint.split(',')).size > 3,
  `${new Set(pointByPoint.split(',')).size} colors`,
)

// The eraser with a pixel brush also has it
await page.keyboard.press('e')
await sleep(200)
check('the eraser with a pixel brush has it too', (await ppButton()) === 'true')
await page.keyboard.press('b')
await sleep(200)

// Remembered in a new drawing; with a tapered end that fades, worked out again once the stroke ends, still without
// the corners
await page.evaluate(() => {
  window.confirm = () => true
  localStorage.setItem('lydia.taper', JSON.stringify({ start: 0, end: 30, thins: 'opacity' }))
})
await page.screenshot({ path: OUT + '/pp-strokes.png' })
await click('Back')
await sleep(300)
await page.evaluate(() => delete window.lydia)
await newDrawing(300, 150)
await page.evaluate(() =>
  [...document.querySelectorAll('button.brush')].find(b => b.textContent.trim().startsWith('Pixel')).click(),
)
await sleep(300)
await setSize(1)
check('remembered on, in a new drawing', (await ppButton()) === 'true')
const tapered = staircasePoints(250, 10, 12)
await strokeDirectly(tapered)
const taperPath = createDabPath(tipShape, 1, { seed: 1, taper: { start: 0, end: 30, thins: 'opacity' }, length: 24 })
const taperExpected = tipPixels(
  withoutCorners([...taperPath.start(tapered[0]), ...taperPath.moveTo(tapered.slice(1)), ...taperPath.end()]),
)
const taperPainted = (await paintedIn(247, 7, 20, 20)).sort()
const fadedEnd = await page.evaluate(() => window.lydia.projection.colorAt(262, 22))
check('tapered: the end fades', fadedEnd !== '#000000' && fadedEnd !== '#ffffff', fadedEnd)
check(
  'tapered: the pixels the rule leaves, after the stroke was worked out again',
  taperPainted.join() === taperExpected.join(),
  `${taperPainted.length} painted, ${taperExpected.length} expected`,
)

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
