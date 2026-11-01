// Filters (decision 80): the menu; hue, saturation and lightness; levels; a blur, with no seams between the tiles at any
// radius; the alpha kept; a selection and a locked transparency; the preview leaving the layer alone, Esc and Enter; one
// step of undo; a saved drawing during the preview
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { CACHE_DIR, LAUNCH, OUT, PORT, ROOT } from './setup.mjs'
const server = await createServer({
  root: ROOT,
  configFile: ROOT + '/vite.config.ts',
  cacheDir: CACHE_DIR,
  server: { port: PORT, strictPort: true },
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
await page.setViewport({ width: 1600, height: 1000 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const filtersOff = () =>
  page.$$eval('.menu-items button', buttons => buttons.find(b => b.textContent === 'Levels').disabled)
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
const click = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).click(), text)
const press = async key => {
  await page.keyboard.press(key)
  await sleep(100)
}
const snapshot = () => page.evaluate(() => window.lydia.engine.getSnapshot())
const waitIdle = async () => {
  await sleep(100)
  await page.waitForFunction(
    () => {
      const snap = window.lydia.engine.getSnapshot()
      return !snap.task && !snap.isUpdating && !window.lydia.projection.isUpdating()
    },
    { timeout: 60000, polling: 20 },
  )
  await sleep(150)
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
const drag = async (from, to) => {
  const a = await pageOf(...from)
  const b = await pageOf(...to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 10 })
  await page.mouse.up()
  await sleep(100)
  await waitIdle()
}
const shownAt = (x, y) => page.evaluate((x, y) => window.lydia.projection.colorAt(x, y), x, y)
// Each pixel of the active layer, as [red, green, blue, alpha], in rows
const SIDE = 800
const pixelsOf = () =>
  page.evaluate(SIDE => {
    const { app, gpu, stack } = window.lydia
    const out = new Array(SIDE * SIDE * 4).fill(0)
    const count = Math.ceil(SIDE / 256)
    for (let row = 0; row < count; row++) {
      for (let column = 0; column < count; column++) {
        const texture = gpu.getTexture(stack.active, column, row, false)
        if (!texture) continue
        const { pixels } = app.renderer.extract.pixels(texture)
        for (let y = 0; y < 256; y++) {
          const py = row * 256 + y
          if (py >= SIDE) break
          for (let x = 0; x < 256; x++) {
            const px = column * 256 + x
            if (px >= SIDE) continue
            for (let c = 0; c < 4; c++) out[(py * SIDE + px) * 4 + c] = pixels[(y * 256 + x) * 4 + c]
          }
        }
      }
    }
    return out
  }, SIDE)
const alphaAt = (list, x, y) => list[(y * SIDE + x) * 4 + 3]
const alphaSum = list => {
  let sum = 0
  for (let i = 3; i < list.length; i += 4) sum += list[i]
  return sum
}
const near = (a, b, by = 2) => Math.abs(a - b) <= by
const toHex = text => parseInt(text.slice(1, 3), 16)

const open = async kind => {
  await page.evaluate(
    kind =>
      [...document.querySelectorAll('.menu-items button')]
        .find(b => b.textContent === { hue: 'Hue and saturation', levels: 'Levels', blur: 'Gaussian blur' }[kind])
        .click(),
    kind,
  )
  await page.waitForFunction(() => window.lydia.engine.getSnapshot().filter !== null, { timeout: 20000 })
  await sleep(100)
}
const set = async change => {
  await page.evaluate(change => window.lydia.engine.setFilter(change), change)
  await sleep(500)
}
const apply = async () => {
  await click('Apply')
  await waitIdle()
}
// A rectangle of one color on a new layer, as pixels
const rectangle = async (from, to, color) => {
  await click('New layer')
  await waitIdle()
  await press('p')
  await page.evaluate(
    color => window.lydia.engine.setShapeStyle({ kind: 'rectangle', fill: { isOn: true, color } }),
    color,
  )
  await sleep(100)
  await drag(from, to)
  await press('b')
  await click('Convert to pixels')
  await sleep(200)
  await waitIdle()
}

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('lydia')
  indexedDB.deleteDatabase('lydia-autosave')
})
await page.reload({ waitUntil: 'networkidle0' })
await click('New project…')
await page.waitForSelector('dialog.new-project[open]')
const inputs = await page.$$('dialog input[type=number]')
for (const i of [0, 1]) {
  await inputs[i].click({ clickCount: 3 })
  await inputs[i].type(String(SIDE))
}
await page.click('button[type=submit]')
await page.waitForFunction(
  () => window.lydia?.engine && window.lydia.app.renderer && document.querySelectorAll('button.brush').length > 0,
  { timeout: 90000 },
)
await sleep(800)

