// The move tool: its button, key and bar; moving the whole layer, shown on the screen while it is dragged; undo and
// redo; moving the selected part, with the selection moving along; a layer above covering the moved part while it is
// dragged; Shift keeping it straight; paint moved off the paper; a click doing nothing; and a whole 10000² layer
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
const stroke = (points, color, size, tool = 'brush') =>
  page.evaluate(
    async (points, color, size, tool) => {
      const library = await import('/src/brushLibrary.ts')
      const brush = library.builtInBrush('hard-round')
      const { engine } = window.lydia
      engine.setBrushTip(await library.tipOf(brush), brush.preset)
      engine.setBrush({ size, color, tool, opacity: 1 })
      window.lydia.brush.startStroke(points[0][0], points[0][1], 1)
      window.lydia.brush.continueStroke(points.slice(1).map(([x, y]) => ({ x, y, pressure: 1 })))
      window.lydia.brush.endStroke()
    },
    points,
    color,
    size,
    tool,
  )
// A block of color: wide strokes side by side
async function block(left, top, right, bottom, color) {
  for (let y = top + 10; y < bottom; y += 15)
    await stroke(
      [
        [left + 10, y],
        [right - 10, y],
      ],
      color,
      20,
    )
}

await newDrawing(1500, 1000)

// ----- The button, the key and the bar -----
const labels = await page.$$eval('.tool-column button', bs => bs.map(b => b.getAttribute('aria-label')))
check('the column has Move', labels.includes('Move'), labels.join())
await page.keyboard.press('v')
await sleep(50)
check(
  'V chooses Move',
  (await page.$eval('.tool-column button[aria-pressed=true]', b => b.getAttribute('aria-label'))) === 'Move',
)
const bar = await page.$eval('.toolbar', t => t.textContent)
check('the bar has no Size or Opacity', !bar.includes('Size') && !bar.includes('Opacity'), bar)

// ----- The whole layer -----
await block(200, 200, 400, 400, '#ff0000')
await waitIdle()
check('a red block to move', (await shownAt(300, 300)) === '#ff0000' && (await shownAt(500, 450)) === '#ffffff')
await page.keyboard.press('v')
const steps = (await snapshot()).canUndo
await press([
  [300, 300],
  [400, 350],
  [500, 400],
])
await sleep(300)
const during = {
  moved: await screenAt(500, 450),
  old: await screenAt(250, 250),
  drawing: await shownAt(250, 250),
  task: (await snapshot()).task,
}
check(
  'while dragged, the screen shows the layer at its new place, and nothing at the old one',
  during.moved === '#ff0000' && during.old === '#ffffff',
  JSON.stringify(during),
)
check(
  "…while the drawing itself hasn't changed yet",
  during.drawing === '#ff0000' && during.task === 'Moving…',
  JSON.stringify(during),
)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/move-dragging.png' })
await page.mouse.up()
await waitIdle()
check(
  'let go, the layer is at its new place',
  (await shownAt(500, 450)) === '#ff0000' &&
    (await shownAt(250, 250)) === '#ffffff' &&
    (await shownAt(585, 485)) === '#ff0000',
  `${await shownAt(500, 450)} ${await shownAt(250, 250)}`,
)
check(
  '…and the screen shows the same',
  (await screenAt(500, 450)) === '#ff0000' && (await screenAt(250, 250)) === '#ffffff',
)
await keys('Control', 'z')
await waitIdle()
check('Ctrl+Z puts it back', (await shownAt(250, 250)) === '#ff0000' && (await shownAt(500, 450)) === '#ffffff')
await keys('Control', 'Shift', 'z')
await waitIdle()
check('Ctrl+Shift+Z moves it again', (await shownAt(500, 450)) === '#ff0000' && (await shownAt(250, 250)) === '#ffffff')
await keys('Control', 'z')
await waitIdle()

// ----- A click does nothing -----
const before = await snapshot()
const p = await pageOf(300, 300)
await page.mouse.click(p.x, p.y)
await sleep(100)
const after = await snapshot()
check(
  'a click with the move tool changes nothing and adds no undo step',
  after.canRedo === before.canRedo && after.task === null && (await shownAt(300, 300)) === '#ff0000',
)

