// The hand, zoom and rotate tools, flipping the view, Shift + Space, the view in the bar, Fit when turned, painting and
// picking on a turned and flipped view (checked against PixiJS's own transform), the pixel grid and the transparent
// paper's squares on a turned view
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
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]) // the gray around the paper is the light one
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

async function newDrawing(transparent) {
  await click('New project…')
  await page.waitForSelector('dialog.new-project[open]')
  const inputs = await page.$$('dialog input[type=number]')
  for (const [i, value] of [
    [0, 1500],
    [1, 1000],
  ]) {
    await inputs[i].click({ clickCount: 3 })
    await inputs[i].type(String(value))
  }
  if (transparent) await click('Transparent')
  await page.click('button[type=submit]')
  await page.waitForFunction(
    () => window.lydia?.engine && window.lydia.app.renderer && document.querySelectorAll('button.brush').length > 0,
    { timeout: 90000 },
  )
  await sleep(400)
}

const view = () => page.evaluate(() => window.lydia.engine.getView())
const bar = () => page.$$eval('.view-controls .slider-value', spans => spans.map(s => s.textContent))
const pressedTool = () =>
  page.$$eval('.tool-column button[aria-pressed=true]', bs => bs.map(b => b.getAttribute('aria-label')).join())
const cursor = () => page.evaluate(() => window.lydia.app.canvas.style.cursor)
const canUndo = () => page.evaluate(() => window.lydia.engine.getSnapshot().canUndo)
const position = () => page.evaluate(() => ({ x: window.lydia.world.position.x, y: window.lydia.world.position.y }))
// The point of the paper under a point of the page, worked out by PixiJS itself from the world's transform
const paperUnder = p =>
  page.evaluate(p => {
    const { app, world } = window.lydia
    app.render()
    const box = app.canvas.getBoundingClientRect()
    return world.toLocal({ x: p.x - box.left, y: p.y - box.top })
  }, p)
// And the other way: where a point of the paper is on the page
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
const middle = () =>
  page.evaluate(() => {
    const box = window.lydia.app.canvas.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  })
