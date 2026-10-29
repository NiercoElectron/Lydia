// Exporting enlarged: the Scale next to the exports, kept with the drawing; every pixel a square of whole pixels,
// nothing blended, colors exact, the DPI multiplied, the file name; which scales fit
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
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}

// ----- In the app -----
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage()
const problems = []
page.on('pageerror', e => problems.push('PAGE ERROR ' + e))
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warn') problems.push(m.type() + ': ' + m.text())
})
await page.setViewport({ width: 1600, height: 900 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
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
const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
const setSize = size =>
  page.evaluate(size => {
    const input = document.querySelector('label[title^="Brush size"] input[type=range]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(size))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, size)
const ppButton = () =>
  page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Pixel-perfect')
    return button ? button.getAttribute('aria-pressed') : null
  })
const colorAt = (x, y) => page.evaluate((x, y) => window.lydia.projection.colorAt(x, y), x, y)
const isPainted = async (x, y) => (await colorAt(x, y)) !== '#ffffff'
const moveTo = async (x, y) => {
  const p = await pageOf(x, y)
  await page.mouse.move(p.x, p.y)
  await frames()
}
const chooseBrush = name =>
  page.evaluate(
    name => [...document.querySelectorAll('button.brush')].find(b => b.textContent.trim().startsWith(name)).click(),
    name,
  )
const clickAt = async (x, y) => {
  const p = await pageOf(x, y)
  await page.mouse.move(p.x, p.y)
  await frames()
  await page.mouse.down()
  await page.mouse.up()
  await sleep(120)
}
// Export with the engine and look at the image: its size, its resolution (DPI) and its pixels
const exported = type =>
  page.evaluate(async type => {
    const blob = await window.lydia.engine.exportImage(type)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let dpi = null
    if (type === 'png') {
      for (let at = 8; at + 12 <= bytes.length;) {
        const view = new DataView(bytes.buffer, at)
        const length = view.getUint32(0)
        const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
        if (name === 'pHYs') dpi = Math.round(view.getUint32(8) * 0.0254)
        if (name === 'IDAT') break
        at += 12 + length
      }
    } else {
      // JFIF: units at byte 13, density across at 14–15
      dpi = (bytes[14] << 8) | bytes[15]
    }
    const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bitmap, 0, 0)
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
    const at = (x, y) => [...pixels.subarray((y * bitmap.width + x) * 4, (y * bitmap.width + x) * 4 + 4)].join()
    // How many pixels differ from the first of their square of window.__scale pixels: none, enlarged right
    return {
      width: bitmap.width,
      height: bitmap.height,
      dpi,
      blocks: (() => {
        const s = window.__scale
        let uneven = 0
        for (let y = 0; y < bitmap.height; y += s)
          for (let x = 0; x < bitmap.width; x += s) {
            const first = at(x, y)
            for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) if (at(x + i, y + j) !== first) uneven++
          }
        return uneven
      })(),
      corner: at(40, 40),
      beside: at(44, 40),
      soft: [20, 21, 22, 23].map(x => at(x * window.__scale, 30 * window.__scale)),
    }
  }, type)

// ----- The rules -----
const { fitsExport, EXPORT_SCALES } = await server.ssrLoadModule('/src/engine/projectFile.ts')
check('scales 1, 2, 3, 4, 6 and 8', EXPORT_SCALES.join() === '1,2,3,4,6,8')
check('10000×10000 only at 1×', fitsExport(10000, 10000, 1) && !fitsExport(10000, 10000, 2))
check(
  "1250×1250 at 8× has as many pixels as 10000×10000: fits; 1251 doesn't",
  fitsExport(1250, 1250, 8) && !fitsExport(1251, 1250, 8),
)
check("2048×100 at 8× is 16384 across: fits; 2049 doesn't", fitsExport(2048, 100, 8) && !fitsExport(2049, 100, 8))
check(
  "no more pixels than the biggest paper: 5000×5000 at 2× fits, 5001×5000 doesn't",
  fitsExport(5000, 5000, 2) && !fitsExport(5001, 5000, 2),
)

// ----- In the app -----
await newDrawing(64, 48)
const options = () =>
  page.evaluate(() => {
    const select = [...document.querySelectorAll('label')]
      .find(l => l.textContent.trim().startsWith('Scale'))
      .querySelector('select')
    return { values: [...select.options].map(o => o.value).join(), value: select.value, disabled: select.disabled }
  })
const first = await options()
check(
  'Scale next to the exports: 1× at first, all six offered',
  first.value === '1' && first.values === '1,2,3,4,6,8' && !first.disabled,
  JSON.stringify(first),
)
await chooseBrush('Pixel')
await sleep(300)
await setSize(1)
await clickAt(10.5, 10.5)
// A soft stroke too, half see-through, to see that colors stay exact
await chooseBrush('Soft round')
await sleep(300)
await setSize(6)
await clickAt(21.5, 30.5)
await page.evaluate(() => {
  window.__scale = 1
})
const plain = await exported('png')
check('1×: 64×48 at 300 DPI', plain.width === 64 && plain.height === 48 && plain.dpi === 300, JSON.stringify(plain))

await page.evaluate(() => {
  const select = [...document.querySelectorAll('label')]
    .find(l => l.textContent.trim().startsWith('Scale'))
    .querySelector('select')
  select.value = '4'
  select.dispatchEvent(new Event('change', { bubbles: true }))
})
await sleep(200)
check('choosing 4×: shown', (await options()).value === '4')
await page.evaluate(() => {
  window.__scale = 4
})
const big = await exported('png')
check(
  '4×: 256×192 at 1200 DPI',
  big.width === 256 && big.height === 192 && big.dpi === 1200,
  `${big.width}×${big.height} ${big.dpi}`,
)
check('4×: every square of 4×4 one color, nothing blended', big.blocks === 0, String(big.blocks))
check(
  '4×: the pixel at (10, 10) is the square from (40, 40), the next one white',
  big.corner === '0,0,0,255' && big.beside === '255,255,255,255',
  `${big.corner} / ${big.beside}`,
)
check(
  "4×: the soft stroke's colors exactly as at 1×",
  big.soft.join('|') === plain.soft.join('|') && plain.soft.some(c => c !== '255,255,255,255' && c !== '0,0,0,255'),
  big.soft.join(' | '),
)
const jpeg = await exported('jpeg')
check(
  'JPEG at 4×: 256×192 at 1200 DPI',
  jpeg.width === 256 && jpeg.height === 192 && jpeg.dpi === 1200,
  `${jpeg.width}×${jpeg.height} ${jpeg.dpi}`,
)

// The file name says it
const names = []
await page.exposeFunction('__downloaded', name => names.push(name))
await page.evaluate(() => {
  const click = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) window.__downloaded(this.download)
    else click.call(this)
  }
})
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Export PNG').click())
await sleep(800)
check('the file name says @4x', /^lydia-.+@4x\.png$/.test(names[0] ?? ''), names.join())

