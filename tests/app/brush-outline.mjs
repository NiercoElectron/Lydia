// The brush's outline: follows the pointer, takes the cursor's place, the tip's shape, turned, pixel brushes on pixels
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
const keys = async (...combo) => {
  for (const k of combo.slice(0, -1)) await page.keyboard.down(k)
  await page.keyboard.press(combo.at(-1))
  for (const k of combo.slice(0, -1).reverse()) await page.keyboard.up(k)
  await sleep(60)
}
const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
// The outline is the last thing on the stage: whether it shows, its size on the screen, and the canvas's cursor
const outline = async () => {
  await frames()
  return page.evaluate(() => {
    const { app } = window.lydia
    const g = app.stage.children.at(-1)
    const b = g.getLocalBounds()
    return {
      visible: g.visible,
      width: b.width,
      height: b.height,
      x: b.x + b.width / 2,
      y: b.y + b.height / 2,
      cursor: app.canvas.style.cursor,
      zoom: window.lydia.world.scale.y,
    }
  })
}
const setSize = size =>
  page.evaluate(size => {
    const input = document.querySelector('label[title^="Brush size"] input[type=range]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(size))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, size)
const chooseBrush = name =>
  page.evaluate(
    name => [...document.querySelectorAll('button.brush')].find(b => b.textContent.includes(name)).click(),
    name,
  )
const moveTo = async (x, y) => {
  const p = await pageOf(x, y)
  await page.mouse.move(p.x, p.y, { steps: 2 })
}
const near = (a, b, within) => Math.abs(a - b) <= within

await newDrawing(1000, 800)
await keys('b')
await setSize(100)
await sleep(100)
await moveTo(500, 400)
let o = await outline()
check('over the paper the outline shows and the cursor hides', o.visible && o.cursor === 'none', JSON.stringify(o))
// Soft round fades to nothing at its edge: the outline goes a little inside it, plus the 3 pixel white line
check(
  'Soft round: a circle nearly the brush size',
  near(o.width, o.height, 2) && o.width > 0.85 * 100 * o.zoom && o.width < 100 * o.zoom + 4,
  `${o.width.toFixed(1)} × ${o.height.toFixed(1)} for ${(100 * o.zoom).toFixed(1)}`,
)
const center = await pageOf(500, 400)
const box = await page.evaluate(() => window.lydia.app.canvas.getBoundingClientRect().toJSON())
check('…centered on the pointer', near(o.x + box.left, center.x, 1.5) && near(o.y + box.top, center.y, 1.5))
await page.screenshot({
  path: OUT + '/outline-soft.png',
  clip: { x: center.x - 80, y: center.y - 80, width: 160, height: 160 },
})

await moveTo(600, 300)
o = await outline()
const moved = await pageOf(600, 300)
check('it follows the pointer', near(o.x + box.left, moved.x, 1.5) && near(o.y + box.top, moved.y, 1.5))

await page.mouse.move(box.left - 100, box.top + 200)
o = await outline()
check('off the drawing it hides', !o.visible)

await moveTo(500, 400)
await setSize(5)
o = await outline()
check(
  'too small to see: the cross instead',
  !o.visible && o.cursor === 'crosshair',
  `${(5 * o.zoom).toFixed(1)} px, ${o.cursor}`,
)
await setSize(100)

await page.keyboard.down('Space')
o = await outline()
check('Space (moving the view): no outline, the hand', !o.visible && o.cursor === 'grab', o.cursor)
await page.keyboard.up('Space')
await keys('s')
o = await outline()
check('with another tool: no outline', !o.visible && o.cursor === 'crosshair')
await keys('e')
o = await outline()
check('the eraser shows it too', o.visible && o.cursor === 'none')
await keys('b')

// Zooming in makes it bigger on the screen
await page.keyboard.down('Control')
await page.mouse.wheel({ deltaY: -200 })
await page.keyboard.up('Control')
await sleep(100)
const before = o.width
o = await outline()
check('zooming in redraws it bigger', o.width > before * 1.2, `${before.toFixed(1)} → ${o.width.toFixed(1)}`)
await keys('Control', '0')

// Calligraphy: a thin ellipse turned 315°, so its box is about square but its outline thin
await chooseBrush('Calligraphy')
await sleep(300)
await moveTo(500, 400)
o = await outline()
check(
  'Calligraphy: turned 45°, a box about square',
  o.visible && near(o.width, o.height, 4),
  `${o.width.toFixed(1)} × ${o.height.toFixed(1)}`,
)
const callCenter = await pageOf(500, 400)
await page.screenshot({
  path: OUT + '/outline-calligraphy.png',
  clip: { x: callCenter.x - 80, y: callCenter.y - 80, width: 160, height: 160 },
})

// Dashes turns with the stroke: across before painting, down while painting downward
await chooseBrush('Dashes')
await sleep(300)
await moveTo(500, 300)
o = await outline()
check('Dashes, before painting: lying across', o.width > o.height * 2, `${o.width.toFixed(1)} × ${o.height.toFixed(1)}`)
await page.mouse.down()
for (let y = 310; y <= 500; y += 10) await moveTo(500, y)
o = await outline()
check(
  '…while painting downward: standing up',
  o.visible && o.height > o.width * 2,
  `${o.width.toFixed(1)} × ${o.height.toFixed(1)}`,
)
await page.mouse.up()
await sleep(100)

// The Pixel brush: on the pixels it paints, a whole number of pixels across
await chooseBrush('Pixel')
await sleep(300)
await setSize(5)
await moveTo(500.3, 400.7)
await page.keyboard.down('Control')
for (let i = 0; i < 6; i++) await page.mouse.wheel({ deltaY: -300 })
await page.keyboard.up('Control')
await sleep(100)
await moveTo(500.3, 400.7)
o = await outline()
const zoom = o.zoom
check(
  "Pixel: 5 pixels across, on the paper's pixels",
  o.visible && near(o.width, 5 * zoom + 3 * Math.SQRT2, 1),
  `${o.width.toFixed(1)} for ${(5 * zoom).toFixed(1)}`,
)
// Size 5 centered on the pixel under the pointer, (500, 400): from 498 to 503
const corner = await pageOf(498, 398)
const left = o.x - o.width / 2 + 1.5 * Math.SQRT2 + box.left
check("…its left edge on a pixel's edge", near(left, corner.x, 1), `${left.toFixed(1)} vs ${corner.x.toFixed(1)}`)
const pixCenter = await pageOf(500.5, 400.5)
await page.screenshot({
  path: OUT + '/outline-pixel.png',
  clip: { x: pixCenter.x - 100, y: pixCenter.y - 100, width: 200, height: 200 },
})
await keys('Control', '0')

// The Outline button turns it off, and it is remembered
await chooseBrush('Soft round')
await setSize(100)
await sleep(200)
await click('Outline')
await moveTo(500, 400)
o = await outline()
check('Outline off: the cross', !o.visible && o.cursor === 'crosshair')
const remembered = await page.evaluate(() => localStorage.getItem('lydia.brushOutline'))
check('…remembered', remembered === 'off', remembered)
await click('Outline')
o = await outline()
check('on again', o.visible && o.cursor === 'none')

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
