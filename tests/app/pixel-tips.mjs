// Pixel tips in the Brush Designer: the papers of 16, 32 and 64 pixels, the settings a pixel tip has, the pixel grid,
// the tip cut to the painted part, painting with it at 1×, 2× and 3×, and its preview in the brush list
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

const black = (x, y) => page.evaluate((x, y) => window.lydia.projection.colorAt(x, y) === '#000000', x, y)
const clickPaper = async (x, y) => {
  const p = await pageOf(x, y)
  await page.mouse.click(p.x, p.y)
  await sleep(80)
}
const buttons = () => page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent))
const labels = () =>
  page.evaluate(() => [...document.querySelectorAll('label')].map(l => l.textContent.trim().split(/\d/)[0].trim()))

// ----- The Brush Designer, for a pixel brush -----
await click('Pixel')
const options = await page.$$eval('.designer-start select option', os => os.map(o => o.textContent))
check(
  'Pixel: tip papers of 16, 32 and 64, 32 by default',
  options.join() === '16×16,32×32 (default),64×64',
  options.join(),
)
await click('Smooth')
check(
  'Smooth: the papers as before',
  (await page.$$eval('.designer-start select option', os => os.map(o => o.textContent))).join() ===
    '256×256,512×512 (default),1024×1024',
)
await click('Pixel')
await click('Open Brush Designer')
await page.waitForFunction(() => window.lydia?.engine && window.lydia.app.renderer, { timeout: 90000 })
await sleep(800)
const b = await buttons(),
  l = await labels()
check('no Edge or Strength', !b.includes('Soft') && !l.includes('Strength'), l.join())
check(
  'no Angle, Random angle, Wash or Noise',
  !l.includes('Angle') &&
    !l.includes('Random angle') &&
    !l.includes('Wash') &&
    !l.includes('Amount') &&
    l.includes('Spacing') &&
    l.includes('Scatter'),
  l.join(),
)
check(
  'zoomed in, with the pixel grid',
  await page.evaluate(() => window.lydia.world.scale.y >= 8 && window.lydia.pixelGrid.isShown()),
)
// An L: three across, two more down, and a pixel apart from it (2 pixels right of the bottom of the L)
for (const [x, y] of [
  [10, 10],
  [11, 10],
  [12, 10],
  [10, 11],
  [10, 12],
  [12, 12],
])
  await clickPaper(x + 0.5, y + 0.5)
await sleep(600)
const hint = await page.$eval('.designer-panel .hint', p => p.textContent)
check(
  'the tip: 3×3 pixels, cut to the painted part',
  hint.startsWith('Tip: 3×3 pixels') && hint.includes('1×, 2×, 3×'),
  hint,
)
await click('Save to my brushes')
await sleep(300)
await page.evaluate(() => {
  window.confirm = () => true
})
await click('Back')
await sleep(300)

// ----- Painting with it -----
await page.evaluate(() => delete window.lydia)
await newDrawing(400, 300)
await page.evaluate(() =>
  [...document.querySelectorAll('button.brush')].find(b => b.textContent.includes('My brush')).click(),
)
await sleep(500)
const sizeShown = await page.evaluate(
  () => document.querySelector('label[title^="Brush size"] input[type=range]').value,
)
check('choosing it, the size goes to 3, its tip at 1×', sizeShown === '3', sizeShown)
await clickPaper(100.5, 100.5)
// Centered on the pixel under the pointer: its top left corner at (99, 99)
const at1 = []
for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) at1.push((await black(99 + x, 99 + y)) ? '#' : '.')
check('1×: exactly the pixels drawn', at1.join('') === '###' + '#..' + '#.#', at1.join(''))
check('…and nothing around', !(await black(98, 99)) && !(await black(102, 99)) && !(await black(99, 102)))

await setSize(6)
// An even size has no middle pixel: away from the tie, its top left corner goes to the nearest one, (198, 98)
await clickPaper(200.8, 100.8)
const at2 = []
for (let y = 0; y < 6; y++) {
  let row = ''
  for (let x = 0; x < 6; x++) row += (await black(198 + x, 98 + y)) ? '#' : '.'
  at2.push(row)
}
check('2×: each pixel a square of 2×2', at2.join('/') === '######/######/##..../##..../##..##/##..##', at2.join('/'))

await setSize(8)
await sleep(100)
await moveTo(300.5, 100.5)
const o = await outline()
check(
  '8 rounds to 9 (3×): the outline is 9 pixels across',
  o.visible && Math.abs(o.width - (9 * o.zoom + 3 * Math.SQRT2)) <= 1.5,
  `${o.width.toFixed(1)} for ${(9 * o.zoom).toFixed(1)}`,
)
await clickPaper(300.5, 100.5)
check(
  '3×: 9 pixels across',
  (await black(296, 96)) && (await black(304, 96)) && !(await black(305, 96)) && !(await black(295, 96)),
)

// A stroke
await setSize(3)
await moveTo(50.5, 200.5)
await page.mouse.down()
for (let x = 52; x <= 150; x += 2) await moveTo(x + 0.5, 200.5)
await page.mouse.up()
await sleep(150)
check('a stroke paints with it', (await black(100, 199)) && !(await black(100, 198)))
await page.screenshot({ path: OUT + '/drawn-pixel.png' })
const preview = await page.evaluate(() => {
  const button = [...document.querySelectorAll('button.brush')].find(b => b.textContent.includes('My brush'))
  return button.querySelector('canvas') !== null
})
check('its preview in the brush list', preview)

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
