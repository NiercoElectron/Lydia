// The tray: importing images and putting them into drawings as smart objects
import fs from 'node:fs'
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
// Press at one point of the paper and move through the others, without letting go
async function press(points) {
  const first = await pageOf(...points[0])
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  for (const [x, y] of points.slice(1)) {
    const p = await pageOf(x, y)
    await page.mouse.move(p.x, p.y, { steps: 4 })
  }
}
async function drag(points) {
  await press(points)
  await page.mouse.up()
  await sleep(50)
}
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
// The color in the projection (what the drawing has), and the color the screen shows right now
const shownAt = (x, y) => page.evaluate((x, y) => window.lydia.projection.colorAt(x, y), x, y)
const screenAt = (x, y) =>
  page.evaluate(
    (x, y) => {
      const { app, world } = window.lydia
      app.render()
      const gl = app.renderer.gl
      const r = app.renderer.resolution
      const p = world.toGlobal({ x, y })
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      const out = new Uint8Array(4)
      gl.readPixels(
        Math.floor(p.x * r),
        gl.drawingBufferHeight - Math.floor(p.y * r) - 1,
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        out,
      )
      return '#' + [...out.slice(0, 3)].map(v => v.toString(16).padStart(2, '0')).join('')
    },
    x,
    y,
  )
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

// ----- The tray: importing images and putting them into the drawing -----

// A PNG made in the page: the left half opaque red, the right half blue at half alpha
const makeImage = (name, width, height) => `(async () => {
  const c = new OffscreenCanvas(${width}, ${height}); const ctx = c.getContext('2d')
  ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, ${width / 2}, ${height})
  ctx.fillStyle = 'rgba(0, 0, 255, 0.5)'; ctx.fillRect(${width / 2}, 0, ${width / 2}, ${height})
  return new File([await c.convertToBlob()], '${name}', { type: 'image/png' })
})()`
// Drop files made in the page at a point of the window
const dropFiles = (images, x, y) =>
  page.evaluate(
    async (images, x, y) => {
      const files = await Promise.all(images.map(code => eval(code)))
      const data = new DataTransfer()
      for (const file of files) data.items.add(file)
      const target = document.elementFromPoint(x, y)
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: data }),
        )
      }
    },
    images,
    x,
    y,
  )
// Drag the tray's image number "index" to a point of the window and drop it (a made-up drag can't tell the dropEffect
// the page chose, so it is always dropped)
const dragFromTray = (index, x, y) =>
  page.evaluate(
    (index, x, y) => {
      const item = document.querySelectorAll('.tray-images li')[index]
      const data = new DataTransfer()
      item.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }))
      const target = document.elementFromPoint(x, y)
      const over = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        dataTransfer: data,
      })
      target.dispatchEvent(over)
      target.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: data }),
      )
    },
    index,
    x,
    y,
  )
const trayCount = () => page.evaluate(() => document.querySelectorAll('.tray-images li').length)
const isTrayOpen = () => page.evaluate(() => document.querySelector('.tray-panel') !== null)
const waitTransform = () =>
  page.waitForFunction(() => window.lydia.engine.getSnapshot().transform !== null, { timeout: 60000, polling: 10 })
const layerNames = async () => (await snapshot()).layers.map(l => l.name + (l.isSmart ? '*' : ''))

await page.evaluate(() => delete window.lydia)
await newDrawing(800, 600)
const trayButton = 'button.tray-button'
check(
  'the tray button is at the foot of the tool column',
  await page.$eval(
    trayButton,
    b => b.parentElement.classList.contains('tool-column') && b.getAttribute('aria-label') === 'Tray',
  ),
)
await page.click(trayButton)
await sleep(50)
check(
  'the button opens the tray, empty at first',
  (await isTrayOpen()) && (await page.$eval('.tray-panel', p => p.textContent.includes('Import images'))),
)
check('…and shows it is pressed', await page.$eval(trayButton, b => b.getAttribute('aria-pressed') === 'true'))
await page.click(trayButton)
await sleep(50)
check('pressing it again closes the tray', !(await isTrayOpen()))

