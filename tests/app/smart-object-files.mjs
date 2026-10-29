// Smart objects in files: saved as version 3 with their source, bounds, corners and whole pixels, opened again as
// smart objects with the same picture and their exact pixels; files without one still version 2, older files still
// opening, and folded corners making a damaged file
import fs from 'node:fs'
// dragged; Shift keeping it straight; paint moved off the paper; a click doing nothing; and a whole 10000² layer
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { CACHE_DIR, FILES, LAUNCH, OUT, ROOT } from './setup.mjs'
const server = await createServer({
  root: ROOT,
  configFile: ROOT + '/vite.config.ts',
  cacheDir: CACHE_DIR,
  server: { port: 5198, strictPort: true },
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
const stroke = (points, color, size, tool = 'brush') =>
  page.evaluate(
    async (points, color, size, tool) => {
      const library = await import('/src/brushLibrary.ts')
      const brush = library.builtInBrush('hard-round')
      const { engine } = window.lydia
      engine.setBrushTip(await library.tipOf(brush), brush.preset)
      engine.setBrush({ size, color, tool, opacity: 1 })
      window.lydia.brush.startStroke(points[0][0], points[0][1], 1)
      window.lydia.brush.continueStroke(points.slice(1).map(([x, y]) => ({ x, y, pressure: 1 })))
      window.lydia.brush.endStroke()
    },
    points,
    color,
    size,
    tool,
  )
// A block of color: wide strokes side by side
async function block(left, top, right, bottom, color) {
  for (let y = top + 10; y < bottom; y += 15)
    await stroke(
      [
        [left + 10, y],
        [right - 10, y],
      ],
      color,
      20,
    )
}

const waitTransform = () =>
  page.waitForFunction(() => window.lydia.engine.getSnapshot().transform !== null, { timeout: 60000, polling: 10 })
const startTransform = async () => {
  await click('Transform')
  await waitTransform()
}
const apply = async () => {
  await page.keyboard.press('Enter')
  await waitIdle()
}
const save = async name => {
  const saved = await page.evaluate(async () => {
    const blob = await window.lydia.engine.saveProject()
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let s = ''
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return btoa(s)
  })
  const bytes = Buffer.from(saved, 'base64')
  fs.writeFileSync(OUT + '/' + name, bytes)
  return JSON.parse(bytes.subarray(12, 12 + bytes.readUInt32LE(8)).toString())
}
const open = async name => {
  page.removeAllListeners('dialog')
  page.on('dialog', d => d.accept())
  await click('Back')
  await sleep(300)
  const [chooser] = await Promise.all([page.waitForFileChooser(), click('Open project')])
  await chooser.accept([name.includes('/') ? name : OUT + '/' + name]) // a drawing it saved, or a whole path
  await page.waitForFunction(() => window.lydia?.engine && document.querySelectorAll('button.brush').length > 0, {
    timeout: 60000,
  })
  await sleep(500)
}
const layersOf = async () => (await snapshot()).layers

await newDrawing(1500, 1000)
await block(200, 200, 400, 400, '#ff0000')
await stroke(
  [
    [220, 300],
    [380, 300],
  ],
  '#0000ff',
  6,
)
await waitIdle()
await page.keyboard.press('v')
await startTransform()
await click('Whole')
await drag([
  [400, 400],
  [500, 500],
  [600, 600],
]) // twice as big, whole pixels
await apply()
await page.evaluate(() => window.lydia.engine.addLayer())
await stroke(
  [
    [800, 800],
    [1200, 800],
  ],
  '#00aa00',
  30,
)
await waitIdle()
const shownBefore = [
  await shownAt(550, 550),
  await shownAt(300, 400),
  await shownAt(1000, 800),
  await shownAt(700, 700),
]

// ----- Saving -----
const header = await save('smart.lyd')
check('a drawing with a smart object is saved as version 3', header.version === 3, `version ${header.version}`)
const smart = header.layers[0].smart
check(
  '…with the smart object: its source, bounds, corners and whole pixels',
  smart && smart.tiles.length > 0 && smart.bounds.width > 0 && smart.corners.length === 4 && smart.smooth === false,
  JSON.stringify(smart && { ...smart, tiles: smart.tiles.length }),
)
check('the other layer has no smart object', header.layers[1].smart === undefined)

// ----- Opening it -----
await open('smart.lyd')
const layers = await layersOf()
check('opened, the smart object is still one', layers[0].isSmart && !layers[1].isSmart, JSON.stringify(layers))
const shownAfter = [await shownAt(550, 550), await shownAt(300, 400), await shownAt(1000, 800), await shownAt(700, 700)]
check(
  '…and the drawing looks the same',
  JSON.stringify(shownAfter) === JSON.stringify(shownBefore),
  `${shownBefore} → ${shownAfter}`,
)
await page.evaluate(id => window.lydia.engine.selectLayer(id), layers[0].id)
await page.keyboard.press('v')
await startTransform()
const isWhole = await page.evaluate(() => window.lydia.engine.getSnapshot().transform.smooth === false)
check('…it still uses whole pixels', isWhole)
await drag([
  [600, 600],
  [500, 500],
  [400, 400],
]) // back to its first size
await apply()
const original = await page.evaluate(async () => {
  const { stack, gpu, memory } = window.lydia
  while (gpu.hasUnsaved()) await new Promise(r => requestAnimationFrame(r))
  const layer = stack.layers[0]
  let same = 0,
    different = 0
  for (const [key, tile] of layer.smart.source.tiles) {
    const a = memory.unpack(tile, 256, 256).slice()
    const own = layer.tiles.get(key)
    const b = own ? memory.unpack(own, 256, 256) : new Uint8ClampedArray(a.length)
    for (let i = 0; i < a.length; i++) a[i] === b[i] ? same++ : different++
  }
  return { same, different }
})
check(
  '…and back at its first size, it has its exact original pixels',
  original.different === 0,
  JSON.stringify(original),
)

// ----- Without smart objects, version 2 -----
await page.evaluate(() => window.lydia.engine.convertToPixels())
const plain = await save('plain.lyd')
check(
  'a drawing without smart objects is still saved as version 2',
  plain.version === 2 && plain.layers.every(l => l.smart === undefined),
  `version ${plain.version}`,
)

// ----- An older file, and a damaged one -----
await open(FILES + '/transparent-v2.lyd')
check('a file from before still opens', (await layersOf()).length > 0)
const damaged = await page.evaluate(
  async bytes => {
    const { parseProject } = await import('/src/engine/projectFile.ts')
    const file = Uint8Array.from(atob(bytes), c => c.charCodeAt(0))
    const length = new DataView(file.buffer).getUint32(8, true)
    const header = JSON.parse(new TextDecoder().decode(file.subarray(12, 12 + length)))
    header.layers[0].smart.corners[2] = header.layers[0].smart.corners[0] // folded over itself
    const text = new TextEncoder().encode(JSON.stringify(header))
    const out = new Uint8Array(12 + text.length + file.length - 12 - length)
    out.set(file.subarray(0, 8))
    new DataView(out.buffer).setUint32(8, text.length, true)
    out.set(text, 12)
    out.set(file.subarray(12 + length), 12 + text.length)
    try {
      parseProject(out.buffer)
      return 'opened'
    } catch (error) {
      return error.message
    }
  },
  fs.readFileSync(OUT + '/smart.lyd').toString('base64'),
)
check(
  'a smart object with corners folded over itself is a damaged file',
  damaged === 'LYD-104: This project file is damaged.',
  damaged,
)

console.log(problems.length ? 'problems: ' + problems.slice(0, 8).join(' | ') : 'no errors or warnings in the console')
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
