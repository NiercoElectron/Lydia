// The color panel (decision 65): the ring of hues and the triangle that turns with it, the hex field, the H/S/V
// sliders, the background color and X, and the colors painted with lately, kept between visits
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

const browser = await puppeteer.launch(LAUNCH)
const page = await browser.newPage()
const problems = []
page.on('pageerror', e => problems.push('PAGE ERROR ' + e))
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warn') problems.push(m.type() + ': ' + m.text())
})
// At 150% (Windows at 125% with the browser's zoom at 120%, say): the picture is 300 pixels wide, as a new canvas, and
// its height must follow too, or the ring shows stretched and cut in half
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1.5 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const click = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).click(), text)
await page.goto('http://localhost:5198/', { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('lydia')
})
await page.reload({ waitUntil: 'networkidle0' })

async function newDrawing() {
  await click('New project…')
  await page.waitForSelector('dialog.new-project[open]')
  const inputs = await page.$$('dialog input[type=number]')
  for (const [i, value] of [
    [0, 300],
    [1, 200],
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
await newDrawing()

const waitIdle = () =>
  page.waitForFunction(
    () => {
      const s = window.lydia.engine.getSnapshot()
      return !s.task && !s.isUpdating && !window.lydia.projection.isUpdating()
    },
    { timeout: 60000, polling: 10 },
  )
const hexField = () => page.$eval('input.color-hex', el => el.value)
const brushColor = () => page.evaluate(() => window.lydia.brush.settings.color)
// A point of the ring and the triangle, from its middle, on the page
const picker = await (await page.$('.color-picker')).boundingBox()
const onPicker = point => ({ x: picker.x + picker.width / 2 + point.x, y: picker.y + picker.height / 2 + point.y })
const clickPicker = async point => {
  const p = onPicker(point)
  await page.mouse.click(p.x, p.y)
  await sleep(80)
}
// The ring's middle and the triangle's corners for this hue, as the panel draws them (see colors.ts)
const RING = 99 - 16 / 2
const TRIANGLE = 99 - 16 - 4
const onRing = hue => ({
  x: RING * Math.cos((hue * Math.PI) / 180),
  y: -RING * Math.sin((hue * Math.PI) / 180),
})
const corners = hue =>
  page.evaluate(
    async (hue, radius) => (await import('/src/colors.ts')).triangleCorners(hue, radius),
    hue,
    TRIANGLE * 1.02, // a little outside: the panel takes the nearest point of the triangle, the corner
  )
const typeHex = text =>
  page.$eval(
    'input.color-hex',
    (el, text) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, text)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    text,
  )
const sliderValues = () =>
  page.$$eval('.color-slider', labels => labels.map(label => Number(label.querySelector('input').value)))
const setSlider = (index, value) =>
  page.evaluate(
    (index, value) => {
      const input = document.querySelectorAll('.color-slider input[type=range]')[index]
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    index,
    value,
  )

// ----- The panel, and no color in the bar -----
check('the color panel is above the layers', (await page.$('.side-panels .color-panel + .layers-panel')) !== null)
check('the bar has no color of its own', (await page.$('.toolbar input[type=color]')) === null)
check('black at first', (await hexField()) === '#000000' && (await brushColor()) === '#000000')

const bitmap = await page.$eval('.color-picker', el => [el.width, el.height])
check('at 150%, the picture is square, 300 × 300', bitmap[0] === 300 && bitmap[1] === 300, bitmap.join(' × '))

// ----- The triangle's corners, and the ring -----
let corner = await corners(0)
await clickPicker(corner.white)
check('the white corner gives white', (await hexField()) === '#ffffff', await hexField())
await clickPicker(corner.pure)
check(
  'the pure corner gives the hue at full strength: red at first',
  (await hexField()) === '#ff0000' && (await brushColor()) === '#ff0000',
  `${await hexField()} ${await brushColor()}`,
)
await clickPicker(onRing(120))
check('a click on the ring changes the hue: green', (await hexField()) === '#00ff00', await hexField())
corner = await corners(120)
await clickPicker(corner.pure)
check('the triangle turned with it: its pure corner is now green', (await hexField()) === '#00ff00', await hexField())
await clickPicker(corner.black)
check('the black corner gives black', (await hexField()) === '#000000', await hexField())

// Dragging round the ring, over many steps, ends on the hue let go at
const from = onPicker(onRing(120))
const to = onPicker(onRing(240))
await clickPicker(corner.pure)
await page.mouse.move(from.x, from.y)
await page.mouse.down()
for (let hue = 120; hue <= 240; hue += 5) {
  const p = onPicker(onRing(hue))
  await page.mouse.move(p.x, p.y)
}
await page.mouse.move(to.x, to.y)
await page.mouse.up()
await sleep(100)
check('dragging round the ring ends on blue', (await brushColor()) === '#0000ff', await brushColor())

// ----- The hex field and the sliders -----
await typeHex('#3a7bd5')
await sleep(50)
check('a typed color counts at once', (await brushColor()) === '#3a7bd5', await brushColor())
const [h, s, v] = await sliderValues()
check('the sliders show its hue, saturation and value', h === 215 && s === 73 && v === 84, `${h} ${s} ${v}`)
await setSlider(2, 0)
await sleep(50)
check('value at 0 is black', (await brushColor()) === '#000000', await brushColor())
await setSlider(2, 84)
await sleep(50)
const [hueAfter, saturationAfter] = await sliderValues()
check(
  'back up, the hue and saturation are kept',
  hueAfter === 215 && saturationAfter === 73 && (await brushColor()) !== '#000000',
  `${hueAfter} ${saturationAfter} ${await brushColor()}`,
)
await page.focus('input.color-hex')
await typeHex('#abc')
await page.keyboard.press('Enter')
await sleep(50)
check('a short #rgb counts on Enter', (await brushColor()) === '#aabbcc', await brushColor())
await page.focus('input.color-hex')
await typeHex('nonsense')
await page.$eval('input.color-hex', el => el.blur())
await sleep(50)
check(
  'something else typed is dropped when the field is left',
  (await hexField()) === '#aabbcc' && (await brushColor()) === '#aabbcc',
)

// ----- The background color and X -----
await page.keyboard.press('x')
await sleep(50)
check('X swaps: white in front', (await brushColor()) === '#ffffff', await brushColor())
await page.click('.color-swap')
await sleep(50)
check('the button swaps back', (await brushColor()) === '#aabbcc', await brushColor())
await page.focus('input.color-hex')
await page.keyboard.press('x')
await sleep(50)
check('X while typing in the field is only typed', (await brushColor()) === '#aabbcc', await brushColor())
await page.$eval('input.color-hex', el => el.blur())

// ----- The colors painted with lately -----
const recent = () => page.$$eval('.recent-color', buttons => buttons.map(b => b.title))
check('none at first', (await recent()).length === 0)
await page.keyboard.press('b')
const canvas = await (await page.$('.draw-space canvas')).boundingBox()
const paint = async color => {
  await typeHex(color)
  await page.$eval('input.color-hex', el => el.blur())
  await page.mouse.move(canvas.x + canvas.width / 2 - 40, canvas.y + canvas.height / 2)
  await page.mouse.down()
  await page.mouse.move(canvas.x + canvas.width / 2 + 40, canvas.y + canvas.height / 2, { steps: 5 })
  await page.mouse.up()
  await waitIdle()
}
await paint('#ff0000')
await paint('#00ff00')
check('each stroke puts its color first', JSON.stringify(await recent()) === '["#00ff00","#ff0000"]', await recent())
await paint('#ff0000')
check(
  'a color used again moves first, once',
  JSON.stringify(await recent()) === '["#ff0000","#00ff00"]',
  await recent(),
)
await page.keyboard.press('e')
await paint('#0000ff')
check("the eraser's strokes don't count", JSON.stringify(await recent()) === '["#ff0000","#00ff00"]', await recent())
await page.click('.recent-color[title="#00ff00"]')
await sleep(50)
check('a click on one makes it the color', (await brushColor()) === '#00ff00', await brushColor())
await page.screenshot({ path: OUT + '/color-panel.png' })

// Kept between visits
await page.evaluate(() => {
  window.confirm = () => true
})
await click('Back')
await sleep(300)
await page.evaluate(() => delete window.lydia)
await page.reload({ waitUntil: 'networkidle0' })
await newDrawing()
check('they are kept for the next drawing', JSON.stringify(await recent()) === '["#ff0000","#00ff00"]', await recent())

check('no errors or warnings on the page', problems.length === 0, problems.slice(0, 5).join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
