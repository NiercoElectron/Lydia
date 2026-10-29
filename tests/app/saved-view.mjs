// A saved drawing opens with the view it had: zoom, angle, flip and the point in the middle
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

// ----- A saved drawing opens as it was shown -----

const view = () => page.evaluate(() => window.lydia.engine.getView())
// Where a point of the paper is on the screen, and which point of the paper is in the middle of the drawing area
const middlePaper = () =>
  page.evaluate(() => {
    const { app, world } = window.lydia
    return world.toLocal({ x: app.screen.width / 2, y: app.screen.height / 2 })
  })
// Save the drawing, keep the file in the page, and open it again from the start screen
async function saveAndReopen(changeFile, arg) {
  await page.evaluate(async () => {
    window.__saved = await (await window.lydia.engine.saveProject()).arrayBuffer()
  })
  if (changeFile) await page.evaluate(changeFile, arg)
  page.once('dialog', d => d.accept())
  await click('Back')
  await sleep(300)
  await page.evaluate(() => delete window.lydia)
  await page.evaluate(() => {
    const input = document.querySelector('input[type=file][accept=".lyd"]')
    const data = new DataTransfer()
    data.items.add(new File([window.__saved], 'saved.lyd'))
    input.files = data.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForFunction(() => window.lydia?.engine && document.querySelectorAll('button.brush').length > 0, {
    timeout: 90000,
  })
  await sleep(400)
}
const near = (a, b, within = 0.01) => Math.abs(a - b) <= within

await page.evaluate(() => delete window.lydia)
await newDrawing(800, 600)
const fitted = await view()
check('a new drawing shows the whole paper, straight', fitted.rotation === 0 && !fitted.flipped, JSON.stringify(fitted))

// Turn it with the rotate tool, zoom in with Ctrl + wheel, flip it with M
await keys('r')
const box = await page.$eval('canvas', c => {
  const r = c.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }
})
await page.mouse.move(box.x + 200, box.y)
await page.mouse.down()
await page.mouse.move(box.x, box.y + 200, { steps: 10 })
await page.mouse.up()
await page.mouse.move(box.x + 120, box.y - 80)
await page.keyboard.down('Control')
await page.mouse.wheel({ deltaY: -400 })
await page.keyboard.up('Control')
await keys('m')
await sleep(100)
const before = await view()
const centerBefore = await middlePaper()
check(
  'the view is turned, zoomed and flipped',
  Math.abs(before.rotation) > 10 && before.zoom > fitted.zoom * 1.5 && before.flipped,
  JSON.stringify(before),
)

await saveAndReopen()
const after = await view()
const centerAfter = await middlePaper()
check(
  'it opens with the same zoom, angle and flip',
  near(after.zoom, before.zoom, 1e-6) &&
    near(after.rotation, before.rotation, 1e-6) &&
    after.flipped === before.flipped,
  `${JSON.stringify(before)} → ${JSON.stringify(after)}`,
)
check(
  '…and the same point of the paper in the middle',
  near(centerAfter.x, centerBefore.x, 0.01) && near(centerAfter.y, centerBefore.y, 0.01),
  `${JSON.stringify(centerBefore)} → ${JSON.stringify(centerAfter)}`,
)

// In a window of another size, the same point stays in the middle
await page.evaluate(async () => {
  window.__saved = await (await window.lydia.engine.saveProject()).arrayBuffer()
})
await page.setViewport({ width: 1200, height: 800 })
await sleep(300)
await page.evaluate(() => delete window.lydia)
page.once('dialog', d => d.accept())
await click('Back')
await sleep(300)
await page.evaluate(() => {
  const input = document.querySelector('input[type=file][accept=".lyd"]')
  const data = new DataTransfer()
  data.items.add(new File([window.__saved], 'saved.lyd'))
  input.files = data.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
})
await page.waitForFunction(() => window.lydia?.engine && document.querySelectorAll('button.brush').length > 0, {
  timeout: 90000,
})
await sleep(400)
const smaller = await view()
const centerSmaller = await middlePaper()
check(
  'in a smaller window, the same view around the same point',
  near(smaller.zoom, before.zoom, 1e-6) &&
    near(smaller.rotation, before.rotation, 1e-6) &&
    smaller.flipped &&
    near(centerSmaller.x, centerBefore.x, 0.01) &&
    near(centerSmaller.y, centerBefore.y, 0.01),
  `${JSON.stringify(centerSmaller)}`,
)
await page.setViewport({ width: 1600, height: 900 })
await sleep(300)

// A file saved before (no view in its header), and one with a view that makes no sense: the whole paper, straight
for (const [name, value] of [
  ['without a view', undefined],
  ['with a broken view', { zoom: -1, rotation: 'x', flipped: 2, center: null }],
]) {
  await saveAndReopen(async value => {
    const bytes = new Uint8Array(window.__saved)
    const length = new DataView(window.__saved).getUint32(8, true)
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + length)))
    if (value === undefined) delete header.view
    else header.view = value
    const headerBytes = new TextEncoder().encode(JSON.stringify(header))
    const start = new Uint8Array(12)
    start.set(bytes.subarray(0, 8))
    new DataView(start.buffer).setUint32(8, headerBytes.length, true)
    window.__saved = await new Blob([start, headerBytes, bytes.subarray(12 + length)]).arrayBuffer()
  }, value)
  const opened = await view()
  check(
    `a file ${name} opens showing the whole paper, straight`,
    opened.rotation === 0 && !opened.flipped && near(opened.zoom, fitted.zoom, 1e-6),
    JSON.stringify(opened),
  )
}

console.log(problems.length ? 'problems: ' + problems.slice(0, 8).join(' | ') : 'no errors or warnings in the console')
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
