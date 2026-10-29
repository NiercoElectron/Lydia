// Clipping layers: the button and Ctrl+Alt+G, clipped while painting on it or on its base, a hidden base, opacity,
// blend mode, undo, a new layer inside the group, deleting and moving the base, saved, copied, merged down
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
    const input = document.querySelector('input[type=color]')
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
const snap = () =>
  page.evaluate(() => window.lydia.engine.getSnapshot().layers.map(l => ({ name: l.name, clipped: l.clipped })))
const BLUE = '#0000ff',
  RED = '#ff0000',
  WHITE = '#ffffff'
const selectLayer = async id => {
  await page.evaluate(id => window.lydia.engine.selectLayer(id), id)
  await sleep(100)
}
const clipButton = name =>
  page.evaluateHandle(
    name =>
      [...document.querySelectorAll('.layers-list li')]
        .find(li => li.textContent.includes(name))
        .querySelector('button[title*="lip"]'),
    name,
  )

await newDrawing(300, 200)
await page.evaluate(() =>
  [...document.querySelectorAll('button.brush')].find(b => b.textContent.trim().startsWith('Hard round')).click(),
)
await sleep(300)
await setSize(20)
await setColor(RED)
await sleep(80)
await drag(20, 30, 280, 30) // the base: a red stripe
const base = await activeId()
await click('New layer')
await sleep(200)
await setColor(BLUE)
await sleep(80)
await drag(150, 5, 150, 190) // across it
const top = await activeId()

check("the bottom layer can't be clipped", await page.evaluate(b => b.disabled, await clipButton('Layer 1')))
await (await clipButton('Layer 2')).click()
await waitIdle()
check('the clip button clips it', (await snap()).map(l => l.clipped).join() === 'false,true')
check(
  '…shown moved in, with the arrow',
  await page.evaluate(() => {
    const li = document.querySelector('.layers-list li.clipped')
    return !!li && !!li.querySelector('.clip-arrow') && li.textContent.includes('Layer 2')
  }),
)
check(
  'it shows only where the base has paint',
  (await colorAt(150, 30)) === BLUE && (await colorAt(150, 100)) === WHITE && (await colorAt(60, 30)) === RED,
)

// Painting on the clipped layer: clipped while painting too
await setColor('#00ff00')
await sleep(80)
const live = {}
await drag(80, 10, 80, 120, async () => {
  live.on = await colorAt(80, 30)
  live.off = await colorAt(80, 100)
})
await waitIdle()
check('painting on it: clipped while painting', live.on === '#00ff00' && live.off === WHITE, `${live.on} ${live.off}`)
check('…and after', (await colorAt(80, 30)) === '#00ff00' && (await colorAt(80, 100)) === WHITE)

// Painting on the base shows more of the clipped layer, while painting too
await selectLayer(base)
await setColor(RED)
await sleep(80)
await drag(20, 100, 280, 100, async () => {
  live.revealed = await colorAt(150, 100)
})
await waitIdle()
check('painting on the base reveals the clipped layer while painting', live.revealed === BLUE, live.revealed)
check('…and after', (await colorAt(150, 100)) === BLUE && (await colorAt(150, 160)) === WHITE)

// A hidden base hides the layers clipped to it
await page.evaluate(id => window.lydia.engine.setLayerVisible(id, false), base)
await waitIdle()
check('hiding the base hides the clipped layer too', (await colorAt(150, 30)) === WHITE)
await page.evaluate(id => window.lydia.engine.setLayerVisible(id, true), base)
await waitIdle()

