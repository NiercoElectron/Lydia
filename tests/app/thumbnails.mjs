// The layers panel of decision 82: each layer's small picture, with paint where the layer has it, following strokes, undo,
// a duplicate and a file, without a picture for a folder; the paper's row, its eye on the screen and in an export; the
// buttons of the panel; and a full layer of 10000×10000 going through its picture without stopping the screen
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { CACHE_DIR, LAUNCH, PORT, ROOT, discardIfAsked } from './setup.mjs'
const server = await createServer({
  root: ROOT,
  configFile: ROOT + '/vite.config.ts',
  cacheDir: CACHE_DIR,
  server: { port: PORT, strictPort: true },
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
await page.setViewport({ width: 1920, height: 1080 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
const click = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).click(), text)
const snapshot = () => page.evaluate(() => window.lydia.engine.getSnapshot())
const waitIdle = async () => {
  await sleep(100)
  await page.waitForFunction(
    () => {
      const { engine, gpu, projection } = window.lydia
      const snap = engine.getSnapshot()
      return !snap.task && !snap.isUpdating && !projection.isUpdating() && !gpu.hasUnsaved()
    },
    { timeout: 60000, polling: 20 },
  )
  await sleep(300)
}
const newDrawing = async (width, height) => {
  await click('New project…')
  await page.waitForSelector('dialog.new-project[open]')
  const inputs = await page.$$('dialog input[type=number]')
  for (const [input, value] of [
    [inputs[0], width],
    [inputs[1], height],
  ]) {
    await input.click({ clickCount: 3 })
    await input.type(String(value))
  }
  await page.click('button[type=submit]')
  await page.waitForFunction(
    () => window.lydia?.engine && window.lydia.app.renderer && document.querySelectorAll('button.brush').length > 0,
    { timeout: 90000 },
  )
  await sleep(800)
}
const stroke = (x, y, x2, y2, color, size) =>
  page.evaluate(
    ({ x, y, x2, y2, color, size }) => {
      const { engine, brush } = window.lydia
      engine.setBrush({ color, size, opacity: 1, tool: 'brush' })
      brush.startStroke(x, y, 1)
      brush.continueStroke([{ x: x2, y: y2, pressure: 1 }])
      brush.endStroke()
      engine.getSnapshot()
    },
    { x, y, x2, y2, color, size },
  )
// The color of a point of the paper in the active layer's picture, or null where it has none
const pictureAt = (x, y, id) =>
  page.evaluate(
    ({ x, y, id }) => {
      const { engine, stack } = window.lydia
      const canvas = engine.layerThumbnail(id ?? stack.active.id)
      const context = canvas.getContext('2d')
      const scale = canvas.width / 1000
      const [r, g, b, a] = context.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data
      return a < 128 ? null : `${r},${g},${b}`
    },
    { x, y, id },
  )
const near = (color, expected) => {
  if (!color) return false
  const a = color.split(',').map(Number)
  return a.every((value, i) => Math.abs(value - expected[i]) <= 8)
}
const shownAt = (x, y) => page.evaluate((x, y) => window.lydia.projection.colorAt(x, y), x, y)

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('lydia')
  indexedDB.deleteDatabase('lydia-autosave')
})
await page.reload({ waitUntil: 'networkidle0' })
await newDrawing(1000, 1000)

// ----- The pictures -----
const size = await page.evaluate(() => {
  const canvas = document.querySelector('.layers-list .layer-thumbnail canvas')
  return [canvas.width, canvas.height]
})
check('a layer has its picture', size.join() === '64,64', size.join())
await stroke(100, 100, 400, 100, '#ff0000', 60)
await waitIdle()
const firstId = (await snapshot()).activeLayerId
check('it shows the paint where it is', near(await pictureAt(250, 100), [255, 0, 0]), await pictureAt(250, 100))
check('and nothing elsewhere', (await pictureAt(700, 700)) === null)
await click('New layer')
await waitIdle()
const secondId = (await snapshot()).activeLayerId
await stroke(600, 800, 900, 800, '#0000ff', 80)
await waitIdle()
check('each layer has its own', near(await pictureAt(750, 800), [0, 0, 255]) && (await pictureAt(250, 100)) === null)
check('and the first stays as it was', near(await pictureAt(250, 100, firstId), [255, 0, 0]))
await click('Undo')
await waitIdle()
check('undo takes the paint out of it', (await pictureAt(750, 800, secondId)) === null)
await click('Redo')
await waitIdle()
check('and redo puts it back', near(await pictureAt(750, 800, secondId), [0, 0, 255]))
await page.evaluate(() => window.lydia.engine.duplicateLayer())
await waitIdle()
check('a copy has the picture too', near(await pictureAt(750, 800), [0, 0, 255]))
await click('Delete layer')
await waitIdle()
await page.evaluate(() => window.lydia.engine.addFolder())
await waitIdle()
check(
  'a folder has none',
  await page.$$eval('.layers-list li.folder', rows => rows.every(row => !row.querySelector('.layer-thumbnail'))),
)
await click('Undo')
await waitIdle()