const same = (a, b, by = 0.5) => Math.abs(a.x - b.x) <= by && Math.abs(a.y - b.y) <= by
const fmt = p => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`
// Drag along an arc around the middle of the screen, from one angle to another (degrees, clockwise)
async function arc(from, to, radius = 200) {
  const c = await middle()
  const at = a => ({ x: c.x + radius * Math.cos((a * Math.PI) / 180), y: c.y + radius * Math.sin((a * Math.PI) / 180) })
  await page.mouse.move(at(from).x, at(from).y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    const p = at(from + ((to - from) * i) / 12)
    await page.mouse.move(p.x, p.y)
  }
  await page.mouse.up()
  await sleep(50)
}

await newDrawing(false)

// ----- The column and the bar -----
const labels = await page.$$eval('.tool-column button', bs => bs.map(b => b.getAttribute('aria-label')).join())
check('the column has the hand, zoom and rotate tools', labels.includes('Hand,Zoom,Rotate view'), labels)
let v = await view()
check(
  'the bar shows the zoom and 0°',
  JSON.stringify(await bar()) === JSON.stringify([`${Math.round(v.zoom * 100)}%`, '0°']),
  JSON.stringify(await bar()),
)
check(
  'Straighten is off at 0°, Flip is not pressed',
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.view-controls button')]
    return (
      buttons.find(b => b.textContent === 'Straighten').disabled &&
      buttons.find(b => b.textContent === 'Flip').getAttribute('aria-pressed') === 'false'
    )
  }),
)
for (const [key, name] of [
  ['h', 'Hand'],
  ['z', 'Zoom'],
  ['r', 'Rotate view'],
  ['b', 'Brush'],
]) {
  await page.keyboard.press(key)
  await sleep(50)
  check(`${key.toUpperCase()} chooses ${name}`, (await pressedTool()) === name, await pressedTool())
}

// ----- Hand -----
const c = await middle()
await page.keyboard.press('h')
await page.mouse.move(c.x, c.y)
check('the hand shows "grab"', (await cursor()) === 'grab', await cursor())
let before = await position()
await page.mouse.down()
await page.mouse.move(c.x + 100, c.y + 50, { steps: 5 })
check('while dragging, "grabbing"', (await cursor()) === 'grabbing', await cursor())
await page.mouse.up()
let after = await position()
check(
  'the hand moves the view with the pointer',
  same({ x: after.x - before.x, y: after.y - before.y }, { x: 100, y: 50 }, 0.01),
  fmt({ x: after.x - before.x, y: after.y - before.y }),
)
check('the hand paints nothing', !(await canUndo()))

// ----- Zoom -----
await page.keyboard.press('z')
const P = { x: c.x - 150, y: c.y + 80 }
await page.mouse.move(P.x, P.y)
check('the zoom tool shows "zoom-in"', (await cursor()) === 'zoom-in', await cursor())
await page.keyboard.down('Alt')
check('with Alt, "zoom-out"', (await cursor()) === 'zoom-out', await cursor())
await page.keyboard.up('Alt')
let under = await paperUnder(P)
const z0 = (await view()).zoom
await page.mouse.click(P.x, P.y)
await sleep(50)
check('a click zooms in 2×', Math.abs((await view()).zoom - 2 * z0) < 1e-9, `${z0} → ${(await view()).zoom}`)
check(
  'the point clicked stays under the pointer',
  same(await paperUnder(P), under),
  `${fmt(under)} → ${fmt(await paperUnder(P))}`,
)
check('the bar follows the zoom', (await bar())[0] === `${Math.round(z0 * 200)}%`, (await bar())[0])
await page.keyboard.down('Alt')
await page.mouse.click(P.x, P.y)
await page.keyboard.up('Alt')
await sleep(50)
check('Alt + click zooms out 2×', Math.abs((await view()).zoom - z0) < 1e-9, String((await view()).zoom))
await page.mouse.move(P.x, P.y)
await page.mouse.down()
await page.mouse.move(P.x + 100, P.y + 3, { steps: 10 })
await page.mouse.up()
await sleep(50)
check(
  'dragging 100 px to the right zooms in smoothly (×e)',
  Math.abs((await view()).zoom / z0 - Math.E) < 0.01,
  ((await view()).zoom / z0).toFixed(3),
)
check('around the point where the drag started', same(await paperUnder(P), under), fmt(await paperUnder(P)))
check('zooming paints nothing', !(await canUndo()))
await page.keyboard.down('Control')
await page.keyboard.press('0')
await page.keyboard.up('Control')

// ----- Rotate -----
await page.keyboard.press('r')
await page.mouse.move(c.x + 100, c.y)
check(
  'the rotate tool shows its own cursor',
  (await cursor()).includes('data:image/svg+xml') && (await cursor()).includes('12 12'),
)
under = await paperUnder(c)
await arc(0, 90)
v = await view()
check(
  'dragging a quarter turn around the middle turns the view 90°',
  Math.abs(v.rotation - 90) < 0.5 && (await bar())[1] === '90°',
  `${v.rotation.toFixed(2)} ${(await bar())[1]}`,
)
check('around the middle of the screen', same(await paperUnder(c), under), fmt(await paperUnder(c)))
await page.keyboard.down('Shift')
await arc(0, 37)
await page.keyboard.up('Shift')
v = await view()
check('with Shift, in steps of 15° (90 + 37 → 120)', Math.abs(v.rotation - 120) < 1e-6, v.rotation.toFixed(4))
await click('Straighten')
await sleep(50)
v = await view()
check(
  'Straighten turns it back to 0°, around the middle',
  v.rotation === 0 && same(await paperUnder(c), under) && (await bar())[1] === '0°',
  `${v.rotation} ${fmt(await paperUnder(c))}`,
)

// ----- Shift + Space and Space, with the brush -----
await page.keyboard.press('b')
await page.mouse.move(c.x + 200, c.y)
await page.keyboard.down('Shift')
await page.keyboard.down('Space')
await sleep(30)
check('Shift + Space shows the rotate cursor', (await cursor()).includes('12 12'))
await arc(0, 40)
await page.keyboard.up('Space')
await page.keyboard.up('Shift')
v = await view()
check(
  'Shift + Space + drag turns the view freely (40°, not a step of 15°)',
  Math.abs(v.rotation - 40) < 0.5,
  v.rotation.toFixed(2),
)
check('…and paints nothing', !(await canUndo()))
await page.keyboard.down('Space')
await page.mouse.move(c.x, c.y)
check('Space shows "grab"', (await cursor()) === 'grab', await cursor())
before = await position()
await page.mouse.down()
await page.mouse.move(c.x - 40, c.y + 30, { steps: 4 })
await page.mouse.up()
await page.keyboard.up('Space')
after = await position()
check(
  'Space + drag moves the view',
  same({ x: after.x - before.x, y: after.y - before.y }, { x: -40, y: 30 }, 0.01) && !(await canUndo()),
)
await page.mouse.move(c.x + 5, c.y)
await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
check("letting Space go, the brush's outline instead of the cursor", (await cursor()) === 'none', await cursor())

// ----- Flip -----
under = await paperUnder(c)
await page.keyboard.press('m')
await sleep(50)
v = await view()
check(
  'M flips the view, and the rotation changes sign',
  v.flipped && Math.abs(v.rotation + 40) < 0.5,
  JSON.stringify(v),
)
check('around the middle of the screen', same(await paperUnder(c), under), fmt(await paperUnder(c)))
check(
  'the Flip button shows it',
  await page.$$eval(
    '.view-controls button',
    bs => bs.find(b => b.textContent === 'Flip').getAttribute('aria-pressed') === 'true',
  ),
)
const left = await paperUnder({ x: c.x - 100, y: c.y }),
  right = await paperUnder({ x: c.x + 100, y: c.y })
await page.keyboard.press('m')
const left2 = await paperUnder({ x: c.x - 100, y: c.y })
check(
  'it is a mirror of the screen: what was on the left is on the right',
  same(left2, right, 0.5),
  `${fmt(left2)} vs ${fmt(right)}`,
)
await click('Flip')
await sleep(50)
check('the Flip button flips it too', (await view()).flipped)

// ----- Painting and picking on a turned, flipped view -----
await page.evaluate(async () => {
  const library = await import('/src/brushLibrary.ts')
  const brush = library.builtInBrush('hard-round')
  window.lydia.engine.setBrushTip(await library.tipOf(brush), brush.preset)
})
const S = { x: c.x - 220, y: c.y - 130 }
const target = await paperUnder(S)
await page.mouse.click(S.x, S.y)
await sleep(100)
const shown = await page.evaluate(t => window.lydia.projection.colorAt(t.x, t.y), target)
const aside = await page.evaluate(t => window.lydia.projection.colorAt(t.x + 40, t.y), target)
check(
  'a click paints exactly under the pointer, turned and flipped (PixiJS agrees)',
  shown === '#000000' && aside === '#ffffff',
  `${fmt(target)}: ${shown}, beside: ${aside}`,
)
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#ffffff' }))
await page.keyboard.press('i')
await page.mouse.click(S.x, S.y)
await sleep(50)
check(
  'the eyedropper picks under the pointer, turned and flipped',
  (await page.$eval('.toolbar input[type=color]', i => i.value)) === '#000000',
)
await page.keyboard.press('b')

// ----- Fit, turned -----
await page.keyboard.down('Control')
await page.keyboard.press('0')
await page.keyboard.up('Control')
await sleep(50)
v = await view()
const box = await page.evaluate(() => {
  const b = window.lydia.app.canvas.getBoundingClientRect()
  return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }
})
const corners = await Promise.all(
  [
    [0, 0],
    [1500, 0],
    [0, 1000],
    [1500, 1000],
  ].map(([x, y]) => pageOf(x, y)),
)
const xs = corners.map(p => p.x),
  ys = corners.map(p => p.y)
const inside = corners.every(
  p => p.x >= box.left - 0.5 && p.x <= box.right + 0.5 && p.y >= box.top - 0.5 && p.y <= box.bottom + 0.5,
)
const fills = Math.max(
  (Math.max(...xs) - Math.min(...xs)) / (box.right - box.left),
  (Math.max(...ys) - Math.min(...ys)) / (box.bottom - box.top),
)
check(
  'Fit keeps the turn and the flip, and fits the turned paper',
  v.flipped && Math.abs(v.rotation + 40) < 0.5 && inside && Math.abs(fills - 0.9) < 0.01,
  `${JSON.stringify(v)} inside ${inside} fills ${fills.toFixed(3)}`,
)

// ----- Ctrl + wheel on a turned view -----
await page.mouse.move(P.x, P.y)
under = await paperUnder(P)
const zw = (await view()).zoom
await page.keyboard.down('Control')
await page.mouse.wheel({ deltaY: -200 })
await page.keyboard.up('Control')
await sleep(100)
check(
  'Ctrl + wheel zooms around the pointer on a turned view',
  (await view()).zoom > zw && same(await paperUnder(P), under),
  `${zw.toFixed(3)} → ${(await view()).zoom.toFixed(3)}, ${fmt(await paperUnder(P))}`,
)

// ----- The pixel grid on a turned view -----
await page.evaluate(() => {
  const { brush, engine } = window.lydia
  engine.setBrush({ color: '#808080', size: 500, tool: 'brush', opacity: 1 })
  brush.startStroke(300, 300, 1)
  brush.endStroke()
})
await page.keyboard.press('z')
for (let i = 0; i < 6 && (await view()).zoom < 16; i++) {
  const p = await pageOf(300, 300)
  await page.mouse.click(p.x, p.y)
  await sleep(30)
}
const gridPixel = (x, y) =>
  page.evaluate(
    (x, y) => {
      const { app, pixelGrid, world } = window.lydia
      pixelGrid.update()
      app.render()
      const p = world.toGlobal({ x, y })
      const gl = app.renderer.gl
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      const out = new Uint8Array(4)
      gl.readPixels(
        Math.floor(p.x * app.renderer.resolution),
        gl.drawingBufferHeight - 1 - Math.floor(p.y * app.renderer.resolution),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        out,
      )
      return out[0]
    },
    x,
    y,
  )
const isGridShown = await page.evaluate(() => {
  window.lydia.pixelGrid.update()
  return window.lydia.pixelGrid.isShown()
})
const inPixel = await gridPixel(300.5, 300.5),
  onLineX = await gridPixel(301, 300.5),
  onLineY = await gridPixel(300.5, 301)
check(
  'the pixel grid shows on a turned, flipped view, between the pixels',
  isGridShown && Math.abs(inPixel - 128) <= 2 && Math.abs(onLineX - 64) <= 3 && Math.abs(onLineY - 64) <= 3,
  `zoom ${(await view()).zoom.toFixed(1)}: inside ${inPixel}, lines ${onLineX} ${onLineY}`,
)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/grid-turned.png' })

// ----- The transparent paper's squares on a turned view -----
await page.evaluate(() => {
  window.confirm = () => true
})
await click('Back')
await sleep(300)
await newDrawing(true)
await page.keyboard.press('r')
await arc(0, 30)
await page.keyboard.down('Control')
await page.keyboard.press('0')
await page.keyboard.up('Control') // all of it on the screen
await sleep(50)
const screenRed = (x, y) =>
  page.evaluate(
    (x, y) => {
      const { app, world } = window.lydia
      app.render()
      const p = world.toGlobal({ x, y })
      const gl = app.renderer.gl
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      const out = new Uint8Array(4)
      gl.readPixels(Math.floor(p.x), gl.drawingBufferHeight - 1 - Math.floor(p.y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out)
      return out[0]
    },
    x,
    y,
  )
const corner = await screenRed(20, 20),
  outsidePaper = await screenRed(-30, 500),
  far = await screenRed(1480, 980)
check(
  'the squares turn with the paper: on it, white or gray squares; around it, the background',
  [255, 204].includes(corner) && [255, 204].includes(far) && outsidePaper === 128,
  `${corner} ${far} ${outsidePaper}`,
)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/checkers-turned.png' })

console.log(problems.length ? 'problems:\n' + problems.slice(0, 8).join('\n') : 'no errors or warnings in the console')
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
