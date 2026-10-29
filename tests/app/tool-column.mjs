// The tool column and the eyedropper: the buttons and keys, the cursor, picking by clicking and dragging, Alt while
// painting, what the screen shows (a layer at 50%, white paper, outside the paper), a transparent paper, and the Brush
// Designer (where Alt doesn't pick)
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
// This test is about the cursors themselves: the brush's outline, which takes the cursor's place, is turned off
await page.evaluateOnNewDocument(() => localStorage.setItem('lydia.brushOutline', 'off'))
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

// Where a point of the paper is on the page
const screenOf = (x, y) =>
  page.evaluate(
    (x, y) => {
      const { app, world } = window.lydia
      const box = app.canvas.getBoundingClientRect()
      return { x: box.left + world.position.x + x * world.scale.x, y: box.top + world.position.y + y * world.scale.y }
    },
    x,
    y,
  )
const colorInput = () => page.$eval('.toolbar input[type=color]', input => input.value)
const pressed = () =>
  page.$$eval('.tool-column button[aria-pressed=true]', buttons => buttons.map(b => b.getAttribute('aria-label')))
const cursor = () => page.evaluate(() => window.lydia.app.canvas.style.cursor)
const shownAt = (x, y) => page.evaluate((x, y) => window.lydia.projection.colorAt(x, y), x, y)
// A dab of the Hard round brush, painted straight through the engine
const dab = (x, y, color, size, opacity = 1) =>
  page.evaluate(
    async (x, y, color, size, opacity) => {
      const library = await import('/src/brushLibrary.ts')
      const brush = library.builtInBrush('hard-round')
      const { engine } = window.lydia
      engine.setBrushTip(await library.tipOf(brush), brush.preset)
      engine.setBrush({ size, color, tool: 'brush', opacity })
      window.lydia.brush.startStroke(x, y, 1)
      window.lydia.brush.endStroke()
    },
    x,
    y,
    color,
    size,
    opacity,
  )
const clickPaper = async (x, y) => {
  const p = await screenOf(x, y)
  await page.mouse.click(p.x, p.y)
}
const hover = async (x, y) => {
  const p = await screenOf(x, y)
  await page.mouse.move(p.x, p.y)
}
const near = (hex, r, g, b, by = 2) => {
  const [hr, hg, hb] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return Math.abs(hr - r) <= by && Math.abs(hg - g) <= by && Math.abs(hb - b) <= by
}

// ----- The column -----
await newDrawing(false)
const labels = await page.$$eval('.tool-column button', buttons => buttons.map(b => b.getAttribute('aria-label')))
check(
  'the column has Brush, Eraser and Eyedropper',
  ['Brush', 'Eraser', 'Eyedropper'].every(name => labels.includes(name)),
  JSON.stringify(labels),
)
check('Brush is chosen at first', JSON.stringify(await pressed()) === '["Brush"]')
check(
  'the bar on top no longer has Brush and Eraser buttons',
  await page.$$eval('.toolbar button', bs => !bs.some(b => b.textContent === 'Brush' || b.textContent === 'Eraser')),
)
const titles = await page.$$eval('.tool-column button', buttons => buttons.map(b => b.title))
check(
  'the buttons tell their shortcuts',
  titles.includes('Brush (B)') && titles.some(title => title.startsWith('Eyedropper (I, ')),
  JSON.stringify(titles),
)
check(
  'every button has its icon',
  await page.$$eval('.tool-column button', bs => bs.every(b => b.querySelector('svg'))),
)
await hover(750, 500)
check('the brush shows a crosshair', (await cursor()) === 'crosshair', await cursor())

// ----- Picking -----
await dab(300, 300, '#3366cc', 80)
await dab(600, 300, '#e04020', 80)
await page.click('.tool-column button[aria-label=Eyedropper]')
await sleep(100)
check('clicking Eyedropper chooses it', JSON.stringify(await pressed()) === '["Eyedropper"]')
await hover(750, 500)
check(
  'the eyedropper shows the pipette cursor',
  (await cursor()).includes('data:image/svg+xml') && (await cursor()).includes('2 22'),
  (await cursor()).slice(0, 40),
)
// The stroke's opacity at 40%, through its slider
const opacitySlider = () => page.$eval('.toolbar input[type=range]:not([min="1"][max="500"])', input => input.value)
await page.$eval('.toolbar input[type=range]:not([min="1"][max="500"])', input => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '40')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(100)
const opacityBefore = await opacitySlider()
await clickPaper(300, 300)
await sleep(100)
check('a click picks the color under the pointer', (await colorInput()) === '#3366cc', await colorInput())
check(
  'picking sets the stroke opacity back to 100%',
  opacityBefore === '40' &&
    (await opacitySlider()) === '100' &&
    (await page.evaluate(() => window.lydia.brush.settings.opacity)) === 1,
  `${opacityBefore} → ${await opacitySlider()}`,
)
const from = await screenOf(300, 300),
  to = await screenOf(600, 300)
await page.mouse.move(from.x, from.y)
await page.mouse.down()
await page.mouse.move(to.x, to.y, { steps: 12 })
await page.mouse.up()
await sleep(100)
check('dragging picks the color under the pointer as it moves', (await colorInput()) === '#e04020', await colorInput())
check('the eyedropper paints nothing', (await shownAt(450, 300)) === '#ffffff', await shownAt(450, 300))
await clickPaper(900, 700)
await sleep(100)
check('the white paper gives white', (await colorInput()) === '#ffffff', await colorInput())
await clickPaper(300, 300)
const outside = await screenOf(-30, 300)
await page.mouse.click(outside.x, outside.y)
await sleep(100)
check('outside the paper, the color stays', (await colorInput()) === '#3366cc', await colorInput())