// ----- The selected part -----
await page.keyboard.press('s')
await drag([
  [150, 150],
  [300, 450],
]) // the left half of the block
await page.keyboard.press('v')
await press([
  [250, 300],
  [450, 300],
  [650, 350],
]) // 400 to the right, 50 down
await sleep(300)
const partDuring = { moved: await screenAt(650, 330), left: await screenAt(350, 300), old: await screenAt(250, 300) }
check(
  'while dragged, the selected part shows at its new place, and the rest stays',
  partDuring.moved === '#ff0000' && partDuring.left === '#ff0000' && partDuring.old === '#ffffff',
  JSON.stringify(partDuring),
)
await page.mouse.up()
await waitIdle()
check(
  'moving with a selection moves only the selected part',
  (await shownAt(650, 330)) === '#ff0000' &&
    (await shownAt(250, 300)) === '#ffffff' &&
    (await shownAt(350, 300)) === '#ff0000',
  `${await shownAt(650, 330)} ${await shownAt(250, 300)} ${await shownAt(350, 300)}`,
)
check(
  '…and the selection moves along',
  (await selectedAt(650, 450)) === 255 && (await selectedAt(250, 300)) === 0,
  `${await selectedAt(650, 450)} ${await selectedAt(250, 300)}`,
)
await keys('Control', 'z')
await waitIdle()
check(
  'Ctrl+Z puts back the paint and the selection',
  (await shownAt(250, 300)) === '#ff0000' &&
    (await shownAt(650, 330)) === '#ffffff' &&
    (await selectedAt(250, 300)) === 255 &&
    (await selectedAt(650, 450)) === 0,
)
await keys('Control', 'd')

// ----- The brush in a selection doesn't fill the selected part of a tile on its edge -----
await page.keyboard.press('s')
await drag([
  [1000.3, 600.3],
  [1400.6, 900.6],
])
await stroke(
  [
    [950, 700],
    [1450, 700],
  ],
  '#00ff00',
  20,
)
await waitIdle()
check(
  'the brush paints only its stroke inside the selection',
  (await shownAt(1200, 700)) === '#00ff00' &&
    (await shownAt(1100, 850)) === '#ffffff' &&
    (await shownAt(1300, 650)) === '#ffffff',
  `${await shownAt(1100, 850)} ${await shownAt(1300, 650)}`,
)
await keys('Control', 'z')
await keys('Control', 'd')
await waitIdle()

// ----- A layer above covers the moved part -----
await page.evaluate(() => window.lydia.engine.addLayer())
await block(700, 200, 900, 400, '#0000ff')
await waitIdle()
const ids = (await snapshot()).layers.map(l => l.id)
await page.evaluate(id => window.lydia.engine.selectLayer(id), ids[0])
await page.keyboard.press('v')
await press([
  [300, 300],
  [500, 300],
  [700, 300],
]) // the red block half under the blue one
await sleep(300)
const covered = { overlap: await screenAt(750, 300), red: await screenAt(650, 300) }
check(
  'while dragged, a layer above covers the moved part',
  covered.overlap === '#0000ff' && covered.red === '#ff0000',
  JSON.stringify(covered),
)
await page.mouse.up()
await waitIdle()
check(
  '…and once let go too',
  (await shownAt(750, 300)) === '#0000ff' &&
    (await shownAt(650, 300)) === '#ff0000' &&
    (await shownAt(300, 300)) === '#ffffff',
)
await keys('Control', 'z')
await waitIdle()

// ----- Shift keeps it straight -----
await page.keyboard.down('Shift')
await drag([
  [300, 300],
  [450, 330],
  [600, 360],
]) // mostly to the right
await page.keyboard.up('Shift')
await waitIdle()
check(
  'with Shift, it only moves across',
  (await shownAt(550, 210)) === '#ff0000' &&
    (await shownAt(550, 395)) === '#ff0000' &&
    (await shownAt(550, 420)) === '#ffffff',
  `${await shownAt(550, 210)} ${await shownAt(550, 420)}`,
)
await keys('Control', 'z')
await waitIdle()
// A path that starts across and then wanders down more than across stays across
await page.keyboard.down('Shift')
await drag([
  [300, 300],
  [360, 305],
  [400, 330],
  [420, 480],
])
await page.keyboard.up('Shift')
await waitIdle()
check(
  'with Shift, the direction chosen first is kept',
  (await shownAt(500, 210)) === '#ff0000' &&
    (await shownAt(500, 420)) === '#ffffff' &&
    (await shownAt(250, 300)) === '#ffffff',
  `${await shownAt(500, 210)} ${await shownAt(500, 420)} ${await shownAt(250, 300)}`,
)
await keys('Control', 'z')
await waitIdle()

