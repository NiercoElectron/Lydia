// The fill bucket's "All layers" sees the layers as the screen shows them, with blend modes, clipping and folders:
// paint that doesn't show doesn't stop it, and paint that shows does
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { CACHE_DIR, CHROME, ROOT } from './setup.mjs'
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
  if (await page.evaluate(() => window.lydia?.engine !== undefined)) {
    await page.evaluate(() => {
      window.confirm = () => true
    })
    await click('Back')
    await sleep(300)
    await page.evaluate(() => delete window.lydia)
  }
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
const call = async (name, ...args) => {
  await page.evaluate((name, args) => window.lydia.engine[name](...args), name, args)
  await waitIdle()
}
const activeId = () => page.evaluate(() => window.lydia.engine.getSnapshot().activeLayerId)
const shownAt = (x, y) => page.evaluate((x, y) => window.lydia.projection.colorAt(x, y), x, y)
// A stroke of the Hard round brush through these points, straight through the engine
const stroke = async (points, color, size) => {
  await page.evaluate(
    async (points, color, size) => {
      const library = await import('/src/brushLibrary.ts')
      const brush = library.builtInBrush('hard-round')
      const { engine } = window.lydia
      engine.setBrushTip(await library.tipOf(brush), brush.preset)
      engine.setBrush({ size, color, tool: 'brush', opacity: 1 })
      window.lydia.brush.startStroke(points[0][0], points[0][1], 1)
      window.lydia.brush.continueStroke(points.slice(1).map(([x, y]) => ({ x, y, pressure: 1 })))
      window.lydia.brush.endStroke()
    },
    points,
    color,
    size,
  )
  await waitIdle()
}
// Fill with the fill bucket, looking at all the layers, where the pointer clicks on the paper
async function fillAt(x, y, color) {
  await page.evaluate(color => {
    window.lydia.engine.setBrush({ color, opacity: 1 })
    window.lydia.engine.setFill({ reference: 'all', tolerance: 32, expand: 20 })
  }, color)
  await page.keyboard.press('f')
  await sleep(50)
  const p = await pageOf(x, y)
  await page.mouse.click(p.x, p.y)
  await sleep(100)
  await waitIdle()
}
const newLayer = async () => {
  await click('New layer')
  await sleep(200)
  return activeId()
}
const GREEN = '#00c000'

// ----- A Multiply stripe that doesn't show: yellow over red -----
await newDrawing(300, 200)
const red = await activeId()
await fillAt(150, 100, '#ff0000') // the whole layer, red
const stripe = await newLayer()
await stroke(
  [
    [150, -20],
    [150, 220],
  ],
  '#ffff00',
  20,
)
await call('setLayerBlendMode', stripe, 'multiply')
await newLayer()
check(
  "the yellow stripe in Multiply over red doesn't show",
  (await shownAt(150, 100)) === '#ff0000',
  await shownAt(150, 100),
)
await fillAt(50, 100, GREEN)
check(
  "a Multiply stripe that doesn't show doesn't stop the fill",
  (await shownAt(150, 100)) === GREEN && (await shownAt(250, 100)) === GREEN,
  `${await shownAt(150, 100)} on the stripe, ${await shownAt(250, 100)} past it`,
)

// The same stripe as Normal shows, and stops it
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await waitIdle()
await call('setLayerBlendMode', stripe, 'normal')
await fillAt(50, 100, GREEN)
check(
  'a Normal stripe that shows stops it',
  (await shownAt(50, 100)) === GREEN && (await shownAt(250, 100)) === '#ff0000',
  `${await shownAt(50, 100)} before the stripe, ${await shownAt(250, 100)} past it`,
)

// ----- A stripe clipped to a band, which only shows over the band -----
await newDrawing(300, 200)
await stroke(
  [
    [-20, 100],
    [320, 100],
  ],
  '#ff0000',
  60,
)
const clipped = await newLayer()
await stroke(
  [
    [150, -20],
    [150, 220],
  ],
  '#0000ff',
  20,
)
await newLayer()
await call('setLayerClipped', clipped, true)
check(
  'the clipped stripe shows only over the band',
  (await shownAt(150, 100)) === '#0000ff' && (await shownAt(150, 30)) === '#ffffff',
  `${await shownAt(150, 100)} over the band, ${await shownAt(150, 30)} above it`,
)
await fillAt(50, 30, GREEN)
check(
  "the clipped stripe where it doesn't show doesn't stop the fill",
  (await shownAt(150, 30)) === GREEN && (await shownAt(250, 30)) === GREEN,
  `${await shownAt(150, 30)} on the stripe, ${await shownAt(250, 30)} past it`,
)
check('the band still stops it', (await shownAt(50, 100)) === '#ff0000', await shownAt(50, 100))

// ----- A stripe in a folder at no opacity -----
await newDrawing(300, 200)
await fillAt(150, 100, '#ff0000')
const hidden = await newLayer()
await stroke(
  [
    [150, -20],
    [150, 220],
  ],
  '#ffff00',
  20,
)
await call('selectLayer', hidden)
await call('groupActive')
const folder = await activeId()
await call('setLayerOpacity', folder, 0)
await call('finishLayerOpacity')
await call('selectLayer', hidden)
await call('moveLayer', await newLayer(), null, folder) // the layer to fill, out of the folder, above it
check("the stripe in the folder at 0% doesn't show", (await shownAt(150, 100)) === '#ff0000', await shownAt(150, 100))
await fillAt(50, 100, GREEN)
check(
  "a stripe in a folder at no opacity doesn't stop the fill",
  (await shownAt(150, 100)) === GREEN && (await shownAt(250, 100)) === GREEN,
  `${await shownAt(150, 100)} on the stripe, ${await shownAt(250, 100)} past it`,
)

check('no errors or warnings on the page', problems.length === 0, problems.slice(0, 5).join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
