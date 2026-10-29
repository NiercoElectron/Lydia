// Layers: delete, move by dragging, rename, and undo/redo of every layer change
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import fs from 'fs'
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
  if ((m.type() === 'error' || m.type() === 'warn') && !m.text().includes('willReadFrequently'))
    problems.push(m.type() + ': ' + m.text())
})
page.on('dialog', d => d.accept())
await page.setViewport({ width: 1400, height: 900 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
const engineReady = () =>
  page.waitForFunction(() => window.lydia?.engine && window.lydia.app.renderer, { timeout: 90000 })
const clickButton = async text => {
  await page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).click(), text)
  await sleep(50)
}
const toClient = (x, y) =>
  page.evaluate(
    (x, y) => {
      const { app } = window.lydia
      const world = window.lydia.world
      const r = app.canvas.getBoundingClientRect()
      return [r.left + world.position.x + x * world.scale.x, r.top + world.position.y + y * world.scale.y]
    },
    x,
    y,
  )
async function line(x1, y1, x2, y2) {
  const [a, b] = await toClient(x1, y1),
    [c, d] = await toClient(x2, y2)
  await page.mouse.move(a - 5, b)
  await page.mouse.move(a, b)
  await sleep(100)
  await page.mouse.down()
  for (let i = 0; i <= 30; i++) await page.mouse.move(a + ((c - a) * i) / 30, b + ((d - b) * i) / 30)
  await page.mouse.up()
  await sleep(50)
}
const idle = () => page.waitForFunction(() => !window.lydia.projection.isUpdating(), { timeout: 120000, polling: 50 })
const screenPx = async pts => {
  await idle()
  return page.evaluate(pts => {
    const { app } = window.lydia
    app.render()
    const c = document.createElement('canvas')
    c.width = app.canvas.width
    c.height = app.canvas.height
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(app.canvas, 0, 0)
    const world = window.lydia.world
    return pts.map(([x, y]) =>
      Array.from(
        ctx
          .getImageData(
            Math.round(world.position.x + x * world.scale.x),
            Math.round(world.position.y + y * world.scale.y),
            1,
            1,
          )
          .data.slice(0, 3),
      ).join(','),
    )
  }, pts)
}
const checksum = async () => {
  await idle()
  return page.evaluate(() => {
    const { app, projection } = window.lydia
    let h = 0
    for (const t of projection.tiles.values()) {
      const p = app.renderer.extract.pixels(t).pixels
      for (let i = 0; i < p.length; i += 7) h = (h * 31 + p[i]) | 0
    }
    return h
  })
}
const exactAfterComposeAll = async () => {
  const a = await checksum()
  await page.evaluate(() => window.lydia.projection.composeAll())
  return a === (await checksum())
}
const snapshot = () => page.evaluate(() => window.lydia.engine.getSnapshot())
const names = async () => (await snapshot()).layers.map(l => l.name).join(',')
const activeName = async () => {
  const s = await snapshot()
  return s.layers.find(l => l.id === s.activeLayerId)?.name
}
const undo = async () => {
  await clickButton('Undo')
  await sleep(50)
}
const redo = async () => {
  await clickButton('Redo')
  await sleep(50)
}
const color = async hex => {
  await page.$eval(
    'input[type=color]',
    (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    hex,
  )
}
const rowButton = async name => {
  for (const b of await page.$$('.layers-list button.layer-name'))
    if ((await b.evaluate(el => el.textContent)) === name) return b
  throw new Error('no row ' + name)
}
const is = (s, rgb, tolerance = 40) =>
  s
    .split(',')
    .map(Number)
    .every((v, i) => Math.abs(v - rgb[i]) <= tolerance)
const RED = [230, 57, 70],
  BLUE = [29, 53, 230],
  BLACK = [0, 0, 0],
  WHITE = [255, 255, 255]

// ----- Three layers: black across, red down, blue on a diagonal -----
await page.goto('http://localhost:5198/', { waitUntil: 'networkidle0' })
for (const el of await (async () => {
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find(b => b.textContent === 'New project…').click(),
  )
  await page.waitForSelector('dialog.new-project[open]')
  return (await page.$$('dialog input[type=number]')).slice(0, 2)
})()) {
  await el.click({ clickCount: 3 })
  await el.type('3000')
}
await page.click('button[type=submit]')
await engineReady()
await sleep(500)
for (let i = 0; i < 8; i++) await page.keyboard.press(']')
check(
  'Delete layer is off with a single layer',
  await page.evaluate(
    () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Delete layer').disabled,
  ),
)
await line(300, 1500, 2700, 1500)
await clickButton('New layer')
await color('#e63946')
await line(1500, 300, 1500, 2700)
await clickButton('New layer')
await color('#1d35e6')
await line(600, 600, 2400, 2400)
const cross = [1500, 1500],
  redOnly = [1500, 700],
  blueOnly = [900, 900],
  blackOnly = [700, 1500]