// ----- Off the paper -----
await drag([
  [300, 300],
  [150, 300],
  [0, 300],
]) // 300 to the left: half the block goes off
await waitIdle()
check(
  'paint moved off the paper leaves the paper',
  (await shownAt(5, 300)) === '#ff0000' && (await shownAt(300, 300)) === '#ffffff',
)
await drag([
  [50, 300],
  [200, 300],
  [350, 300],
]) // back to the right
await waitIdle()
check(
  '…and comes back whole when moved back (decision 49)',
  (await shownAt(350, 300)) === '#ff0000' &&
    (await shownAt(205, 300)) === '#ff0000' &&
    (await shownAt(195, 300)) === '#ffffff',
  `${await shownAt(350, 300)} ${await shownAt(205, 300)} ${await shownAt(195, 300)}`,
)

// ----- A hidden layer isn't moved -----
await page.evaluate(id => window.lydia.engine.setLayerVisible(id, false), ids[1])
await page.evaluate(id => window.lydia.engine.selectLayer(id), ids[1])
const hiddenBefore = await snapshot()
await drag([
  [800, 300],
  [900, 300],
  [1000, 300],
])
await sleep(100)
check(
  "a hidden layer isn't moved",
  (await snapshot()).canRedo === hiddenBefore.canRedo &&
    JSON.stringify((await snapshot()).layers) === JSON.stringify(hiddenBefore.layers) &&
    !(await snapshot()).task,
)

// ----- 10000×10000 -----
await page.evaluate(() => {
  window.confirm = () => true
})
await click('Back')
await sleep(300)
await newDrawing(10000, 10000)
await page.keyboard.press('f')
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#3060c0', opacity: 1 }))
const fillAt = await pageOf(5000, 5000)
await page.mouse.click(fillAt.x, fillAt.y)
await waitIdle()
check('a whole 10000² layer to move', (await shownAt(100, 100)) === '#3060c0')
await page.keyboard.press('v')
// Frame lengths, recorded while it is lifted and while it is put down (not while a frame is measured below)
const record = () =>
  page.evaluate(() => {
    window.frames30 ??= []
    let last = performance.now()
    const loop = now => {
      if (!window.recording30) return
      window.frames30.push(now - last)
      last = now
      requestAnimationFrame(loop)
    }
    window.recording30 = true
    requestAnimationFrame(loop)
  })
const stopRecording = () =>
  page.evaluate(() => {
    window.recording30 = false
  })
await record()
const startDrag = Date.now()
await press([
  [5000, 5000],
  [5200, 5100],
  [5400, 5300],
])
await page.waitForFunction(
  () => {
    const { app, world } = window.lydia
    app.render()
    const gl = app.renderer.gl
    const p = world.toGlobal({ x: 100, y: 100 })
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const out = new Uint8Array(4)
    gl.readPixels(Math.floor(p.x), gl.drawingBufferHeight - Math.floor(p.y) - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out)
    return out[0] > 200 && out[1] > 200 && out[2] > 200 // the paper shows where the layer moved away
  },
  { timeout: 30000, polling: 20 },
)
const shownAfter = Date.now() - startDrag
await stopRecording()
const dragFrame = await page.evaluate(() => {
  const { app, world } = window.lydia
  const t = performance.now()
  for (let i = 0; i < 20; i++) {
    world.position.x += 1
    app.render()
  }
  app.renderer.gl.readPixels(0, 0, 1, 1, app.renderer.gl.RGBA, app.renderer.gl.UNSIGNED_BYTE, new Uint8Array(4))
  return (performance.now() - t) / 20
})
await record()
const release = Date.now()
await page.mouse.up()
await waitIdle()
const committed = Date.now() - release
const frames = await page.evaluate(() => {
  window.recording30 = false
  return window.frames30
})
check('the moved 10000² layer shows soon after the drag starts', shownAfter < 3000, `${shownAfter} ms`)
check('a frame while it is dragged stays short', dragFrame < 16, `${dragFrame.toFixed(1)} ms`)
check('putting it down is done in a few seconds', committed < 8000, `${committed} ms`)
check(
  'no frame freezes on the way',
  Math.max(...frames) < 100,
  `worst ${Math.max(...frames).toFixed(0)} ms of ${frames.length}`,
)
check(
  'the 10000² layer was moved',
  (await shownAt(100, 100)) === '#ffffff' &&
    (await shownAt(500, 400)) === '#3060c0' &&
    (await shownAt(9999, 9999)) === '#3060c0',
)

console.log(problems.length ? 'problems:\n' + problems.slice(0, 8).join('\n') : 'no errors or warnings in the console')
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
