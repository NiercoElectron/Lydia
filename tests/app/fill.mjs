// The fill bucket: its button, key, cursor and settings; filling an empty layer, inside a line on another layer with
// and without Expand (no light rim), tolerance, undo, opacity on a transparent paper, Alt; and how long it takes on
// 10000×10000, with the screen still drawing frames meanwhile
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
const browser = await puppeteer.launch(LAUNCH)
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

async function newDrawing(width, height, transparent) {
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
  // The window remembers the last choice: set it either way
  const isTransparent = await page.$eval(
    'dialog',
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
async function back() {
  await page.evaluate(() => {
    window.confirm = () => true
  })
  await click('Back')
  await sleep(300)
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
const shownAt = (x, y) => page.evaluate((x, y) => window.lydia.projection.colorAt(x, y), x, y)
const snapshot = () => page.evaluate(() => window.lydia.engine.getSnapshot())
// The Hard round brush, and a stroke through these points straight through the engine
const stroke = (points, color, size) =>
  page.evaluate(
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
const ring = (cx, cy, r) =>
  Array.from({ length: 181 }, (_, i) => [cx + r * Math.cos((i * Math.PI) / 90), cy + r * Math.sin((i * Math.PI) / 90)])
// Click with the fill bucket and wait until the fill is done; returns how long it took and the longest time between
// two frames meanwhile
async function fillAt(x, y) {
  await page.evaluate(() => {
    window.frameGaps = []
    let last = performance.now()
    const tick = now => {
      window.frameGaps.push(now - last)
      last = now
      if (window.measuring) requestAnimationFrame(tick)
    }
    window.measuring = true
    requestAnimationFrame(tick)
    window.fillStart = performance.now()
  })
  const p = await pageOf(x, y)
  await page.mouse.click(p.x, p.y)
  // Done once the fill is worked out, painted in, and shown (a big one is put together out of sight first)
  await page.waitForFunction(() => !window.lydia.engine.getSnapshot().task && !window.lydia.projection.isUpdating(), {
    timeout: 120000,
    polling: 10,
  })
  return page.evaluate(() => {
    window.measuring = false
    return { ms: performance.now() - window.fillStart, worstFrame: Math.max(0, ...window.frameGaps) }
  })
}
const setSlider = (label, value) =>
  page.evaluate(
    (label, value) => {
      const input = [...document.querySelectorAll('.toolbar label')]
        .find(l => l.textContent.startsWith(label))
        .querySelector('input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    label,
    value,
  )
const setColor = color => page.evaluate(color => window.lydia.engine.setBrush({ color, opacity: 1 }), color)
const near = (a, b) =>
  [1, 3, 5].every(i => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 1)
const brightness = hex => [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0)

// ----- The button, the key, the cursor and the settings -----
await newDrawing(1500, 1000, false)
const labels = await page.$$eval('.tool-column button', bs => bs.map(b => b.getAttribute('aria-label')).join())
check('the column has the fill bucket after the eraser', labels.startsWith('Brush,Eraser,Fill,'), labels)
await page.keyboard.press('f')
await sleep(50)
check(
  'F chooses the fill bucket',
  (await page.$eval('.tool-column button[aria-pressed=true]', b => b.getAttribute('aria-label'))) === 'Fill',
)
const c = await pageOf(750, 500)
await page.mouse.move(c.x, c.y)
check(
  'its cursor is the bucket, pointing at its drop',
  await page.evaluate(() => window.lydia.app.canvas.style.cursor.includes('20 21')),
)
const bar = await page.$eval('.toolbar', t => t.textContent)
check(
  'the bar shows Tolerance 32, Look at All layers, Expand 20 px, and no Size',
  bar.includes('Tolerance32') &&
    bar.includes('Expand20 px') &&
    !bar.includes('Size') &&
    (await page.$$eval(
      '.toolbar button',
      bs => bs.find(b => b.textContent === 'All layers').getAttribute('aria-pressed') === 'true',
    )),
  bar,
)

// ----- An empty layer -----
await setColor('#3366cc')
let t = await fillAt(750, 500)
check(
  'filling an empty layer fills all of it',
  (await shownAt(5, 5)) === '#3366cc' &&
    (await shownAt(1495, 995)) === '#3366cc' &&
    (await shownAt(750, 500)) === '#3366cc',
  `${t.ms.toFixed(0)} ms`,
)
check('…as one step that can be undone', (await snapshot()).canUndo)
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await sleep(100)
check('undo takes it away', (await shownAt(750, 500)) === '#ffffff' && !(await snapshot()).canUndo)

// ----- A line on the layer above, the color on the layer below -----
await page.evaluate(() => window.lydia.engine.addLayer()) // Layer 2, on top: the line
await stroke(ring(400, 400, 150), '#000000', 12)
const layers = (await snapshot()).layers
await page.evaluate(id => window.lydia.engine.selectLayer(id), layers[0].id) // back to Layer 1, under the line
await setColor('#3366cc')
await setSlider('Expand', 0)
t = await fillAt(400, 400)
check(
  'inside the line, with All layers: the inside is filled',
  (await shownAt(400, 400)) === '#3366cc' && (await shownAt(400 + 100, 400)) === '#3366cc',
  `${t.ms.toFixed(0)} ms`,
)
check(
  'outside stays as it was, and the line too',
  (await shownAt(700, 700)) === '#ffffff' && (await shownAt(550, 400)) === '#000000',
)
// Pixels around the inside edge of the line brighter than the fill: a light rim
const rim = () =>
  page.evaluate(() => {
    const { projection } = window.lydia
    let bright = 0
    for (let a = 0; a < 360; a += 2) {
      for (let r = 138; r <= 146; r += 0.5) {
        const hex = projection.colorAt(400 + r * Math.cos((a * Math.PI) / 180), 400 + r * Math.sin((a * Math.PI) / 180))
        const sum = [1, 3, 5].reduce((s, i) => s + parseInt(hex.slice(i, i + 2), 16), 0)
        if (sum > 51 + 102 + 204 + 20) bright++
      }
    }
    return bright
  })
const rimWithout = await rim()
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await sleep(100)
await setSlider('Expand', 20)
await fillAt(400, 400)
const rimWith = await rim()
check(
  'without Expand a light rim shows inside the line; with it, it is gone',
  rimWithout > 0 && rimWith === 0,
  `light pixels at the edge: ${rimWithout} → ${rimWith}`,
)
check(
  "the fill went into the layer under the line, not the line's layer",
  await page.evaluate(id => {
    const { stack, gpu, app } = window.lydia
    const line = stack.layers.find(l => l.id !== id)
    const texture = gpu.getTexture(line, 1, 1, false)
    const pixels = app.renderer.extract.pixels(texture).pixels
    const i = ((400 - 256) * 256 + (400 - 256)) * 4
    return pixels[i + 3] === 0
  }, layers[0].id),
)
await page.screenshot({ path: OUT + '/fill-ring.png' })

// ----- Tolerance, on a layer of its own (This layer) -----
await page.evaluate(() => window.lydia.engine.addLayer())
await stroke(
  [
    [300, 750],
    [300, 751],
  ],
  '#808080',
  200,
)
await stroke(
  [
    [480, 750],
    [480, 751],
  ],
  '#949494',
  200,
)
await click('This layer')
await setColor('#e04020')
await setSlider('Tolerance', 32)
await fillAt(300, 750)
check(
  'Tolerance 32: both grays (20 apart) are filled',
  (await shownAt(300, 750)) === '#e04020' && (await shownAt(520, 750)) === '#e04020',
)
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await sleep(100)
await setSlider('Tolerance', 10)
await fillAt(300, 750)
check(
  'Tolerance 10: only the gray clicked',
  (await shownAt(300, 750)) === '#e04020' && (await shownAt(520, 750)) === '#949494',
  await shownAt(520, 750),
)
check(
  'This layer: the fill stops at the edge of the gray, not at the line or the paper',
  (await shownAt(300, 600)) !== '#e04020',
)

// ----- A soft line and its fill on the same layer: the fill goes behind the soft edge -----
await page.evaluate(() => window.lydia.engine.addLayer())
await page.evaluate(async () => {
  const library = await import('/src/brushLibrary.ts')
  const soft = library.builtInBrush('soft-round')
  const { engine, brush } = window.lydia
  engine.setBrushTip(await library.tipOf(soft), soft.preset)
  engine.setBrush({ size: 40, color: '#000000', tool: 'brush', opacity: 1 })
  const points = Array.from({ length: 181 }, (_, i) => ({
    x: 1150 + 150 * Math.cos((i * Math.PI) / 90),
    y: 450 + 150 * Math.sin((i * Math.PI) / 90),
    pressure: 1,
  }))
  brush.startStroke(points[0].x, points[0].y, 1)
  brush.continueStroke(points.slice(1))
  brush.endStroke()
})
await click('This layer')
await setSlider('Tolerance', 32)
// Along lines from inside the circle to the middle of the line: how much white shows (green and blue, which neither the
// red fill nor the black line has), and how many pixels are between red and black
const softEdge = () =>
  page.evaluate(() => {
    const { projection } = window.lydia
    let white = 0
    let between = 0
    for (let a = 0; a < 360; a += 10) {
      for (let r = 100; r <= 150; r += 0.5) {
        const hex = projection.colorAt(
          1150 + r * Math.cos((a * Math.PI) / 180),
          450 + r * Math.sin((a * Math.PI) / 180),
        )
        const [red, green, blue] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
        white = Math.max(white, green, blue)
        if (red > 40 && red < 215 && green < 10) between++
      }
    }
    return { white, between }
  })
await setColor('#ff0000')
await setSlider('Expand', 0)
await fillAt(1150, 450)
const withoutBehind = await softEdge()
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await sleep(100)
await setSlider('Expand', 20)
await fillAt(1150, 450)
const behind = await softEdge()
check(
  'a soft line on the same layer: without the edge, white shows between the color and the line',
  withoutBehind.white > 40,
  JSON.stringify(withoutBehind),
)
check(
  'with the edge, the color goes behind the soft edge: no white, and red fades into black',
  behind.white <= 8 && behind.between >= 36,
  JSON.stringify(behind),
)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/fill-soft.png' })
await click('All layers')

// ----- Alt picks a color -----
await page.mouse.move(c.x, c.y)
await page.keyboard.down('Alt')
check(
  'Alt with the fill bucket shows the eyedropper',
  await page.evaluate(() => window.lydia.app.canvas.style.cursor.includes('2 22')),
)
const ring1 = await pageOf(550, 400)
await page.mouse.click(ring1.x, ring1.y)
await page.keyboard.up('Alt')
await sleep(100)
check(
  'Alt + click picks the color instead of filling',
  (await page.$eval('input.color-hex', i => i.value)) === '#000000' && !(await snapshot()).task,
)

// ----- Opacity, on a transparent paper -----
await back()
await newDrawing(1500, 1000, true)
await page.keyboard.press('f')
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#3366cc', opacity: 0.5 }))
await fillAt(700, 500)
check(
  'a fill at 50% opacity on a transparent paper: its color, half see-through',
  (await page.evaluate(() => {
    const { app, projection } = window.lydia
    const pixels = app.renderer.extract.pixels(projection.tiles.get('2,1')).pixels
    return Math.abs(pixels[3] - 128) <= 1
  })) && near(await shownAt(700, 500), '#3366cc'),
  await shownAt(700, 500),
)

// ----- 10000×10000 -----
await back()
await newDrawing(10000, 10000, false)
await page.keyboard.press('f')
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#3366cc', opacity: 1 }))
t = await fillAt(5000, 5000)
check(
  '10000×10000, an empty layer: filled whole, quickly',
  (await shownAt(9999, 9999)) === '#3366cc' && t.ms < 1500,
  `${t.ms.toFixed(0)} ms, longest frame ${t.worstFrame.toFixed(0)} ms`,
)
const known = await page.evaluate(() => {
  const { stack, gpu, app } = window.lydia
  const tile = stack.active.tiles.get('20,20')
  const pixels = app.renderer.extract.pixels(gpu.getTexture(stack.active, 20, 20, false)).pixels
  const ram = new Uint8Array(new Uint32Array([tile.color]).buffer)
  return { dirty: gpu.stats().dirty, isOneColor: tile.color !== undefined, ram: [...ram], gpu: [...pixels.slice(0, 4)] }
})
check(
  'a tile filled whole goes straight into RAM as one color, the same as on the graphics card',
  known.dirty === 0 && known.isOneColor && known.ram.every((v, i) => Math.abs(v - known.gpu[i]) <= 1),
  JSON.stringify(known),
)
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await sleep(300)
// A tangle of big strokes over the paper, then fill the white around them
for (let s = 0; s < 6; s++) {
  const points = Array.from({ length: 60 }, (_, i) => [500 + i * 150, 1000 + s * 1500 + Math.sin(i / 4 + s) * 600])
  await stroke(points, '#000000', 40)
}
await page.waitForFunction(() => !window.lydia.gpu.hasUnsaved(), { timeout: 60000 }) // the strokes saved, as after a real pen
await page.keyboard.press('f')
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#e04020', opacity: 1 }))
t = await fillAt(100, 100)
check(
  '10000×10000 with long lines across it: the white around them is filled',
  (await shownAt(100, 100)) === '#e04020' && (await shownAt(9900, 9900)) === '#e04020',
  `${t.ms.toFixed(0)} ms`,
)
check(
  'the screen kept drawing frames while it worked',
  t.worstFrame < 50,
  `longest frame ${t.worstFrame.toFixed(0)} ms`,
)
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await page.waitForFunction(() => !window.lydia.projection.isUpdating(), { timeout: 60000 })
await sleep(200)
const undone = await shownAt(100, 100)
await page.keyboard.down('Control')
await page.keyboard.press('y')
await page.keyboard.up('Control')
await page.waitForFunction(() => !window.lydia.projection.isUpdating(), { timeout: 60000 })
await sleep(200)
check(
  'undo and redo of the big fill',
  undone === '#ffffff' && (await shownAt(100, 100)) === '#e04020',
  `${undone} → ${await shownAt(100, 100)}`,
)

console.log(problems.length ? 'problems:\n' + problems.slice(0, 8).join('\n') : 'no errors or warnings in the console')
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