// ----- Hue and saturation -----
await rectangle([100, 100], [500, 500], '#ff0000')
check('red to start with', (await shownAt(300, 300)) === '#ff0000', await shownAt(300, 300))
const ramBefore = await page.evaluate(() => [...window.lydia.stack.active.tiles.values()].length)
await open('hue')
check('the bar shows its controls', await filtersOff())
await set({ hue: 120 })
check('the hue turns, as a preview', (await shownAt(300, 300)) === '#00ff00', await shownAt(300, 300))
const whileOpen = await page.evaluate(() => {
  const { engine, gpu, stack } = window.lydia
  return {
    unsaved: gpu.hasUnsaved(),
    modifiedTiles: stack.active.tiles.size,
    canUndo: engine.getSnapshot().canUndo,
  }
})
check(
  'the layer in RAM is left alone',
  !whileOpen.unsaved && whileOpen.modifiedTiles === ramBefore,
  JSON.stringify(whileOpen),
)
const a = await pageOf(120, 120)
await page.mouse.move(a.x, a.y)
await page.mouse.down()
await page.mouse.move(a.x + 40, a.y, { steps: 3 })
await page.mouse.up()
await sleep(150)
check(
  'nothing can be painted meanwhile',
  (await shownAt(130, 90)) === '#ffffff' && (await shownAt(300, 300)) === '#00ff00',
)
await press('Escape')
await waitIdle()
check('Esc leaves the layer as it was', (await shownAt(300, 300)) === '#ff0000', await shownAt(300, 300))
check('with the bar back', (await snapshot()).filter === null)

await open('hue')
await set({ hue: 240 })
await apply()
check('Apply keeps it', (await shownAt(300, 300)) === '#0000ff', await shownAt(300, 300))
await click('Undo')
await waitIdle()
check('one step of undo', (await shownAt(300, 300)) === '#ff0000', await shownAt(300, 300))
await click('Redo')
await waitIdle()
check('and redo', (await shownAt(300, 300)) === '#0000ff')
await click('Undo')
await waitIdle()