// Dropped on the layers panel: only into the tray, which opens
const layersBox = await page.$eval('.layers-panel', p => {
  const r = p.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.bottom - 40 }
})
await dropFiles([makeImage('test.png', 200, 100)], layersBox.x, layersBox.y)
await page.waitForFunction(() => document.querySelectorAll('.tray-images li').length === 1, { timeout: 10000 })
check(
  'an image dropped on the window goes into the tray, which opens',
  (await isTrayOpen()) && (await trayCount()) === 1,
)
await sleep(200)
check(
  '…and away from the drawing, nothing is put into it',
  (await snapshot()).transform === null && (await snapshot()).layers.length === 1,
)
check(
  'its title has its name and size',
  await page.$eval('.tray-images li', li => li.title.startsWith('test (200 × 100)')),
)

// Dragged from the tray onto the drawing at (400, 300)
const at = await pageOf(400, 300)
await dragFromTray(
  0,
  ...Object.values(
    await page.$eval('.tray-panel', p => {
      const r = p.getBoundingClientRect()
      return { x: r.left + 20, y: r.top + 10 }
    }),
  ),
)
await sleep(300)
check("the tray itself doesn't take its own images", (await snapshot()).transform === null)
await dragFromTray(0, at.x, at.y)
await waitTransform()
check(
  'a dragged image shows with the handles',
  (await snapshot()).transform !== null && (await snapshot()).layers.length === 1,
)
check(
  '…centered where it was dropped: red at the left',
  (await screenAt(350, 300)) === '#ff0000' &&
    (await screenAt(305, 300)) === '#ff0000' &&
    (await screenAt(295, 300)) === '#ffffff',
  `${await screenAt(350, 300)} ${await screenAt(305, 300)} ${await screenAt(295, 300)}`,
)
const halfBlue = await screenAt(450, 300)
check('…and half blue at the right', /^#(7f|80)(7f|80)ff$/.test(halfBlue), halfBlue)
await keys('Enter')
await waitIdle()
await sleep(100)
let s = await snapshot()
check(
  'Enter puts it into a new smart object layer above, named after the file, and active',
  JSON.stringify(await layerNames()) === '["Layer 1","test*"]' && s.activeLayerId === s.layers[1].id,
  JSON.stringify(await layerNames()),
)
check(
  "its pixels are the image's own",
  (await shownAt(350, 300)) === '#ff0000' &&
    (await shownAt(300, 250)) === '#ff0000' &&
    (await shownAt(299, 300)) === '#ffffff' &&
    (await shownAt(499, 349)) === halfBlue &&
    (await shownAt(500, 300)) === '#ffffff' &&
    (await shownAt(400, 350)) === '#ffffff',
  `${await shownAt(300, 250)} ${await shownAt(499, 349)} ${await shownAt(500, 300)} ${await shownAt(400, 350)}`,
)
const smart = await page.evaluate(() => {
  const o = window.lydia.stack.layers[1].smart
  return { bounds: o.bounds, corners: o.corners, source: o.source.tiles.size }
})
check(
  "its source is the whole image at the paper's corner",
  JSON.stringify(smart.bounds) === '{"x":0,"y":0,"width":200,"height":100}' &&
    smart.corners[0].x === 300 &&
    smart.corners[0].y === 250 &&
    smart.source === 1,
  JSON.stringify(smart),
)
await click('Undo')
await waitIdle()
await sleep(100)
check(
  'one undo takes it all out',
  JSON.stringify(await layerNames()) === '["Layer 1"]' && (await shownAt(350, 300)) === '#ffffff',
)
await click('Redo')
await waitIdle()
await sleep(100)
check(
  'redo puts it back',
  JSON.stringify(await layerNames()) === '["Layer 1","test*"]' && (await shownAt(350, 300)) === '#ff0000',
)
check('the tray keeps the image', (await trayCount()) === 1)

// Esc leaves it out
const canUndoBefore = (await snapshot()).canUndo
await dragFromTray(0, (await pageOf(150, 150)).x, (await pageOf(150, 150)).y)
await waitTransform()
check('the same image goes in again from the tray', (await screenAt(120, 150)) === '#ff0000')
await keys('Escape')
await sleep(200)
s = await snapshot()
check(
  'Esc leaves it out',
  s.transform === null &&
    s.layers.length === 2 &&
    (await shownAt(120, 150)) === '#ffffff' &&
    (await screenAt(120, 150)) === '#ffffff' &&
    s.canUndo === canUndoBefore,
)

// A smart object moved and scaled on the way in: a corner dragged
await dragFromTray(0, (await pageOf(400, 450)).x, (await pageOf(400, 450)).y)
await waitTransform()
await drag([
  [500, 500],
  [600, 550],
]) // the bottom right corner (300..500 × 400..500), to make it bigger
await keys('Enter')
await waitIdle()
await sleep(100)
const scaled = await page.evaluate(() => window.lydia.stack.layers.at(-1).smart.corners)
check(
  'dragging a corner scales it before it goes in',
  Math.abs(scaled[2].x - scaled[0].x - 300) < 0.01 && Math.abs(scaled[2].y - scaled[0].y - 150) < 0.01,
  JSON.stringify(scaled),
)
// A corner keeps the proportions even when the pointer goes off the diagonal, and Shift lets them change
const sizeOf = q => [q[2].x - q[0].x, q[2].y - q[0].y].map(v => Math.round(v * 100) / 100)
for (const shift of [false, true]) {
  await dragFromTray(0, (await pageOf(400, 450)).x, (await pageOf(400, 450)).y)
  await waitTransform()
  if (shift) await page.keyboard.down('Shift')
  await drag([
    [500, 500],
    [700, 510],
  ]) // the bottom right corner (300..500 × 400..500), off its diagonal
  if (shift) await page.keyboard.up('Shift')
  await keys('Enter')
  await waitIdle()
  await sleep(100)
  const size = sizeOf(await page.evaluate(() => window.lydia.stack.layers.at(-1).smart.corners))
  if (shift)
    check('…and with Shift, it follows the pointer both ways', size[0] > 395 && size[1] < 115, JSON.stringify(size))
  else
    check(
      'a corner keeps the proportions when the pointer goes off the diagonal',
      Math.abs(size[0] / size[1] - 2) < 0.01 && size[0] > 300,
      JSON.stringify(size),
    )
  await click('Undo')
  await waitIdle()
  await sleep(100)
}
check('…and it goes above the active layer', JSON.stringify(await layerNames()) === '["Layer 1","test*","test*"]')

// Bigger than the paper: it keeps its size, going past the paper (decision 49)
const centerOnScreen = await pageOf(400, 300)
await dropFiles([makeImage('wide.png', 1600, 400)], centerOnScreen.x, centerOnScreen.y)
await waitTransform()
check(
  'an image dropped from outside onto the drawing goes into the tray and into the drawing',
  (await trayCount()) === 2 && (await snapshot()).transform !== null,
)
await keys('Enter')
await waitIdle()
await sleep(100)
const wide = await page.evaluate(() => {
  const o = window.lydia.stack.layers.at(-1).smart
  return { bounds: o.bounds, corners: o.corners }
})
check(
  'an image bigger than the paper keeps its size, centered where it was dropped',
  JSON.stringify(wide.bounds) === '{"x":0,"y":0,"width":1600,"height":400}' &&
    wide.corners[0].x === -400 &&
    wide.corners[0].y === 100,
  JSON.stringify(wide),
)
check('…keeping its colors', (await shownAt(100, 300)) === '#ff0000')
await keys('Control', 'z')
await waitIdle()
await sleep(100) // out again, so the paper is as the rest expects

// A hidden active layer doesn't show while an image is placed above it
await page.evaluate(() => {
  const e = window.lydia.engine
  e.selectLayer(e.getSnapshot().layers[2].id)
  e.setLayerVisible(e.getSnapshot().layers[2].id, false)
})
await waitIdle()
await sleep(100)
const hiddenBefore = await screenAt(350, 500)
await dragFromTray(0, (await pageOf(700, 100)).x, (await pageOf(700, 100)).y)
await waitTransform()
check(
  'a hidden active layer stays hidden while an image is put above it',
  (await screenAt(350, 500)) === hiddenBefore && (await screenAt(650, 100)) === '#ff0000',
  `${hiddenBefore} → ${await screenAt(350, 500)}`,
)
await keys('Escape')
await sleep(100)

// While one image is being put in, another can't start
await dragFromTray(0, (await pageOf(700, 100)).x, (await pageOf(700, 100)).y)
await waitTransform()
await dragFromTray(1, (await pageOf(100, 500)).x, (await pageOf(100, 500)).y)
await sleep(300)
check(
  'a second image waits for the first one to be done',
  (await snapshot()).transform !== null && (await screenAt(100, 500)) !== '#ff0000',
)
await keys('Escape')
await sleep(100)

// Taking an image out of the tray
await page.hover('.tray-images li')
await page.click('.tray-images li .tray-remove')
await sleep(50)
check('× takes an image out of the tray', (await trayCount()) === 1)

// Not an image
let alerted = ''
page.once('dialog', async d => {
  alerted = d.message()
  await d.dismiss()
})
await dropFiles([`new File(['hello'], 'notes.png', { type: 'image/png' })`], layersBox.x, layersBox.y)
await sleep(500)
check("a file that isn't an image says so", alerted.includes('notes.png') && (await trayCount()) === 1, alerted)

// The tray stays from one drawing to the next
page.once('dialog', d => d.accept())
await click('Back')
await sleep(300)
await page.evaluate(() => delete window.lydia)
await newDrawing(400, 300)
await page.click(trayButton)
await sleep(50)
check('the tray is the same in the next drawing', (await trayCount()) === 1)

// A big one: a 6000×6000 photo-like image on a 10000² paper
page.once('dialog', d => d.accept())
await click('Back')
await sleep(300)
await page.evaluate(() => delete window.lydia)
await newDrawing(10000, 10000)
await page.click(trayButton)
await sleep(50)
const noisy = `(async () => {
  const c = new OffscreenCanvas(6000, 6000); const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, 6000, 6000); g.addColorStop(0, '#ff8800'); g.addColorStop(1, '#0044ff')
  ctx.fillStyle = g; ctx.fillRect(0, 0, 6000, 6000)
  for (let i = 0; i < 4000; i++) { ctx.fillStyle = 'hsl(' + (i * 37 % 360) + ' 80% 50%)'; ctx.fillRect((i * 7919) % 6000, (i * 104729) % 6000, 40, 40) }
  return new File([await c.convertToBlob()], 'photo.png', { type: 'image/png' })
})()`
await dropFiles([noisy], layersBox.x, layersBox.y)
await page.waitForFunction(
  () => [...document.querySelectorAll('.tray-images li')].some(li => li.title.startsWith('photo')),
  { timeout: 60000 },
)
const bigAt = await pageOf(5000, 5000)
await page.evaluate(() => {
  window.__frames = []
  let last = performance.now()
  const tick = now => {
    window.__frames.push(now - last)
    last = now
    if (window.__frames.length < 5000) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
const t0 = Date.now()
await dragFromTray(1, bigAt.x, bigAt.y)
await waitTransform()
const shownIn = Date.now() - t0
const t1 = Date.now()
await keys('Enter')
await waitIdle()
const appliedIn = Date.now() - t1
const worst = await page.evaluate(() => Math.max(...window.__frames.slice(1)))
check(
  'a 6000×6000 image on a 10000² paper',
  (await snapshot()).layers.length === 2,
  `handles after ${shownIn} ms, applied in ${appliedIn} ms, longest frame ${worst.toFixed(0)} ms`,
)

console.log(problems.length ? 'problems: ' + problems.slice(0, 8).join(' | ') : 'no errors or warnings in the console')
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
