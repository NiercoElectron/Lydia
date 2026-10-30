// Blend modes: each of the 16 against formulas written here on their own, the select in the panel, opacity, undo,
// painting under a blend layer (live too), merging down with the same formulas, saved with the drawing
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
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}

// ----- The formulas (W3C Compositing and Blending), over an opaque backdrop -----
const screen = (b, s) => b + s - b * s
const hard = (b, s) => (s <= 0.5 ? b * 2 * s : screen(b, 2 * s - 1))
const soft = (b, s) => {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b)
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)
  return b + (2 * s - 1) * (d - b)
}
const separable = {
  normal: (b, s) => s,
  multiply: (b, s) => b * s,
  screen,
  overlay: (b, s) => hard(s, b),
  add: (b, s) => Math.min(1, b + s),
  darken: Math.min,
  lighten: Math.max,
  'color-dodge': (b, s) => (b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s))),
  'color-burn': (b, s) => (b === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  'soft-light': soft,
  'hard-light': hard,
  difference: (b, s) => Math.abs(b - s),
}
const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
const clip = c => {
  const l = lum(c),
    n = Math.min(...c),
    x = Math.max(...c)
  if (n < 0) c = c.map(v => l + ((v - l) * l) / (l - n))
  if (x > 1) c = c.map(v => l + ((v - l) * (1 - l)) / (x - l))
  return c
}
const setLum = (c, l) => clip(c.map(v => v + l - lum(c)))
const sat = c => Math.max(...c) - Math.min(...c)
const setSat = (c, s) => {
  const n = Math.min(...c),
    x = Math.max(...c)
  return x > n ? c.map(v => ((v - n) * s) / (x - n)) : [0, 0, 0]
}
const nonSeparable = {
  hue: (b, s) => setLum(setSat(s, sat(b)), lum(b)),
  saturation: (b, s) => setLum(setSat(b, sat(s)), lum(b)),
  color: (b, s) => setLum(s, lum(b)),
  luminosity: (b, s) => setLum(b, lum(s)),
}
const MODES = [...Object.keys(separable), ...Object.keys(nonSeparable)]
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
// The color expected where the layer (color "top", at "opacity") is over "under"
function expected(mode, under, top, opacity = 1) {
  const b = rgb(under),
    s = rgb(top)
  const mixed = nonSeparable[mode] ? nonSeparable[mode](b, s) : b.map((v, i) => separable[mode](v, s[i]))
  return mixed.map((v, i) => Math.min(1, Math.max(0, v)) * opacity + b[i] * (1 - opacity))
}
const near = (hex, values) => hex !== null && rgb(hex).every((v, i) => Math.abs(v - values[i]) <= 2.5 / 255)
const show = values =>
  '#' +
  values
    .map(v =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')

// ----- In the app -----
const browser = await puppeteer.launch(LAUNCH)
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
const colorAt = (x, y) => page.evaluate((x, y) => window.lydia.projection.colorAt(x, y), x, y)
const waitIdle = () =>
  page.waitForFunction(
    () => {
      const s = window.lydia.engine.getSnapshot()
      return !s.task && !s.isUpdating
    },
    { timeout: 30000 },
  )
const setColor = color =>
  page.evaluate(color => {
    const input = document.querySelector('input.color-hex')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, color)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, color)
const drag = async (x0, y0, x1, y1, during) => {
  const a = await pageOf(x0, y0),
    b = await pageOf(x1, y1)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 })
  await page.mouse.move(b.x, b.y, { steps: 4 })
  await frames()
  if (during) await during()
  await page.mouse.up()
  await sleep(150)
}
const activeId = () => page.evaluate(() => window.lydia.engine.getSnapshot().activeLayerId)
const setMode = async (id, mode) => {
  await page.evaluate((id, mode) => window.lydia.engine.setLayerBlendMode(id, mode), id, mode)
  await waitIdle()
}
const undo = async () => {
  await page.keyboard.down('Control')
  await page.keyboard.press('z')
  await page.keyboard.up('Control')
  await waitIdle()
}

await newDrawing(300, 200)
await page.evaluate(() =>
  [...document.querySelectorAll('button.brush')].find(b => b.textContent.trim().startsWith('Hard round')).click(),
)
await sleep(300)
await setSize(20)
// Layer 1: stripes of three colors over the white paper
const UNDER = [
  ['#ff0000', 30],
  ['#336699', 70],
  ['#808080', 110],
]
for (const [color, y] of UNDER) {
  await setColor(color)
  await sleep(80)
  await drag(20, y, 280, y)
}
const lower = await activeId()
// Layer 2: a stripe across them, and over the paper
await click('New layer')
await sleep(200)
const TOP = '#c08040'
await setColor(TOP)
await sleep(80)
await drag(150, 5, 150, 190)
const upper = await activeId()
const points = [...UNDER, ['#ffffff', 160]]

check('the select shows Normal', (await page.$eval('.layer-blend select', s => s.value)) === 'normal')
await page.select('.layer-blend select', 'multiply')
await waitIdle()
check(
  'choosing Multiply in the select sets it',
  (await page.evaluate(() => window.lydia.engine.getSnapshot().layers.at(-1).blendMode)) === 'multiply',
)

