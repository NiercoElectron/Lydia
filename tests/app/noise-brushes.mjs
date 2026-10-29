// Bristles and Sponge: the list's previews, strokes on paper, and the Brush Designer's noise controls with its test
// area (screenshots to look at)
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
await page.setViewport({ width: 1920, height: 1080 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
const click = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).click(), text)
async function choose(name) {
  await page.evaluate(
    name =>
      [...document.querySelectorAll('button.brush')]
        .find(b => b.querySelector('.brush-name').textContent === name)
        .click(),
    name,
  )
  await sleep(300)
}
await page.goto('http://localhost:5198/', { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('lydia')
})
await page.reload({ waitUntil: 'networkidle0' })
await click('New project…')
await page.waitForSelector('dialog.new-project[open]')
const inputs = await page.$$('dialog input[type=number]')
for (const [i, value] of [
  [0, 1500],
  [1, 900],
]) {
  await inputs[i].click({ clickCount: 3 })
  await inputs[i].type(String(value))
}
await page.click('button[type=submit]')
await page.waitForFunction(
  () => window.lydia?.engine && window.lydia.app.renderer && document.querySelectorAll('button.brush').length > 0,
  { timeout: 90000 },
)
await sleep(1500) // the previews are painted

const names = await page.$$eval('button.brush .brush-name', els => els.map(e => e.textContent))
check('Bristles and Sponge are at the end of the list', names.slice(-2).join() === 'Bristles,Sponge', names.join(', '))
const previewPaint = await page.$$eval('canvas.brush-preview', canvases =>
  canvases.map(c => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    return n
  }),
)
check(
  'every brush in the list shows its sample stroke',
  previewPaint.every(n => n > 40),
  previewPaint.join(', '),
)
await (await page.$('.brushes-panel')).screenshot({ path: OUT + '/brush-list.png' })

const stroke = (points, size, color) =>
  page.evaluate(
    (points, size, color) => {
      const { brush, engine } = window.lydia
      engine.setBrush({ size, color, tool: 'brush', opacity: 1 })
      brush.startStroke(points[0][0], points[0][1], points[0][2])
      for (const [x, y, p] of points.slice(1)) brush.continueStroke([{ x, y, pressure: p }])
      brush.endStroke()
    },
    points,
    size,
    color,
  )
const wave = (x0, x1, y, amplitude, n) =>
  Array.from({ length: n + 1 }, (_, i) => [
    x0 + ((x1 - x0) * i) / n,
    y + Math.sin((i / n) * Math.PI * 2) * amplitude,
    0.35 + 0.65 * Math.sin((i / n) * Math.PI),
  ])
await choose('Bristles')
await stroke(wave(80, 1400, 130, 50, 90), 120, '#7a3b10')
await stroke(wave(80, 1400, 300, 30, 90), 70, '#1d5a8c')
await stroke(wave(80, 1400, 420, 60, 90), 40, '#000000')
await choose('Sponge')
await stroke(wave(80, 1400, 620, 40, 60), 110, '#2f7a3a')
await stroke(wave(80, 1400, 790, 30, 60), 60, '#a02060')
await page.evaluate(() => {
  const { world, projection } = window.lydia
  world.scale.set(1)
  projection.setZoom(1)
  world.position.set(10, 10)
})
await sleep(500)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/bristles-sponge.png' })

// ----- The Brush Designer -----
await page.evaluate(() => {
  window.confirm = () => true
})
await click('Back')
await sleep(300)
await click('Open Brush Designer')
await page.waitForFunction(() => window.lydia?.engine && window.lydia.app.renderer, { timeout: 60000 })
await sleep(500)
// A round blob as the tip
await page.evaluate(() => window.lydia.engine.setBrush({ size: 300 }))
const at = await page.evaluate(() => {
  const { app, world } = window.lydia
  const box = app.canvas.getBoundingClientRect()
  return [box.left + world.position.x + 256 * world.scale.x, box.top + world.position.y + 256 * world.scale.y]
})
await page.mouse.move(at[0], at[1])
await page.mouse.down()
await page.mouse.move(at[0] + 4, at[1], { steps: 2 })
await page.mouse.up()
await page.waitForFunction(() => document.querySelector('.designer-panel .hint').textContent.startsWith('Tip:'), {
  timeout: 10000,
})
await sleep(300)
const disabledBefore = await page.$$eval('.shape-controls input:disabled', els => els.length)
const setSlider = (label, value) =>
  page.evaluate(
    (label, value) => {
      const row = [...document.querySelectorAll('.slider-row')].find(r => r.querySelector('span').textContent === label)
      const input = row.querySelector('input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    label,
    value,
  )
const testPaint = () =>
  page.$eval('.test-canvas', c => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let n = 0,
      sum = 0
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 0) n++
      sum += d[i]
    }
    return { n, sum }
  })
const plain = await testPaint()
await setSlider('Amount', 100)
await sleep(300)
const disabledAfter = await page.$$eval('.shape-controls input:disabled', els => els.length)
await setSlider('Contrast', 400)
await sleep(300)
const noisy = await testPaint()
check(
  'the noise controls are off until there is noise, then on',
  disabledBefore === 5 && disabledAfter === 0,
  `${disabledBefore} → ${disabledAfter} off`,
)
await (await page.$('.designer-panel')).screenshot({ path: OUT + '/designer-noise-2.png' })
// Export: the file has the noise
await page.evaluate(() => {
  window.downloads = []
  HTMLAnchorElement.prototype.click = function () {
    window.downloads.push(this.href)
  }
})
await page.evaluate(() =>
  [...document.querySelectorAll('.check-row')]
    .find(r => r.textContent === 'Wash')
    .querySelector('input')
    .click(),
)
await sleep(300)
const washed = await testPaint()
check(
  'the test area follows the noise and the wash',
  noisy.sum < plain.sum && washed.sum < noisy.sum,
  `${plain.sum} → ${noisy.sum} → washed ${washed.sum}`,
)
await click('Export file')
await sleep(300)
const file = JSON.parse(await page.evaluate(async () => (await fetch(window.downloads.at(-1))).text()))
check(
  'the exported brush keeps its noise and wash',
  file.noiseAmount === 1 && file.noiseContrast === 4 && file.wash === true,
  JSON.stringify({ noiseAmount: file.noiseAmount, noiseContrast: file.noiseContrast, wash: file.wash }),
)

console.log(problems.length ? 'problems:\n' + problems.slice(0, 8).join('\n') : 'no errors or warnings in the console')
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
