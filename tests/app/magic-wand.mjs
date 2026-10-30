// The magic wand (W): its button, key and settings; it selects the region around the point clicked, stopping at the
// lines; Expand goes into their soft edge without crossing them; Shift adds and Alt takes away; Contiguous off selects
// the same color everywhere; This layer; undo
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { CACHE_DIR, LAUNCH, ROOT } from './setup.mjs'
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

await click('New project…')
await page.waitForSelector('dialog.new-project[open]')
const inputs = await page.$$('dialog input[type=number]')
for (const [i, value] of [
  [0, 300],
  [1, 200],
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
const waitIdle = () =>
  page.waitForFunction(
    () => {
      const s = window.lydia.engine.getSnapshot()
      return !s.task && !s.isUpdating && !window.lydia.projection.isUpdating()
    },
    { timeout: 60000, polling: 10 },
  )
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
      const width = Math.min(256, 300 - column * 256)
      return tile[(Math.floor(y) - row * 256) * width + (Math.floor(x) - column * 256)]
    },
    x,
    y,
  )
// How many pixels of row y are selected, from x = 0 to x = to - 1
const selectedInRow = async (y, to) => {
  let count = 0
  for (let x = 0; x < to; x++) if ((await selectedAt(x, y)) > 0) count++
  return count
}
// A click of the magic wand on the paper, with Shift or Alt held
async function wandAt(x, y, key) {
  const p = await pageOf(x, y)
  if (key) await page.keyboard.down(key)
  await page.mouse.click(p.x, p.y)
  if (key) await page.keyboard.up(key)
  await sleep(100)
  await waitIdle()
}
const setWand = settings => page.evaluate(settings => window.lydia.engine.setWand(settings), settings)

// ----- A black Soft round line down the middle, on a layer of its own -----
await click('New layer')
await sleep(200)
await page.evaluate(async () => {
  const library = await import('/src/brushLibrary.ts')
  const brush = library.builtInBrush('soft-round')
  const { engine } = window.lydia
  engine.setBrushTip(await library.tipOf(brush), brush.preset)
  engine.setBrush({ size: 20, color: '#000000', tool: 'brush', opacity: 1 })
  window.lydia.brush.startStroke(150, -20, 1)
  window.lydia.brush.continueStroke([{ x: 150, y: 220, pressure: 1 }])
  window.lydia.brush.endStroke()
})
await waitIdle()
await click('New layer') // the layer to color, empty: All layers looks at the line
await sleep(200)

// ----- The button, the key and the bar -----
await page.keyboard.press('w')
await sleep(100)
check(
  'W chooses the magic wand',
  await page.evaluate(
    () => document.querySelector('.tool-column button[aria-label="Magic wand"]')?.ariaPressed === 'true',
  ),
)
const bar = await page.$eval('.toolbar', el => el.textContent)
check(
  'the bar has Tolerance, Look at, Expand and Contiguous, and not Edges',
  ['Tolerance', 'Look at', 'Expand', 'Contiguous'].every(word => bar.includes(word)) && !bar.includes('Edges'),
  bar,
)
check(
  'Contiguous is on at first',
  await page.evaluate(
    () => [...document.querySelectorAll('.toolbar button')].find(b => b.textContent === 'Contiguous').ariaPressed,
  ),
)

// ----- The region, without and with Expand -----
await setWand({ expand: 0 })
await wandAt(50, 100)
check('a click selects the region around it', (await selectedAt(50, 100)) === 255 && (await selectedAt(0, 0)) === 255)
check('the line stops it', (await selectedAt(150, 100)) === 0 && (await selectedAt(250, 100)) === 0)
const without = await selectedInRow(100, 150)
await setWand({ expand: 20 })
await wandAt(50, 100)
const withExpand = await selectedInRow(100, 150)
check(
  "Expand goes into the line's soft edge",
  withExpand > without,
  `${without} pixels of the row without, ${withExpand} with`,
)
check("but doesn't cross the line", (await selectedAt(250, 100)) === 0 && (await selectedAt(170, 100)) === 0)

// ----- Shift adds, Alt takes away, Ctrl+Z -----
await wandAt(250, 100, 'Shift')
check('Shift + click adds the other side', (await selectedAt(50, 100)) === 255 && (await selectedAt(250, 100)) === 255)
await wandAt(50, 100, 'Alt')
check('Alt + click takes a side away', (await selectedAt(50, 100)) === 0 && (await selectedAt(250, 100)) === 255)
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await waitIdle()
check('Ctrl+Z brings it back', (await selectedAt(50, 100)) === 255 && (await selectedAt(250, 100)) === 255)

// ----- Contiguous off, and This layer -----
await page.evaluate(() =>
  [...document.querySelectorAll('.toolbar button')].find(b => b.textContent === 'Contiguous').click(),
)
await sleep(50)
await wandAt(50, 100)
check(
  'without Contiguous, the same color on the other side of the line too',
  (await selectedAt(50, 100)) === 255 && (await selectedAt(250, 100)) === 255 && (await selectedAt(150, 100)) === 0,
)
await setWand({ contiguous: true, reference: 'layer' })
await wandAt(50, 100)
check(
  'This layer, an empty one: the line on the other layer is not looked at',
  (await selectedAt(150, 100)) === 255 && (await selectedAt(250, 100)) === 255,
)

check('no errors or warnings on the page', problems.length === 0, problems.slice(0, 5).join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