// Kept with the drawing: saved, read again
const saved = await page.evaluate(async () => {
  const { parseProject } = await import('/src/engine/projectFile.ts')
  const blob = await window.lydia.engine.saveProject()
  return parseProject(await blob.arrayBuffer()).exportScale
})
check('saved with the drawing: 4', saved === 4, String(saved))

// A transparent paper at 3×: see-through stays see-through
await page.evaluate(() => {
  window.confirm = () => true
})
await click('Back')
await sleep(300)
await page.evaluate(() => delete window.lydia)
await click('New project…')
await page.waitForSelector('dialog.new-project[open]')
const transparent = await page.evaluate(() => {
  const button = [...document.querySelectorAll('dialog button')].find(b => b.textContent === 'Transparent')
  if (button.getAttribute('aria-pressed') !== 'true') button.click()
  return true
})
const inputs = await page.$$('dialog input[type=number]')
for (const [i, value] of [
  [0, 40],
  [1, 40],
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
await page.evaluate(() => window.lydia.engine.setExportScale(3))
await chooseBrush('Pixel')
await sleep(300)
await setSize(1)
await clickAt(5.5, 5.5)
await page.evaluate(() => {
  window.__scale = 3
})
const clear = await exported('png')
check(
  'transparent paper at 3×: 120×120, squares of one color',
  transparent && clear.width === 120 && clear.blocks === 0,
  `${transparent} ${clear.width} ${clear.blocks}`,
)
const corners3 = await page.evaluate(async () => {
  const bitmap = await createImageBitmap(await window.lydia.engine.exportImage('png'), { premultiplyAlpha: 'none' })
  const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0)
  return [
    ctx.getImageData(15, 15, 1, 1).data[3],
    ctx.getImageData(17, 17, 1, 1).data[3],
    ctx.getImageData(18, 15, 1, 1).data[3],
  ]
})
check(
  '…the pixel at (5, 5) opaque from (15, 15) to (17, 17), see-through after',
  corners3.join() === '255,255,0',
  corners3.join(),
)

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