// ----- The eye and the buttons -----
const eyes = await page.$$eval('.layers-list .layer-eye svg', icons => icons.length)
check('each layer has an eye', eyes === 2, `${eyes}`)
await page.evaluate(() => document.querySelector('.layers-list .layer-eye input').click())
await waitIdle()
check('which hides it', (await snapshot()).layers.at(-1).visible === false)
await page.evaluate(() => document.querySelector('.layers-list .layer-eye input').click())
await waitIdle()
const before = (await snapshot()).layers.length
await page.click('.layers-panel button[aria-label="New layer"]')
await waitIdle()
await page.click('.layers-panel button[aria-label="Duplicate"]')
await waitIdle()
await page.click('.layers-panel button[aria-label="New folder"]')
await waitIdle()
check('the icons add a layer, a copy and a folder', (await snapshot()).layers.length === before + 3)
for (let i = 0; i < 3; i++) await click('Undo')
await waitIdle()

// ----- The paper -----
check('the paper is under the layers', await page.$eval('.paper-name', name => name.textContent === 'Paper'))
const paperColor = await page.$eval('.paper-row .layer-thumbnail', box => box.style.background)
check('with its color', paperColor !== '', paperColor)
check('it shows at first', (await shownAt(500, 500)) === '#ffffff', await shownAt(500, 500))
await page.evaluate(() => document.querySelector('.paper-row input').click())
await waitIdle()
check('its eye takes it away', (await shownAt(500, 500)) === null, `${await shownAt(500, 500)}`)
check('and leaves the paint', (await shownAt(250, 100)) === '#ff0000', await shownAt(250, 100))
const exported = await page.evaluate(async () => {
  const blob = await window.lydia.engine.exportImage('png')
  const image = await createImageBitmap(blob)
  const context = new OffscreenCanvas(image.width, image.height).getContext('2d', { willReadFrequently: true })
  context.drawImage(image, 0, 0)
  return [context.getImageData(500, 500, 1, 1).data[3], context.getImageData(250, 100, 1, 1).data[3]]
})
check('an image exported then is transparent there', exported.join() === '0,255', exported.join())
await page.evaluate(() => document.querySelector('.paper-row input').click())
await waitIdle()
check('and it comes back', (await shownAt(500, 500)) === '#ffffff', await shownAt(500, 500))

// ----- A big drawing -----
page.on('dialog', d => d.accept())
await click('Back')
await discardIfAsked(page)
await sleep(500)
await newDrawing(10000, 10000)
await page.evaluate(() => {
  const { engine, brush } = window.lydia
  engine.setBrush({ color: '#00aa00', size: 500, opacity: 1, tool: 'brush' })
  engine.setTool('fill')
  brush.startStroke(500, 5000, 1)
  brush.continueStroke([{ x: 9500, y: 5000, pressure: 1 }])
  brush.endStroke()
})
const center = await page.evaluate(() => {
  const { app, world } = window.lydia
  const box = app.canvas.getBoundingClientRect()
  const p = world.toGlobal({ x: 5000, y: 2000 })
  return { x: box.left + p.x, y: box.top + p.y }
})
await page.evaluate(() => {
  window.worstFrame = 0
  let last = performance.now()
  const frame = now => {
    window.worstFrame = Math.max(window.worstFrame, now - last)
    last = now
    if (!window.stopFrames) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
})
await page.mouse.click(center.x, center.y)
await waitIdle()
await page.evaluate(() => {
  window.worstFrame = 0
})
await sleep(2500)
const longest = await page.evaluate(() => {
  window.stopFrames = true
  return { worst: window.worstFrame, tiles: window.lydia.stack.active.tiles.size }
})
const big = await page.evaluate(() => {
  const { engine, stack } = window.lydia
  const canvas = engine.layerThumbnail(stack.active.id)
  const scale = canvas.width / 10000
  const [r, g, b, a] = canvas
    .getContext('2d')
    .getImageData(Math.floor(5000 * scale), Math.floor(5000 * scale), 1, 1).data
  return { color: [r, g, b, a].join() }
})
check('a big stroke reaches its picture', big.color.startsWith('0,170,0') || big.color.endsWith(',255'), big.color)
check(
  'with the screen going on',
  longest.worst < 100,
  `longest frame ${longest.worst.toFixed(0)} ms, ${longest.tiles} tiles`,
)

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
