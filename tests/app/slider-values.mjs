// Typing the value of a slider: clicking the number next to it
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

const near = (a, b, within = 0.01) => Math.abs(a - b) <= within

// ----- Typing a slider's value -----

// The number next to the slider inside the label that starts with this text
const valueButton = label =>
  page.evaluateHandle(
    label =>
      [...document.querySelectorAll('label')]
        .find(l => l.textContent.trim().startsWith(label))
        ?.querySelector('.slider-value'),
    label,
  )
const shownValue = async label => page.evaluate(b => b?.textContent ?? null, await valueButton(label))
const rangeValue = label =>
  page.evaluate(
    label =>
      [...document.querySelectorAll('label')]
        .find(l => l.textContent.trim().startsWith(label))
        ?.querySelector('input[type=range]')?.value,
    label,
  )
// Click the number, type, and finish with this key (Enter, Escape, or a click on the drawing)
async function typeValue(label, text, finish = 'Enter') {
  await (await valueButton(label)).click()
  await sleep(50)
  const isField = await page.evaluate(() => document.activeElement?.matches('input.slider-value[type=number]'))
  await page.keyboard.type(text)
  if (finish === 'click') {
    const p = await pageOf(30, 30)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.up()
  } else {
    await page.keyboard.press(finish)
  }
  await sleep(100)
  return isField
}

await page.evaluate(() => delete window.lydia)
await newDrawing(800, 600)
check('the brush size shows as a number to click', (await shownValue('Size')) === '20', await shownValue('Size'))
check(
  'clicking it gives a field, with the number selected',
  (await typeValue('Size', '37')) && (await shownValue('Size')) === '37' && (await rangeValue('Size')) === '37',
  `${await shownValue('Size')} / ${await rangeValue('Size')}`,
)
await typeValue('Size', '999')
check('a value past the end is kept within the slider', (await shownValue('Size')) === '500', await shownValue('Size'))
await typeValue('Size', '0')
check('…and below its start too', (await shownValue('Size')) === '1', await shownValue('Size'))
await typeValue('Size', '64', 'Escape')
check('Esc leaves it as it was', (await shownValue('Size')) === '1', await shownValue('Size'))
await typeValue('Size', '', 'Enter')
check('an empty field leaves it as it was', (await shownValue('Size')) === '1', await shownValue('Size'))
await typeValue('Size', '12', 'click')
check('clicking the drawing keeps the typed value', (await shownValue('Size')) === '12', await shownValue('Size'))
await typeValue('Opacity', '45')
check(
  'the stroke opacity takes a typed value, with its %',
  (await shownValue('Opacity')) === '45%',
  await shownValue('Opacity'),
)

// Typing doesn't use the shortcuts: "]" would make the brush bigger, and Delete would empty a selection
await (await valueButton('Size')).click()
await sleep(50)
await page.keyboard.press(']')
await page.keyboard.press('Escape')
await sleep(50)
check('keys typed in the field are not shortcuts', (await shownValue('Size')) === '12', await shownValue('Size'))

// The fill bucket's settings
await keys('f')
await typeValue('Tolerance', '100')
await typeValue('Expand', '7')
check(
  "the fill bucket's Tolerance and Expand take typed values",
  (await shownValue('Tolerance')) === '100' && (await shownValue('Expand')) === '7 px',
  `${await shownValue('Tolerance')} / ${await shownValue('Expand')}`,
)
await keys('b')

// The layer's opacity: one step of undo, as when the slider is let go
const layerOpacity = () => page.evaluate(() => window.lydia.engine.getSnapshot().layers[0].opacity)
const undoBefore = (await snapshot()).canUndo
await (await page.evaluateHandle(() => document.querySelector('.layers-panel .slider-value'))).click()
await sleep(50)
await page.keyboard.type('40')
await page.keyboard.press('Enter')
await sleep(300)
check('the layer opacity takes a typed value', near(await layerOpacity(), 0.4), String(await layerOpacity()))
await click('Undo')
await sleep(300)
check(
  '…as one step of undo',
  near(await layerOpacity(), 1) && (await snapshot()).canUndo === undoBefore,
  String(await layerOpacity()),
)

// The Brush Designer: its bar and its settings, with their steps
page.once('dialog', d => d.accept())
await click('Back')
await sleep(300)
await page.evaluate(() => delete window.lydia)
await click('Open Brush Designer')
await page.waitForFunction(() => window.lydia?.engine && document.querySelector('.designer-panel'), { timeout: 90000 })
await sleep(400)
await typeValue('Strength', '33')
check(
  "the Designer's Strength takes a typed value",
  (await shownValue('Strength')) === '33%',
  await shownValue('Strength'),
)
await typeValue('Spacing', '42')
check('a brush setting takes a typed value', (await shownValue('Spacing')) === '42%', await shownValue('Spacing'))
const stepped = await page.evaluate(() =>
  [...document.querySelectorAll('.slider-row input[type=range]')]
    .filter(r => !r.disabled && (r.step === '5' || r.step === '10'))
    .map(r => r.closest('label').querySelector('span').textContent),
)
if (stepped.length > 0) {
  await typeValue(stepped[0], '23')
  const shown = await shownValue(stepped[0])
  check(`a slider with steps keeps a typed value on its steps (${stepped[0]})`, /^(20|25|30)/.test(shown), shown)
}

console.log(problems.length ? 'problems: ' + problems.slice(0, 8).join(' | ') : 'no errors or warnings in the console')
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