for (const mode of MODES) {
  await setMode(upper, mode)
  const wrong = []
  for (const [under, y] of points) {
    const got = await colorAt(150, y)
    const want = expected(mode, under, TOP)
    if (!near(got, want)) wrong.push(`over ${under}: ${got}, wanted ${show(want)}`)
  }
  check(`${mode}: the formula over each color`, wrong.length === 0, wrong.join('; '))
}
await setMode(upper, 'difference')
check(
  'where the layer has no paint, nothing changes',
  (await colorAt(60, 160)) === '#ffffff' && (await colorAt(60, 30)) === '#ff0000',
)

// At half opacity, also while the slider moves
await setMode(upper, 'multiply')
await page.evaluate(id => window.lydia.engine.setLayerOpacity(id, 0.5), upper)
await waitIdle()
// While the slider moves, the screen shows the live tiles: read what it shows, not the projection's tiles
const shown = (x, y) =>
  page.evaluate(
    (x, y) => {
      const { app, projection } = window.lydia
      const Rectangle = projection.container.getBounds().rectangle.constructor // PixiJS isn't on the page by itself
      const p = app.renderer.extract.pixels({ target: projection.container, frame: new Rectangle(x, y, 1, 1) }).pixels
      return (
        '#' +
        [0, 1, 2]
          .map(i =>
            Math.round((p[i] * 255) / (p[3] || 1))
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')
      )
    },
    x,
    y,
  )
check(
  'multiply at 50% while the slider moves',
  near(await shown(150, 70), expected('multiply', '#336699', TOP, 0.5)),
  await shown(150, 70),
)
await page.evaluate(() => window.lydia.engine.finishLayerOpacity())
await waitIdle()
check(
  '…and once let go',
  near(await colorAt(150, 70), expected('multiply', '#336699', TOP, 0.5)),
  await colorAt(150, 70),
)
await undo()
check('undo: back to full opacity', near(await colorAt(150, 70), expected('multiply', '#336699', TOP)))

// Undo and redo of a blend mode
await setMode(upper, 'screen')
await undo()
check(
  'undo brings the mode back',
  near(await colorAt(150, 70), expected('multiply', '#336699', TOP)) &&
    (await page.$eval('.layer-blend select', s => s.value)) === 'multiply',
)
await page.keyboard.down('Control')
await page.keyboard.press('y')
await page.keyboard.up('Control')
await waitIdle()
const redone = await page.evaluate(() => window.lydia.engine.getSnapshot().layers.at(-1).blendMode)
check(
  'redo sets it again',
  redone === 'screen' && near(await colorAt(150, 70), expected('screen', '#336699', TOP)),
  redone,
)
await setMode(upper, 'multiply')

// Painting on the layer under a multiply layer: shown multiplied while painting and after
await page.evaluate(id => window.lydia.engine.selectLayer(id), lower)
await sleep(100)
await setColor('#00ff00')
await sleep(80)
const live = {}
await drag(130, 160, 170, 160, async () => {
  live.color = await colorAt(150, 160)
})
await waitIdle()
const green = expected('multiply', '#00ff00', TOP)
check('painting under it: multiplied while painting', near(live.color, green), live.color)
check('…and after', near(await colorAt(150, 160), green), await colorAt(150, 160))

// Saved with the drawing
const saved = await page.evaluate(async () => {
  const { parseProject } = await import('/src/engine/projectFile.ts')
  return parseProject(await (await window.lydia.engine.saveProject()).arrayBuffer()).layers.map(l => l.blendMode)
})
check('saved with the drawing', saved.join() === 'normal,multiply', saved.join())

// Merging down: the same picture where the layer under covers, and the paint as it is where it doesn't
await page.evaluate(id => window.lydia.engine.selectLayer(id), upper)
await sleep(100)
const before = []
for (const [, y] of points) before.push(await colorAt(150, y))
await page.evaluate(() => window.lydia.engine.mergeDown())
await waitIdle()
const after = []
for (const [, y] of points) after.push(await colorAt(150, y))
check(
  'merged: the picture is the same',
  after.every((c, i) => near(c, rgb(before[i]))),
  `${before.join()} -> ${after.join()}`,
)
const merged = await page.evaluate(() => window.lydia.engine.getSnapshot().layers.map(l => l.blendMode))
check('one layer left, with its own mode (Normal)', merged.join() === 'normal', merged.join())
await setMode(lower, 'difference')
check(
  'where the layer under had no paint, the paint was kept as it is',
  near(await colorAt(150, 185), expected('difference', '#ffffff', TOP)),
  await colorAt(150, 185),
)
await undo()
await undo()
const back = await page.evaluate(() => window.lydia.engine.getSnapshot().layers.map(l => l.blendMode))
check(
  'undo brings both layers back',
  back.join() === 'normal,multiply' && near(await colorAt(150, 70), expected('multiply', '#336699', TOP)),
  back.join(),
)

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
