// Moving and transforming shown while dragging as they will be once let go, whatever the blend modes, the opacity,
// clipping and folders: the whole drawing on the screen during the drag against the drawing afterwards
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
      app.render()
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
      return !s.task && !s.isUpdating && !window.lydia.projection.isUpdating()
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
const undo = async () => {
  await page.keyboard.down('Control')
  await page.keyboard.press('z')
  await page.keyboard.up('Control')
  await waitIdle()
}

// The whole drawing as the screen shows it, as the graphics card has it (colors multiplied by alpha)
const shown = () =>
  page.evaluate(() => {
    const { app, projection } = window.lydia
    const Rectangle = projection.container.getBounds().rectangle.constructor // PixiJS isn't on the page by itself
    const { pixels } = app.renderer.extract.pixels({
      target: projection.container,
      frame: new Rectangle(0, 0, 300, 200),
    })
    return [...pixels]
  })
// How far apart two pictures are: the biggest difference in one channel, and where
function compare(a, b) {
  let worst = 0
  let at = -1
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i])
    if (d > worst) {
      worst = d
      at = i
    }
  }
  const pixel = Math.floor(at / 4)
  return { worst, where: at < 0 ? '' : `${pixel % 300},${Math.floor(pixel / 300)}` }
}

// Drag with the move tool by (30, 17) from the middle of the paper, compare the screen while dragging with the drawing
// once let go, then undo the move
const BY = [30, 17]
async function checkMove(name, { tool = 'v', apply = null } = {}) {
  const before = await shown()
  await page.keyboard.press(tool)
  await sleep(50)
  const from = await pageOf(150, 100)
  const to = await pageOf(150 + BY[0], 100 + BY[1])
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 })
  await page.mouse.move(to.x, to.y, { steps: 3 })
  // Shown once its tiles are ready
  await page.waitForFunction(
    () => window.lydia.projection.ghost.visible || window.lydia.engine.getSnapshot().transform,
    {
      timeout: 30000,
    },
  )
  await sleep(100)
  await frames()
  const during = await shown()
  await page.mouse.up()
  if (apply) await page.evaluate(() => window.lydia.engine.applyTransform())
  await sleep(100)
  await waitIdle()
  await frames()
  const after = await shown()
  const difference = compare(during, after)
  const moved = compare(before, after)
  check(
    `${name}: while dragged, the same picture as once let go`,
    difference.worst <= 3 && moved.worst > 20,
    `differs by ${difference.worst} at ${difference.where}; the move changed ${moved.worst}`,
  )
  await undo()
  if (apply) await undo()
}

async function paintLayers(transparent) {
  if (await page.evaluate(() => window.lydia?.engine !== undefined)) {
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
  const lower = await activeId()
  // Layer 2, the one that moves: two upright stripes, one in the tile at the paper's edge
  await click('New layer')
  await sleep(200)
  await setColor('#c08040')
  await sleep(80)
  await drag(150, 5, 150, 195)
  await drag(230, 5, 230, 195)
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
  await call('selectLayer', middle)
  return { lower, middle, light }
}

// ----- On a white paper -----
let { middle, light } = await paintLayers(false)

await checkMove('a Normal layer under a Normal one')
await call('setLayerBlendMode', middle, 'multiply')
await checkMove('a Multiply layer')
await call('setLayerBlendMode', middle, 'difference')
await call('setLayerOpacity', middle, 0.6)
await call('finishLayerOpacity')
await checkMove('a Difference layer at 60 %')
await call('setLayerOpacity', middle, 1)
await call('finishLayerOpacity')
await call('setLayerBlendMode', middle, 'normal')
await call('setLayerBlendMode', light, 'overlay')
await checkMove('a Normal layer under an Overlay one')

// Clipped: layers clipped to it follow it, and it follows its base
await call('setLayerBlendMode', light, 'normal')
await call('setLayerClipped', light, true)
await checkMove('a layer with a Normal one clipped to it')
await call('setLayerBlendMode', light, 'hard-light')
await checkMove('…with a Hard Light one clipped to it')
await call('setLayerClipped', light, false)
await call('setLayerBlendMode', light, 'overlay')
await call('setLayerClipped', middle, true)
await call('setLayerBlendMode', middle, 'multiply')
await checkMove('a clipped Multiply layer')
await call('setLayerClipped', middle, false)
await call('setLayerBlendMode', middle, 'normal')

// In folders
await call('selectLayer', middle)
await call('groupActive')
const folder = await activeId()
await call('setLayerBlendMode', folder, 'multiply')
await call('setLayerOpacity', folder, 0.8)
await call('finishLayerOpacity')
await call('selectLayer', middle)
await checkMove('a layer in a Multiply folder at 80 %, under an Overlay one')
await call('selectLayer', folder)
await checkMove('the Multiply folder itself')
await call('setLayerBlendMode', folder, 'pass-through')
await call('setLayerBlendMode', middle, 'multiply')
await checkMove('a Pass Through folder with a Multiply layer in it')
await call('selectLayer', middle)
await checkMove('the Multiply layer in it')
// A layer clipped to the folder: the folder's paint, which clips it, moves with the layer in it
await call('setLayerBlendMode', light, 'normal')
await call('moveLayer', light, null, folder)
await call('setLayerClipped', light, true)
await call('selectLayer', middle)
await checkMove('a layer in a folder that a layer is clipped to')
await call('setLayerClipped', light, false)

// A selected part, and a transform
await call('selectLayer', middle)
await call('moveLayer', middle, null, null)
await call('setLayerBlendMode', middle, 'difference')
await page.keyboard.press('s')
await drag(120, 40, 200, 160)
await waitIdle()
await checkMove('a selected part of a Difference layer')
await call('startTransform')
await page.waitForFunction(() => window.lydia.engine.getSnapshot().transform, { timeout: 30000 })
await checkMove('a selected part of a Difference layer, transformed (into a new layer)', { apply: true })
await call('deselect')
await call('startTransform')
await page.waitForFunction(() => window.lydia.engine.getSnapshot().transform, { timeout: 30000 })
await checkMove('a whole Difference layer, transformed', { apply: true })

// ----- On a transparent paper -----
;({ middle, light } = await paintLayers(true))
await checkMove('transparent paper: a Normal layer')
await call('setLayerBlendMode', middle, 'multiply')
await call('setLayerBlendMode', light, 'overlay')
await checkMove('transparent paper: a Multiply layer under an Overlay one')

check('no errors or warnings on the page', problems.length === 0, problems.slice(0, 5).join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