// Its opacity, while the slider moves and after
await selectLayer(top)
await page.evaluate(id => window.lydia.engine.setLayerOpacity(id, 0.5), top)
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
const purple = c => ['#800080', '#7f0080', '#80007f', '#7f007f'].includes(c)
const liveHalf = [await shown(150, 30), await shown(150, 160)]
check(
  'at 50% while the slider moves: blue half over red, still clipped',
  purple(liveHalf[0]) && liveHalf[1] === WHITE,
  liveHalf.join(),
)
await page.evaluate(() => window.lydia.engine.finishLayerOpacity())
await waitIdle()
check('…and once let go', purple(await colorAt(150, 30)) && (await colorAt(150, 160)) === WHITE, await colorAt(150, 30))
await undo()

// With a blend mode
await page.evaluate(id => window.lydia.engine.setLayerBlendMode(id, 'multiply'), top)
await waitIdle()
check(
  'a clipped Multiply layer: red times blue is black, nothing outside',
  (await colorAt(150, 30)) === '#000000' && (await colorAt(150, 160)) === WHITE,
)
await undo()

// Ctrl+Alt+G, and undo
await page.keyboard.down('Control')
await page.keyboard.down('Alt')
await page.keyboard.press('g')
await page.keyboard.up('Alt')
await page.keyboard.up('Control')
await waitIdle()
check('Ctrl+Alt+G unclips it: all its paint shows', !(await snap())[1].clipped && (await colorAt(150, 160)) === BLUE)
await undo()
check('undo clips it again', (await snap())[1].clipped && (await colorAt(150, 160)) === WHITE)

// A new layer between the base and a clipped layer is clipped too, so the group stays
await selectLayer(base)
await click('New layer')
await sleep(200)
check('a new layer inside the group is clipped too', (await snap()).map(l => l.clipped).join() === 'false,true,true')
check(
  '…and the clipped layer above still shows as before',
  (await colorAt(150, 30)) === BLUE && (await colorAt(150, 160)) === WHITE,
)
await undo()

// Deleting the base: the clipped layer becomes the bottom one, so nothing clips it
await selectLayer(base)
await click('Delete layer')
await waitIdle()
check(
  "the base deleted: the layer at the bottom isn't clipped",
  !(await snap())[0].clipped && (await colorAt(150, 160)) === BLUE,
)
await undo()
check(
  'undo brings the base back, and the clipping',
  (await snap()).map(l => l.clipped).join() === 'false,true' && (await colorAt(150, 160)) === WHITE,
)

// Moving it to the bottom does the same
await page.evaluate(id => window.lydia.engine.moveLayer(id, null, null), top)
await waitIdle()
check('moved to the bottom: not clipped, all its paint shows', (await colorAt(150, 160)) === BLUE)
await undo()
check('undo: clipped again', (await colorAt(150, 160)) === WHITE)

// Saved with the drawing, kept by a copy
const saved = await page.evaluate(async () => {
  const { parseProject } = await import('/src/engine/projectFile.ts')
  return parseProject(await (await window.lydia.engine.saveProject()).arrayBuffer()).layers.map(l => l.clipped === true)
})
check('saved with the drawing', saved.join() === 'false,true', saved.join())
await selectLayer(top)
await page.evaluate(() => window.lydia.engine.duplicateLayer())
await waitIdle()
check('a copy is clipped too', (await snap()).map(l => l.clipped).join() === 'false,true,true')
await undo()

// Merging down onto the base: the picture stays, the paint outside the base is gone
await selectLayer(top)
const before = [await colorAt(150, 30), await colorAt(150, 100), await colorAt(150, 160), await colorAt(80, 30)]
await page.evaluate(() => window.lydia.engine.mergeDown())
await waitIdle()
const after = [await colorAt(150, 30), await colorAt(150, 100), await colorAt(150, 160), await colorAt(80, 30)]
check(
  'merged onto the base: the same picture',
  before.join() === after.join() && (await snap()).length === 1,
  `${before.join()} -> ${after.join()}`,
)
await page.evaluate(id => window.lydia.engine.setLayerVisible(id, true), base)
await undo()
check('undo brings the clipped layer back', (await snap()).map(l => l.clipped).join() === 'false,true')

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
