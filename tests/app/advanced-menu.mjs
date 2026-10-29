// The Advanced menu (stabilizer and taper): closed at first, a click on the drawing only closing it, Esc, pinned to stay
// open; the taper at the start and the end, Thins Opacity, short strokes, a click's dot, pixel brushes, undo and redo;
// remembered
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
const keys = async (...combo) => {
  for (const k of combo.slice(0, -1)) await page.keyboard.down(k)
  await page.keyboard.press(combo.at(-1))
  for (const k of combo.slice(0, -1).reverse()) await page.keyboard.up(k)
  await sleep(60)
}
const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
// The outline is the last thing on the stage: whether it shows, its size on the screen, and the canvas's cursor
const outline = async () => {
  await frames()
  return page.evaluate(() => {
    const { app } = window.lydia
    const g = app.stage.children.at(-1)
    const b = g.getLocalBounds()
    return {
      visible: g.visible,
      width: b.width,
      height: b.height,
      x: b.x + b.width / 2,
      y: b.y + b.height / 2,
      cursor: app.canvas.style.cursor,
      zoom: window.lydia.world.scale.y,
    }
  })
}
const setSize = size =>
  page.evaluate(size => {
    const input = document.querySelector('label[title^="Brush size"] input[type=range]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(size))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, size)
const chooseBrush = name =>
  page.evaluate(
    name => [...document.querySelectorAll('button.brush')].find(b => b.textContent.includes(name)).click(),
    name,
  )
const moveTo = async (x, y) => {
  const p = await pageOf(x, y)
  await page.mouse.move(p.x, p.y, { steps: 2 })
}
const near = (a, b, within) => Math.abs(a - b) <= within

// Is the paper painted at this point (darker than light gray)?
const painted = (x, y) =>
  page.evaluate(
    (x, y) => {
      const c = window.lydia.projection.colorAt(x, y)
      return c !== null && parseInt(c.slice(1, 3), 16) < 128
    },
    x,
    y,
  )
// The highest and lowest painted rows between columns x0 and x1 (every 4th column), from y0 to y1
const spread = (x0, x1, y0, y1) =>
  page.evaluate(
    (x0, x1, y0, y1) => {
      let top = Infinity,
        bottom = -Infinity
      for (let x = x0; x <= x1; x += 4)
        for (let y = y0; y <= y1; y++) {
          const c = window.lydia.projection.colorAt(x, y)
          if (c && parseInt(c.slice(1, 3), 16) < 128) {
            top = Math.min(top, y)
            bottom = Math.max(bottom, y)
          }
        }
      return bottom - top
    },
    x0,
    x1,
    y0,
    y1,
  )
const setStabilizer = (strength, mode) =>
  page.evaluate(
    (strength, mode) => {
      const input = [...document.querySelectorAll('label')]
        .find(l => l.textContent.startsWith('Stabilizer'))
        .querySelector('input[type=range]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(strength))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      if (mode) [...document.querySelectorAll('button')].find(b => b.textContent === mode).click()
    },
    strength,
    mode,
  )
const hasStabilizer = () =>
  page.evaluate(() => [...document.querySelectorAll('label')].some(l => l.textContent.startsWith('Stabilizer')))
// A shaky horizontal line: up and down by "wobble" every 6 pixels, at y, from x0 to x1
async function shaky(x0, x1, y, wobble) {
  await moveTo(x0, y)
  await page.mouse.down()
  for (let x = x0, i = 0; x <= x1; x += 6, i++) await moveTo(x, y + (i % 2 ? wobble : -wobble))
  await moveTo(x1, y)
  await page.mouse.up()
  await sleep(100)
}

// How many rows are painted in column x, from y - 30 to y + 30, and how dark the darkest is (0 to 255)
const across = (x, y) =>
  page.evaluate(
    (x, y) => {
      let rows = 0,
        darkest = 255
      for (let v = y - 30; v <= y + 30; v++) {
        const c = window.lydia.projection.colorAt(x, v)
        const r = c ? parseInt(c.slice(1, 3), 16) : 255
        darkest = Math.min(darkest, r)
        if (r < 128) rows++
      }
      return { rows, darkest }
    },
    x,
    y,
  )
const setRange = (labelStart, value) =>
  page.evaluate(
    (labelStart, value) => {
      const input = [...document.querySelectorAll('label')]
        .find(l => l.textContent.startsWith(labelStart))
        .querySelector('input[type=range]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    labelStart,
    value,
  )
const panelShown = () => page.evaluate(() => !!document.querySelector('.advanced-panel'))
const canUndo = () => page.evaluate(() => window.lydia.engine.getSnapshot().canUndo)
async function line(x0, x1, y, keepDown = false) {
  await moveTo(x0, y)
  await page.mouse.down()
  for (let x = x0 + 10; x <= x1; x += 10) await moveTo(x, y)
  if (!keepDown) {
    await page.mouse.up()
    await sleep(150)
  }
}

await newDrawing(1000, 800)
await keys('b')
await chooseBrush('Hard round')
await setSize(20)
check(
  'Advanced shows with the brush, closed',
  (await page.evaluate(() => !!document.querySelector('.advanced-menu'))) && !(await panelShown()),
)
await click('Advanced ▾')
check(
  '…it opens with the stabilizer and the taper',
  (await panelShown()) &&
    (await hasStabilizer()) &&
    (await page.evaluate(() =>
      [...document.querySelectorAll('.advanced-panel label')].map(l => l.textContent.split(/\d/)[0].trim()).join(),
    )) === 'Stabilizer,Taper start,Taper end',
)
const heightBefore = await page.evaluate(() => window.lydia.app.canvas.getBoundingClientRect().height)
await moveTo(500, 700)
await page.mouse.down()
await page.mouse.up()
await sleep(100)
check('a click on the drawing only closes it, and paints nothing', !(await panelShown()) && !(await canUndo()))
await click('Advanced ▾')
await keys('Escape')
check('Esc closes it', !(await panelShown()))
await click('Advanced ▾')
await page.click('.advanced-panel .icon-button')
await moveTo(500, 700)
await page.mouse.down()
await page.mouse.up()
await sleep(100)
check('pinned, it stays open, and the click paints', (await panelShown()) && (await canUndo()))
check(
  'the drawing area keeps its size',
  heightBefore === (await page.evaluate(() => window.lydia.app.canvas.getBoundingClientRect().height)),
)
await keys('s')
check('another tool: no Advanced', !(await panelShown()))
await keys('b')
check('back to the brush: still open (pinned)', await panelShown())
await keys('Control', 'z')

// The start thins out over 100 pixels
await setRange('Taper start', 100)
await line(100, 700, 150)
const s = [
  await across(102, 150),
  await across(150, 150),
  await across(195, 150),
  await across(400, 150),
  await across(698, 150),
]
check(
  'Taper start: thin at the start, growing, then full',
  s[0].rows <= 4 &&
    s[1].rows > s[0].rows &&
    s[1].rows < s[3].rows &&
    Math.abs(s[2].rows - s[3].rows) <= 2 &&
    s[4].rows === s[3].rows,
  s.map(v => v.rows).join(' '),
)

// The end only thins out once the pen comes up
await setRange('Taper start', 0)
await setRange('Taper end', 100)
await line(100, 700, 250, true)
const before = await across(690, 250)
await page.mouse.up()
await sleep(150)
const e = [await across(102, 250), await across(400, 250), await across(650, 250), await across(697, 250)]
check('Taper end: full while painting', before.rows === e[1].rows, `${before.rows} vs ${e[1].rows}`)
check(
  '…thin at the end once the pen comes up',
  e[0].rows === e[1].rows && e[2].rows < e[1].rows && e[3].rows <= 4,
  e.map(v => v.rows).join(' '),
)
await keys('Control', 'z')
check('one undo takes the whole stroke away', (await across(400, 250)).rows === 0)
await keys('Control', 'Shift', 'z')
check(
  '…and redo brings it back, tapered',
  (await across(697, 250)).rows <= 4 && (await across(400, 250)).rows === e[1].rows,
)

// Opacity: as wide, fainter
await click('Opacity')
await setRange('Taper start', 100)
await line(100, 700, 350)
const o = [await across(105, 350), await across(400, 350)]
check(
  'Thins Opacity: as thick, but fainter at the start',
  o[0].darkest > o[1].darkest + 100,
  `darkest ${o[0].darkest} at the start, ${o[1].darkest} in the middle`,
)
await click('Size')

// A short stroke: both ends shortened to meet; a click: a whole dot
await line(300, 340, 450)
// 40 pixels long: each end tapers over 20, so near its start it is thin, and full only in the middle
const short = [await across(305, 450), await across(320, 450)]
check(
  'a stroke shorter than both tapers: both ends shortened to meet in the middle',
  short[0].rows > 2 && short[0].rows < short[1].rows && short[1].rows >= e[1].rows - 1,
  short.map(v => v.rows).join(' '),
)
await moveTo(600, 450)
await page.mouse.down()
await page.mouse.up()
await sleep(150)
check(
  'a click paints a whole dot',
  (await across(600, 450)).rows >= e[1].rows - 1,
  `${(await across(600, 450)).rows} rows`,
)

// Other brushes
for (const [name, y] of [
  ['Pixel', 550],
  ['Chalk', 620],
  ['Soft round', 700],
]) {
  await chooseBrush(name)
  await sleep(200)
  await line(100, 700, y)
}
const pixelMid = await across(400, 550),
  pixelEnd = await across(699, 550)
check('Pixel: tapers too', pixelEnd.rows < pixelMid.rows, `${pixelEnd.rows} at the end, ${pixelMid.rows} in the middle`)
await moveTo(900, 50)
await page.screenshot({ path: OUT + '/taper.png' })

// A long stroke ends without a long freeze
await chooseBrush('Hard round')
await setRange('Taper start', 0)
await moveTo(50, 760)
await page.mouse.down()
for (let i = 0; i < 300; i++) await moveTo(50 + (i % 2 ? 900 : 0) + (i % 2 ? -i : i), 760 - (i % 30))
const t0 = Date.now()
await page.mouse.up()
await page.evaluate(() => new Promise(r => requestAnimationFrame(r)))
check('a long stroke ends quickly', Date.now() - t0 < 300, `${Date.now() - t0} ms`)

const saved = await page.evaluate(() => [
  localStorage.getItem('lydia.taper'),
  localStorage.getItem('lydia.advancedPinned'),
])
check('remembered', saved[0] === '{"start":0,"end":100,"thins":"size"}' && saved[1] === 'on', saved.join(' '))

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
