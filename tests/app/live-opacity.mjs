// A layer's opacity shown live while the slider moves: the same picture as once it is let go, whatever the blend modes
// of the layer, of the layers above it and of the folders it is in, clipped or not, on a white or a transparent paper
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
    'dialog.new-project',
    d =>
      [...d.querySelectorAll('button')].find(b => b.textContent === 'Transparent').getAttribute('aria-pressed') ===
      'true',
  )
  if (isTransparent !== transparent) await click('Transparent')
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
    const input = document.querySelector('input[type=color]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, color)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, color)
const drag = async (x0, y0, x1, y1) => {
  const a = await pageOf(x0, y0),
    b = await pageOf(x1, y1)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 })
  await page.mouse.move(b.x, b.y, { steps: 4 })
  await frames()
  await page.mouse.up()
  await sleep(150)
}
const engine = (name, ...args) => page.evaluate((name, args) => window.lydia.engine[name](...args), name, args)
const activeId = () => page.evaluate(() => window.lydia.engine.getSnapshot().activeLayerId)
const call = async (name, ...args) => {
  await engine(name, ...args)
  await waitIdle()
}
// Set an opacity and let the slider go, so it is put together for good
const setOpacity = async (id, opacity) => {
  await call('setLayerOpacity', id, opacity)
  await call('finishLayerOpacity')
}

// What the screen shows at these points of the paper, as the graphics card has it (colors multiplied by alpha)
const shown = points =>
  page.evaluate(points => {
    const { app, projection } = window.lydia
    const Rectangle = projection.container.getBounds().rectangle.constructor // PixiJS isn't on the page by itself
    return points.map(([x, y]) => [
      ...app.renderer.extract.pixels({ target: projection.container, frame: new Rectangle(x, y, 1, 1) }).pixels,
    ])
  }, points)
// How many tiles the screen shows live (see showOpacityLive in projection.ts)
const liveTiles = () => page.evaluate(() => window.lydia.projection.liveShown())

const POINTS = [
  [60, 30],
  [150, 30],
  [150, 70],
  [150, 90],
  [150, 110],
  [150, 130],
  [150, 150],
  [150, 190],
  [270, 70],
  [270, 90],
  [270, 150],
]
const near = (a, b) => a.every((value, i) => Math.abs(value - b[i]) <= 3)
const show = list => list.map(p => p.join('/')).join(' ')

// Change the opacity of "id" to 35 % with the slider still held, and compare the screen with the picture once it is let
// go. "isLive" says whether the tiles must be shown live (else they are put together again)
async function compare(name, id, isLive = true) {
  await engine('setLayerOpacity', id, 0.35)
  await waitIdle()
  await frames()
  const tiles = await liveTiles()
  const during = await shown(POINTS)
  await call('finishLayerOpacity')
  await frames()
  const after = await shown(POINTS)
  const wrong = POINTS.filter((_, i) => !near(during[i], after[i]))
  check(
    `${name}: ${isLive ? 'shown live' : 'put together again'}, the same picture as once let go`,
    (isLive ? tiles > 0 : tiles === 0) && wrong.length === 0,
    `${tiles} live tiles; ${wrong.length ? 'different at ' + wrong.join(' ') + ': ' + show(during) + ' vs ' + show(after) : ''}`,
  )
  // And it really changed something
  await setOpacity(id, 1)
  const full = await shown(POINTS)
  check(
    `${name}: 35 % differs from full opacity`,
    POINTS.some((_, i) => !near(full[i], after[i])),
  )
}

async function paintLayers(transparent) {
  if (await page.evaluate(() => window.lydia?.engine !== undefined)) {
    // Back to the start, leaving the drawing open without saving
    await page.evaluate(() => {
      window.confirm = () => true
    })
    await click('Back')
    await sleep(300)
    await page.evaluate(() => delete window.lydia)
  }
  await newDrawing(300, 200, transparent)
  await page.evaluate(() =>
    [...document.querySelectorAll('button.brush')].find(b => b.textContent.trim().startsWith('Hard round')).click(),
  )
  await sleep(300)
  await setSize(20)
  // Layer 1: stripes across both columns of tiles
  for (const [color, y] of [
    ['#ff0000', 30],
    ['#336699', 70],
    ['#808080', 110],
    ['#20a040', 150],
  ]) {
    await setColor(color)
    await sleep(80)
    await drag(20, y, 290, y)
  }

  // Layer 2, the one whose opacity changes: two upright stripes, one in the tile at the paper's edge
  await click('New layer')
  await sleep(200)
  await setColor('#c08040')
  await sleep(80)
  await drag(150, 5, 150, 195)
  await drag(270, 5, 270, 195)
  const middle = await activeId()
  // Layer 3, above: a wide stripe across them
  await click('New layer')
  await sleep(200)
  await setSize(40)
  await setColor('#ffcc00')
  await sleep(80)
  await drag(20, 90, 290, 90)
  const light = await activeId()
  await waitIdle()
  return { middle, light }
}