await open('hue')
await page.evaluate(() => {
  const label = [...document.querySelectorAll('.toolbar label')].find(l => l.textContent.startsWith('Saturation'))
  const input = label.querySelector('input[type=range]')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '-100')
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(500)
check('no saturation is gray, from its slider', near(toHex(await shownAt(300, 300)), 128, 1), await shownAt(300, 300))
await set({ saturation: 0, lightness: 100 })
check('full lightness is white', (await shownAt(300, 300)) === '#ffffff', await shownAt(300, 300))
await set({ lightness: -100 })
check('none is black', (await shownAt(300, 300)) === '#000000', await shownAt(300, 300))
await press('Escape')
await waitIdle()

// ----- Levels -----
await rectangle([100, 100], [500, 500], '#808080')
await open('levels')
await set({ white: 128 })
check('the white point up to the gray makes it white', (await shownAt(300, 300)) === '#ffffff', await shownAt(300, 300))
await set({ white: 255, black: 128 })
check('the black point up to it makes it black', (await shownAt(300, 300)) === '#000000', await shownAt(300, 300))
await set({ black: 0, middle: 2 })
const lighter = toHex(await shownAt(300, 300))
check('the middle at 2 lightens it', near(lighter, Math.round(255 * Math.sqrt(128 / 255))), `${lighter}`)
await set({ middle: 1, outputBlack: 100, outputWhite: 200 })
check('the output keeps it between them', near(toHex(await shownAt(300, 300)), 150), await shownAt(300, 300))
await press('Escape')
await waitIdle()

// ----- The alpha stays as it was -----
await click('New layer')
await waitIdle()
await page.evaluate(() => {
  const { engine, brush } = window.lydia
  engine.setBrush({ color: '#ff0000', opacity: 0.5, size: 100, tool: 'brush' })
  brush.startStroke(550, 650, 1)
  brush.continueStroke([{ x: 700, y: 650, pressure: 1 }])
  brush.endStroke()
})
await waitIdle()
const halfBefore = await pixelsOf()
await open('hue')
await set({ hue: 120 })
await apply()
const halfAfter = await pixelsOf()
let alphaChanged = 0
for (let i = 3; i < halfAfter.length; i += 4) if (Math.abs(halfAfter[i] - halfBefore[i]) > 0) alphaChanged++
check('a color filter keeps the alpha to the pixel', alphaChanged === 0, `${alphaChanged} changed`)
const color = (650 * SIDE + 620) * 4
check(
  'and colors half covered pixels as they are, not darker',
  halfAfter[color] <= 1 && near(halfAfter[color + 1], halfAfter[color + 3]) && halfAfter[color + 3] > 100,
  halfAfter.slice(color, color + 4).join(),
)
await click('Delete layer')
await waitIdle()

// ----- A blur -----
// How much of a Gaussian falls below this many radii
const below = x => {
  let sum = 0
  for (let t = -6; t < x; t += 0.001) sum += Math.exp((-t * t) / 2) * 0.001
  return sum / Math.sqrt(2 * Math.PI)
}
const covered = (x, y, radius) =>
  255 *
  (below((600 - x) / radius) - below((200 - x) / radius)) *
  (below((600 - y) / radius) - below((200 - y) / radius))
await rectangle([200, 200], [600, 600], '#000000')
const hardEdges = await pixelsOf()
check('hard edges to start with', alphaAt(hardEdges, 195, 400) === 0 && alphaAt(hardEdges, 205, 400) === 255)
const edgeSum = alphaSum(hardEdges)
for (const radius of [1.5, 8, 20, 60, 120, 240]) {
  await open('blur')
  await set({ radius })
  await apply()
  const list = await pixelsOf()
  const middleOfEdge = alphaAt(list, 200, 400)
  const expected = covered(200.5, 400.5, radius)
  // Going across the seams between tiles (x = 256, 512; y = 256, 512), the steps must be no bigger than those around
  let worstSeam = 0
  let worstAround = 0
  for (const seam of [256, 512]) {
    for (let along = 100; along < 700; along += 7) {
      worstSeam = Math.max(worstSeam, Math.abs(alphaAt(list, seam, along) - alphaAt(list, seam - 1, along)))
      worstSeam = Math.max(worstSeam, Math.abs(alphaAt(list, along, seam) - alphaAt(list, along, seam - 1)))
      for (const off of [5, 6]) {
        worstAround = Math.max(
          worstAround,
          Math.abs(alphaAt(list, seam + off, along) - alphaAt(list, seam + off - 1, along)),
        )
        worstAround = Math.max(
          worstAround,
          Math.abs(alphaAt(list, along, seam + off) - alphaAt(list, along, seam + off - 1)),
        )
      }
    }
  }
  check(
    `a blur of ${radius} is a Gaussian`,
    radius > 60 || near(middleOfEdge, expected, 3),
    `${middleOfEdge} and ${expected.toFixed(1)}`,
  )
  check(`with no seams between the tiles`, worstSeam <= worstAround + 2, `${worstSeam} and ${worstAround}`)
  check(
    `and as much paint as before`,
    radius > 100 || near(alphaSum(list) / edgeSum, 1, 0.02),
    `${(alphaSum(list) / edgeSum).toFixed(3)}`,
  )
  if (radius === 60) await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/filters-blur.png' })
  await click('Undo')
  await waitIdle()
}
check('undo gives the hard edges back', alphaAt(await pixelsOf(), 195, 400) === 0)

// A layer that covers the paper doesn't fade at its edge
await click('New layer')
await waitIdle()
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#000000', opacity: 1 }))
await press('f')
const outside = await pageOf(50, 50)
await page.mouse.click(outside.x, outside.y)
await waitIdle()
await press('b')
for (const radius of [20, 60]) {
  await open('blur')
  await set({ radius })
  await apply()
  const list = await pixelsOf()
  // Far from where the layers under it stopped the fill
  const edges = [alphaAt(list, 799, 400), alphaAt(list, 400, 799), alphaAt(list, 0, 799), alphaAt(list, 799, 0)]
  check(
    `a blur of ${radius} leaves the edge of the paper as it was`,
    edges.every(alpha => alpha >= 250),
    edges.join(),
  )
  await click('Undo')
  await waitIdle()
}
await click('Delete layer')
await waitIdle()

// ----- A selection, and a locked transparency -----
await press('s')
await drag([250, 250], [400, 400])
await press('b')
await open('levels')
await set({ outputBlack: 200 })
await apply()
check(
  'a filter changes only what is selected',
  (await shownAt(300, 300)) === '#c8c8c8' && (await shownAt(500, 500)) === '#000000',
  `${await shownAt(300, 300)} and ${await shownAt(500, 500)}`,
)
await click('Undo')
await waitIdle()
await page.evaluate(() => window.lydia.engine.deselect())
await sleep(100)
await page.evaluate(() => {
  const { engine, stack } = window.lydia
  engine.setLayerAlphaLock(stack.active.id, true)
})
await open('blur')
await set({ radius: 30 })
await apply()
const locked = await pixelsOf()
check(
  'a blur leaves a locked transparency as it was',
  alphaAt(locked, 190, 400) === 0 && alphaAt(locked, 205, 400) === 255,
)
await click('Undo')
await waitIdle()
await page.evaluate(() => window.lydia.engine.setLayerAlphaLock(window.lydia.stack.active.id, false))

// ----- What it can't be used on -----
await press('p')
await drag([50, 50], [90, 90])
check('not on a shape', await filtersOff())
await click('Undo')
await waitIdle()
await press('b')

// ----- Off the screen -----
await open('hue')
await set({ hue: 120 })
await page.evaluate(() => {
  const { world } = window.lydia
  world.scale.set(world.scale.x * 8, world.scale.y * 8)
  world.position.set(world.position.x - 300 * world.scale.x, world.position.y - 300 * world.scale.y)
})
await sleep(600)
await page.keyboard.press('Enter')
await waitIdle()
await page.evaluate(() => window.lydia.engine.fitToScreen?.())
await waitIdle()
const everywhere = await pixelsOf()
let unchanged = 0
for (let y = 200; y < 600; y += 13) {
  for (let x = 200; x < 600; x += 13) if (everywhere[(y * SIDE + x) * 4 + 3] !== 255) unchanged++
}
check('Apply reaches the whole layer, not only what shows', unchanged === 0, `${unchanged}`)

// ----- Saving during the preview -----
await click('Undo')
await waitIdle()
await open('hue')
await set({ hue: 120, lightness: 50 })
const savedTiles = await page.evaluate(async () => {
  const { parseProject } = await import('/src/engine/projectFile.ts')
  const file = await window.lydia.engine.saveProject()
  const project = parseProject(await file.arrayBuffer())
  return project.layers.at(-1).tiles.size
})
check('a drawing saved meanwhile is as it was', savedTiles > 0, `${savedTiles}`)
await press('Escape')
await waitIdle()

// ----- The preview shows all at once -----
// With many tiles on the screen, and a slider moving fast, no frame may show some with the old value and some with the new
page.on('dialog', d => d.accept())
await click('Back')
await sleep(400)
await click('New project…')
await page.waitForSelector('dialog.new-project[open]')
const bigInputs = await page.$$('dialog input[type=number]')
for (const i of [0, 1]) {
  await bigInputs[i].click({ clickCount: 3 })
  await bigInputs[i].type('6000')
}
await page.click('button[type=submit]')
await page.waitForFunction(
  () => window.lydia?.engine && window.lydia.app.renderer && document.querySelectorAll('button.brush').length > 0,
  { timeout: 90000 },
)
await sleep(800)
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#ff0000', opacity: 1 }))
await press('f')
const paperMiddle = await pageOf(3000, 3000)
await page.mouse.click(paperMiddle.x, paperMiddle.y)
await waitIdle()
await press('b')
await page.waitForFunction(() => !window.lydia.gpu.hasUnsaved(), { timeout: 60000 })
await open('hue')
const frames = await page.evaluate(async () => {
  const { engine, projection } = window.lydia
  const places = [
    [100, 100],
    [5900, 100],
    [100, 5900],
    [5900, 5900],
    [3000, 3000],
  ]
  let mixed = 0
  let count = 0
  const seen = new Set()
  const started = performance.now()
  let hue = 0
  let lastChange = 0
  await new Promise(resolve => {
    function tick(now) {
      if (now - lastChange > 30) {
        hue = (hue + 37) % 180
        engine.setFilter({ hue })
        lastChange = now
      }
      const colors = new Set(places.map(([x, y]) => projection.colorAt(x, y)))
      count++
      if (colors.size > 1) mixed++
      for (const color of colors) seen.add(color)
      if (now - started < 3000) requestAnimationFrame(tick)
      else resolve()
    }
    requestAnimationFrame(tick)
  })
  return { mixed, count, colors: seen.size }
})
check('a slider moving fast never shows old and new tiles together', frames.mixed === 0, JSON.stringify(frames))
check('and the picture keeps up with it', frames.colors >= 20, JSON.stringify(frames))
await press('Escape')
await waitIdle()

// The preview of a blur is worked out faster, on the whole screen at once: it shows what Apply makes of it
await page.evaluate(() => {
  const { engine, brush } = window.lydia
  engine.setBrush({ color: '#000000', size: 600, opacity: 1, tool: 'brush' })
  brush.startStroke(1000, 3000, 1)
  brush.continueStroke([{ x: 5000, y: 3000, pressure: 1 }])
  brush.endStroke()
})
await page.waitForFunction(() => !window.lydia.gpu.hasUnsaved(), { timeout: 60000 })
await waitIdle()
await open('blur')
await set({ radius: 120 })
const places = [
  [3000, 2700],
  [3000, 2600],
  [3000, 3300],
  [200, 3000],
  [3000, 3000],
]
const channel = async ([x, y]) => parseInt((await shownAt(x, y)).slice(1, 3), 16)
const inPreview = []
for (const place of places) inPreview.push(await channel(place))
await apply()
const applied = []
for (const place of places) applied.push(await channel(place))
check(
  'the preview of a blur shows what Apply makes of it',
  inPreview.every((value, i) => near(value, applied[i], 6)) && Math.max(...applied) - Math.min(...applied) > 100,
  `${inPreview.join()} and ${applied.join()}`,
)

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