// ----- Keys -----
await page.keyboard.press('b')
await sleep(100)
await hover(750, 500)
check(
  'B chooses the brush again, with its crosshair',
  JSON.stringify(await pressed()) === '["Brush"]' && (await cursor()) === 'crosshair',
)
await page.keyboard.press('i')
await sleep(100)
check('I chooses the eyedropper', JSON.stringify(await pressed()) === '["Eyedropper"]')
await page.keyboard.press('b')
await sleep(100)

// ----- Alt while painting -----
await hover(750, 500)
await page.keyboard.down('Alt')
await sleep(50)
check('holding Alt with the brush shows the pipette', (await cursor()).includes('data:image/svg+xml'))
await clickPaper(600, 300)
await sleep(100)
check('Alt + click picks the color', (await colorInput()) === '#e04020', await colorInput())
check('Alt + click paints nothing', (await shownAt(600, 300)) === '#e04020', await shownAt(600, 300))
check('the brush stays the chosen tool', JSON.stringify(await pressed()) === '["Brush"]')
await page.keyboard.up('Alt')
await sleep(50)
check('letting Alt go shows the crosshair again', (await cursor()) === 'crosshair', await cursor())
await clickPaper(900, 700)
await sleep(200)
check(
  'a click without Alt paints with the picked color',
  (await shownAt(900, 700)) !== '#ffffff',
  await shownAt(900, 700),
)
// Alt pressed while the window was in the background: the pointer event says it is up
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true })))
await hover(760, 510)
check(
  'a pointer move without Alt puts the crosshair back (Alt let go elsewhere)',
  (await cursor()) === 'crosshair',
  await cursor(),
)
await page.keyboard.press('e')
await sleep(100)
await page.keyboard.down('Alt')
await clickPaper(300, 300)
await page.keyboard.up('Alt')
await sleep(100)
check(
  'Alt + click picks with the eraser too, and erases nothing',
  (await colorInput()) === '#3366cc' && (await shownAt(300, 300)) === '#3366cc',
  `${await colorInput()} ${await shownAt(300, 300)}`,
)
await page.keyboard.press('b')

// ----- What the screen shows: a layer at 50% -----
await page.evaluate(() => {
  const { engine } = window.lydia
  engine.setLayerOpacity(engine.getSnapshot().activeLayerId, 0.5)
  engine.finishLayerOpacity()
})
await page.waitForFunction(() => !window.lydia.projection.isUpdating(), { timeout: 20000 })
await sleep(200)
await page.keyboard.press('i')
await clickPaper(300, 300)
await sleep(100)
let picked = await colorInput()
check(
  'on a layer at 50%, the eyedropper picks what the screen shows (half over white)',
  near(picked, 153, 178, 229),
  picked,
)

// Timing: one pick, with the graphics card busy drawing
const timing = await page.evaluate(() => {
  const { projection } = window.lydia
  const times = []
  for (let i = 0; i < 50; i++) {
    const t = performance.now()
    projection.colorAt(300 + i, 300)
    times.push(performance.now() - t)
  }
  times.sort((a, b) => a - b)
  return { median: times[25], worst: times[49] }
})
console.log('   colorAt: ' + JSON.stringify(timing))

// ----- A transparent paper -----
await page.evaluate(() => {
  window.confirm = () => true
})
await click('Back')
await sleep(300)
await newDrawing(true)
await dab(400, 400, '#3366cc', 80, 0.5)
await page.keyboard.press('i')
await clickPaper(400, 400)
await sleep(100)
picked = await colorInput()
check('on a transparent paper, half see-through paint gives its own color', near(picked, 0x33, 0x66, 0xcc, 1), picked)
check(
  'the screen there is half see-through',
  await page.evaluate(() => {
    const { app, projection } = window.lydia
    const pixels = app.renderer.extract.pixels(projection.tiles.get('1,1')).pixels
    const a = pixels[((400 - 256) * 256 + (400 - 256)) * 4 + 3]
    return a > 120 && a < 136
  }),
)
await clickPaper(1000, 800)
await sleep(100)
check(
  'where nothing is painted on a transparent paper, the color stays',
  (await colorInput()) === picked,
  await colorInput(),
)
await page.screenshot({ path: OUT + '/tool-column.png' })

// ----- The Brush Designer -----
await click('Back')
await sleep(300)
await click('Open Brush Designer')
await page.waitForFunction(() => window.lydia?.engine && window.lydia.app.renderer, { timeout: 60000 })
await sleep(500)
check('the Designer has no tool column', (await page.$('.tool-column')) === null)
await hover(128, 128)
await page.keyboard.down('Alt')
await sleep(50)
check('in the Designer, Alt keeps the crosshair', (await cursor()) === 'crosshair', await cursor())
await page.keyboard.up('Alt')
await page.keyboard.press('i')
await sleep(50)
check(
  'in the Designer, I does nothing (the brush stays)',
  await page.$$eval(
    '.toolbar button',
    bs => bs.find(b => b.textContent === 'Brush').getAttribute('aria-pressed') === 'true',
  ),
)

console.log(problems.length ? 'problems:\n' + problems.slice(0, 8).join('\n') : 'no errors or warnings in the console')
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