let px = await screenPx([cross, redOnly, blueOnly, blackOnly])
check('three layers painted', is(px[0], BLUE) && is(px[1], RED) && is(px[2], BLUE) && is(px[3], BLACK), px.join(' | '))
check('names, from the bottom', (await names()) === 'Layer 1,Layer 2,Layer 3')

// ----- Delete -----
await clickButton('Delete layer')
px = await screenPx([cross, blueOnly])
check(
  'Delete layer removes the active layer and its paint',
  (await names()) === 'Layer 1,Layer 2' && is(px[0], RED) && is(px[1], WHITE),
  px.join(' | '),
)
check('the layer under it becomes active', (await activeName()) === 'Layer 2')
const kept = await page.evaluate(() => [...window.lydia.history.storedTiles()].length)
check("the deleted layer's tiles stay in the history (and count for the memory budget)", kept > 0, `${kept} tiles`)
await undo()
px = await screenPx([cross, blueOnly])
check(
  'undo brings it back, in its place, active again',
  (await names()) === 'Layer 1,Layer 2,Layer 3' &&
    (await activeName()) === 'Layer 3' &&
    is(px[0], BLUE) &&
    is(px[1], BLUE),
  px.join(' | '),
)
await redo()
check('redo deletes it again', (await names()) === 'Layer 1,Layer 2' && is((await screenPx([blueOnly]))[0], WHITE))
await undo()

// ----- Move by dragging: Layer 1 (black, shown at the bottom) to the top -----
let from = await (await rowButton('Layer 1')).boundingBox()
let to = await (await rowButton('Layer 3')).boundingBox()
await page.mouse.move(from.x + 20, from.y + from.height / 2)
await page.mouse.down()
for (let i = 1; i <= 10; i++)
  await page.mouse.move(from.x + 20, from.y + from.height / 2 + ((to.y + 2 - from.y - from.height / 2) * i) / 10)
const line1 = await page.evaluate(() =>
  [...document.querySelectorAll('.layers-list li')].map(li => li.className).join('|'),
)
await page.mouse.up()
await sleep(100)
check(
  'while dragging, a line shows where it goes and the row is faded',
  line1.includes('drop-before') && line1.includes('dragging'),
  line1,
)
px = await screenPx([cross])
check(
  'dragging Layer 1 to the top puts the black over the others',
  (await names()) === 'Layer 2,Layer 3,Layer 1' && is(px[0], BLACK),
  px[0],
)
check('the dragged layer becomes active', (await activeName()) === 'Layer 1')
await undo()
check(
  'undo puts it back at the bottom',
  (await names()) === 'Layer 1,Layer 2,Layer 3' && is((await screenPx([cross]))[0], BLUE),
)
await redo()
check(
  'redo moves it up again',
  (await names()) === 'Layer 2,Layer 3,Layer 1' && is((await screenPx([cross]))[0], BLACK),
)
await undo()
// a click that moves only a little stays a click
from = await (await rowButton('Layer 2')).boundingBox()
await page.mouse.move(from.x + 20, from.y + 8)
await page.mouse.down()
await page.mouse.move(from.x + 22, from.y + 10)
await page.mouse.up()
await sleep(50)
check(
  'a click (moving 2 px) selects without moving',
  (await names()) === 'Layer 1,Layer 2,Layer 3' && (await activeName()) === 'Layer 2',
)
check('projection exact after moving and deleting', await exactAfterComposeAll())

// ----- Rename -----
await (await rowButton('Layer 2')).click({ clickCount: 2 })
await sleep(100)
let field = await page.$('.layers-list input.layer-name')
check(
  'double-click opens the name for typing, all selected',
  !!field &&
    (await field.evaluate(
      el => el === document.activeElement && el.selectionStart === 0 && el.selectionEnd === el.value.length,
    )),
)
await page.keyboard.type('Sky b')
await page.keyboard.press('Enter')
await sleep(50)
check(
  'Enter keeps the new name, and typing B did not switch to the brush... or E',
  (await names()) === 'Layer 1,Sky b,Layer 3',
)
await undo()
check('undo restores the old name', (await names()) === 'Layer 1,Layer 2,Layer 3')
await redo()
check('redo renames again', (await names()) === 'Layer 1,Sky b,Layer 3')
await (await rowButton('Sky b')).click({ clickCount: 2 })
await sleep(100)
await page.keyboard.type('Nope')
await page.keyboard.press('Escape')
await sleep(50)
check('Escape keeps the old name', (await names()) === 'Layer 1,Sky b,Layer 3')
await (await rowButton('Sky b')).click({ clickCount: 2 })
await sleep(100)
await page.keyboard.press('Backspace')
await page.keyboard.press('Enter')
await sleep(50)
check('an empty name keeps the old one', (await names()) === 'Layer 1,Sky b,Layer 3')
await undo()
check('Escape and the empty name added no undo steps', (await names()) === 'Layer 1,Layer 2,Layer 3')