// ----- On a white paper -----
let { middle, light } = await paintLayers(false)
await call('selectLayer', middle)

await compare('a normal layer under a normal one', middle)
await call('setLayerBlendMode', middle, 'multiply')
await compare('a Multiply layer', middle)
await call('setLayerBlendMode', light, 'screen')
await compare('a Multiply layer under a Screen one', middle)
await call('setLayerBlendMode', light, 'overlay')
await compare('a Multiply layer under an Overlay one', middle)
await call('setLayerBlendMode', middle, 'normal')
await call('setLayerBlendMode', light, 'color-dodge')
await compare('a normal layer under a Color Dodge one', middle)
await call('setLayerBlendMode', middle, 'difference')
await call('setLayerBlendMode', light, 'normal')
await compare('a Difference layer', middle)

// Clipped: a layer clipped to it, and itself clipped to the layer under it
await call('setLayerClipped', light, true)
await compare('a Difference layer with a normal one clipped to it', middle)
await call('setLayerBlendMode', light, 'hard-light')
await compare('…a Hard Light one clipped to it', middle)
await call('setLayerClipped', light, false)
await call('setLayerClipped', middle, true)
await compare('a clipped Difference layer', middle)
await call('setLayerClipped', middle, false)
await call('setLayerBlendMode', middle, 'normal')
await call('setLayerBlendMode', light, 'overlay')

// In a folder with its own blend mode, under an Overlay layer
await call('selectLayer', middle)
await call('groupActive')
const folder = await activeId()
await call('setLayerBlendMode', folder, 'multiply')
await setOpacity(folder, 0.8)
await call('selectLayer', middle)
await compare('a layer in a Multiply folder at 80 %, under an Overlay layer', middle)
await call('setLayerBlendMode', middle, 'color-burn')
await compare('a Color Burn layer in a Multiply folder', middle)
await call('setLayerBlendMode', folder, 'luminosity')
await compare('…in a Luminosity folder', middle)
await call('setLayerBlendMode', middle, 'normal')
await call('selectLayer', folder)
await compare('the Luminosity folder itself', folder)
await call('setLayerBlendMode', folder, 'multiply')
await compare('the Multiply folder itself', folder)

// A folder letting what is in it pass through, at less than full opacity
await call('setLayerBlendMode', folder, 'pass-through')
await setOpacity(folder, 0.7)
await call('selectLayer', middle)
await call('setLayerBlendMode', middle, 'screen')
await compare('a Screen layer in a Pass Through folder at 70 %', middle)
await call('selectLayer', folder)
await compare('the Pass Through folder itself', folder)
await setOpacity(folder, 1)
await compare('the Pass Through folder at full opacity', folder)

// A layer clipped to the folder: its paint changes with the opacity of the layers in it, so they are put together again
await call('moveLayer', light, null, folder)
await call('setLayerClipped', light, true)
await call('selectLayer', middle)
await compare('a layer in a folder that a layer is clipped to', middle, false)
await call('selectLayer', folder)
await compare('that folder itself', folder)
await call('setLayerClipped', light, false)

// More layers with such blend modes above than the screen can do at once: the tiles are put together for each opacity
await call('moveLayer', light, null, null) // to the bottom
await call('selectLayer', light)
for (let i = 0; i < 8; i++) {
  await call('duplicateLayer')
  await call('setLayerBlendMode', await activeId(), i % 2 ? 'overlay' : 'soft-light')
  await setOpacity(await activeId(), 0.3) // at full opacity, 8 of them would make it all one yellow
}
await call('setLayerBlendMode', light, 'normal')
await call('selectLayer', light)
await compare('a layer under 8 Overlay and Soft Light ones', light)

// ----- On a transparent paper -----
;({ middle, light } = await paintLayers(true))
await call('selectLayer', middle)
await compare('transparent paper: a normal layer', middle)
await call('setLayerBlendMode', middle, 'multiply')
await call('setLayerBlendMode', light, 'overlay')
await compare('transparent paper: a Multiply layer under an Overlay one', middle)
await call('setLayerBlendMode', middle, 'color')
await compare('transparent paper: a Color layer', middle)

check('no errors or warnings on the page', problems.length === 0, problems.slice(0, 5).join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