// ----- Hide and opacity -----
await page.evaluate(() => [...document.querySelectorAll('.layers-list li input[type=checkbox]')][0].click())
await sleep(50) // Layer 3, the top
check('hiding Layer 3', is((await screenPx([cross]))[0], RED))
await undo()
check('undo shows it again', is((await screenPx([cross]))[0], BLUE))
await redo()
check('redo hides it again', is((await screenPx([cross]))[0], RED))
await undo()
await (await rowButton('Layer 3')).click()
await sleep(50)
const before = await checksum()
await page.evaluate(() => {
  const el = document.querySelector('.opacity input')
  for (const v of [80, 60, 40, 30]) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  el.dispatchEvent(new Event('change', { bubbles: true }))
})
check('opacity dragged to 30%', (await snapshot()).layers[2].opacity === 0.3 && (await checksum()) !== before)
await undo()
check(
  'one undo takes the whole drag back to 100%',
  (await snapshot()).layers[2].opacity === 1 && (await checksum()) === before,
)
await redo()
check('redo: 30% again', (await snapshot()).layers[2].opacity === 0.3)
await undo()
check('projection exact after all of it', await exactAfterComposeAll())

// ----- Delete right after painting (pixels still only on the graphics card), then undo -----
await clickButton('New layer')
await color('#000000')
await line(300, 2700, 2700, 2700)
await clickButton('Delete layer')
check('painted and deleted at once: the paint is gone', is((await screenPx([[1000, 2700]]))[0], WHITE))
await sleep(1500) // the background saving reads the deleted layer's tiles meanwhile
await undo()
check('undo brings that paint back', is((await screenPx([[1000, 2700]]))[0], BLACK))

// ----- A layer that leaves the history for good leaves the graphics card too -----
await page.evaluate(() => {
  window.gone = window.lydia.stack.active
}) // the layer with the bottom line
await undo() // the line
await undo() // adding the layer
check('undo of New layer removes it', (await names()) === 'Layer 1,Layer 2,Layer 3')
const cachedBefore = await page.evaluate(() => window.lydia.gpu.getCached(window.gone, '3,10') !== undefined)
await line(300, 300, 600, 300) // a new change: the undone steps can't come back
const cachedAfter = await page.evaluate(() => window.lydia.gpu.getCached(window.gone, '3,10') !== undefined)
check(
  "after a new change, the removed layer's tiles leave the graphics card",
  cachedBefore && !cachedAfter,
  `${cachedBefore} -> ${cachedAfter}`,
)

// ----- Saving keeps the order and the names -----
await (await rowButton('Layer 2')).click({ clickCount: 2 })
await sleep(100)
await page.keyboard.type('Sky')
await page.keyboard.press('Enter')
await sleep(50)
from = await (await rowButton('Layer 1')).boundingBox()
to = await (await rowButton('Layer 3')).boundingBox()
await page.mouse.move(from.x + 20, from.y + from.height / 2)
await page.mouse.down()
for (let i = 1; i <= 10; i++)
  await page.mouse.move(
    from.x + 20,
    from.y + from.height / 2 + ((to.y + to.height - 2 - from.y - from.height / 2) * i) / 10,
  )
await page.mouse.up()
await sleep(100)
const order = await names()
const sum = await checksum()
const saved = await page.evaluate(async () => {
  const blob = await window.lydia.engine.saveProject()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(s)
})
fs.writeFileSync(OUT + '/layers.lyd', Buffer.from(saved, 'base64'))
await clickButton('Back')
await sleep(300)
const [chooser] = await Promise.all([page.waitForFileChooser(), clickButton('Open project')])
await chooser.accept([OUT + '/layers.lyd'])
await engineReady()
await sleep(800)
check('saved and opened: same order and names', (await names()) === order, `${order} -> ${await names()}`)
check('saved and opened: same image', (await checksum()) === sum)
check('a newly opened project has nothing to undo', !(await snapshot()).canUndo)

console.log(problems.length ? 'problems:\n' + problems.slice(0, 8).join('\n') : 'no errors or warnings in the console')
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
