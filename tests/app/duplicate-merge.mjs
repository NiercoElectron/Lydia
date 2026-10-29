// Layers: duplicate (Ctrl+J, shares tiles, smart objects too) and merge down (Ctrl+E, the picture unchanged, one step
// of undo, not onto a hidden layer, the bottom one or a smart object)
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
const snap = () =>
  page.evaluate(() => {
    const s = window.lydia.engine.getSnapshot()
    return {
      names: s.layers.map(l => l.name),
      active: s.layers.find(l => l.id === s.activeLayerId)?.name,
      canMergeDown: s.canMergeDown,
      smart: s.layers.map(l => l.isSmart),
    }
  })
const colors = points => Promise.all(points.map(([x, y]) => colorAt(x, y)))
const keys = async (...combo) => {
  for (const k of combo.slice(0, -1)) await page.keyboard.down(k)
  await page.keyboard.press(combo.at(-1))
  for (const k of combo.slice(0, -1).reverse()) await page.keyboard.up(k)
  await sleep(80)
}
const waitIdle = () =>
  page.waitForFunction(
    () => {
      const s = window.lydia.engine.getSnapshot()
      return !s.task && !s.isUpdating
    },
    { timeout: 30000 },
  )
const stroke = (x0, y0, x1, y1) =>
  page.evaluate(
    (x0, y0, x1, y1) => {
      const { brush } = window.lydia
      brush.startStroke(x0, y0, 1)
      brush.continueStroke([{ x: x1, y: y1, pressure: 1 }])
      brush.endStroke()
    },
    x0,
    y0,
    x1,
    y1,
  )
const setColor = color =>
  page.evaluate(color => {
    const input = document.querySelector('input[type=color]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, color)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, color)
const button = text =>
  page.evaluate(text => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent === text)
    return b ? { disabled: b.disabled } : null
  }, text)

await newDrawing(300, 200)
await setSize(20)
await setColor('#ff0000')
await sleep(100)
await stroke(20, 30, 120, 30)
check("the bottom layer can't be merged down", !(await snap()).canMergeDown && (await button('Merge down')).disabled)

// ----- Duplicate -----
await keys('Control', 'j')
await waitIdle()
let s = await snap()
check(
  'Ctrl+J: a copy above, active',
  s.names.join() === 'Layer 1,Layer 1 copy' && s.active === 'Layer 1 copy',
  s.names.join(),
)
check('the copy has the paint (the same red on the screen)', (await colorAt(60, 30)) === '#ff0000')
await setColor('#0000ff')
await sleep(100)
await stroke(20, 80, 120, 80)
// The original doesn't get the copy's paint: hide the copy
const copyId = await page.evaluate(() => window.lydia.engine.getSnapshot().activeLayerId)
await page.evaluate(id => window.lydia.engine.setLayerVisible(id, false), copyId)
await waitIdle()
check(
  'painting the copy leaves the original alone',
  (await colorAt(60, 80)) === '#ffffff' && (await colorAt(60, 30)) === '#ff0000',
)
check("a hidden layer can't be merged down", !(await snap()).canMergeDown && (await button('Merge down')).disabled)
await keys('Control', 'z') // shows the copy again
await keys('Control', 'z') // takes the blue stroke away
await keys('Control', 'z') // takes the copy away
await waitIdle()
s = await snap()
check('undo takes the copy away', s.names.join() === 'Layer 1', s.names.join())
await keys('Control', 'Shift', 'z')
await waitIdle()
check('redo brings it back', (await snap()).names.join() === 'Layer 1,Layer 1 copy')
await keys('Control', 'z')
await waitIdle()

// ----- Merge down -----
// A layer at 50% over the red one, painting black across the red stroke and beside it
await page.evaluate(() => window.lydia.engine.addLayer())
await setColor('#000000')
await sleep(100)
await stroke(60, 10, 60, 150)
const top = await page.evaluate(() => window.lydia.engine.getSnapshot().activeLayerId)
await page.evaluate(id => {
  window.lydia.engine.setLayerOpacity(id, 0.5)
  window.lydia.engine.finishLayerOpacity()
}, top)
await waitIdle()
const points = [
  [60, 30],
  [60, 100],
  [30, 30],
  [200, 100],
  [55, 30],
  [65, 100],
]
const before = await colors(points)
check('Merge down enabled over a shown layer', (await snap()).canMergeDown && !(await button('Merge down')).disabled)
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Merge down').click())
await waitIdle()
s = await snap()
const after = await colors(points)
check(
  'merged: one layer left, the lower one active',
  s.names.join() === 'Layer 1' && s.active === 'Layer 1',
  s.names.join(),
)
check('the picture looks the same', after.join() === before.join(), `${before.join()} → ${after.join()}`)
check(
  'at 50%: red under half black, gray beside it',
  before[0] !== '#ff0000' && before[0] !== '#000000' && before[1] !== '#ffffff',
  before.join(),
)
await keys('Control', 'z')
await waitIdle()
s = await snap()
check('one undo: both layers again, the top one active', s.names.length === 2 && s.active !== 'Layer 1', s.names.join())
check('…the same picture', (await colors(points)).join() === before.join())
await keys('Control', 'Shift', 'z')
await waitIdle()
check(
  'redo merges again',
  (await snap()).names.join() === 'Layer 1' && (await colors(points)).join() === before.join(),
  (await snap()).names.join(),
)
// Undone once more, hiding the top layer shows the lower one without the black (hiding is a step of its own, after
// which the merge can't be redone, as with any new change)
await keys('Control', 'z')
await waitIdle()
await page.evaluate(id => window.lydia.engine.setLayerVisible(id, false), top)
await waitIdle()
check(
  '…and undone, the lower layer without the black',
  (await colorAt(60, 100)) === '#ffffff' && (await colorAt(60, 30)) === '#ff0000',
)
await page.evaluate(id => window.lydia.engine.setLayerVisible(id, true), top)
await page.evaluate(() => window.lydia.engine.mergeDown())
await waitIdle()

// ----- A smart object's copy -----
await page.evaluate(() => {
  window.lydia.engine.startTransform()
})
await sleep(200)
await page.evaluate(() => {
  window.lydia.engine.applyTransform()
})
await waitIdle()
const madeSmart = (await snap()).smart.join()
await keys('Control', 'j')
await waitIdle()
s = await snap()
check(
  "a smart object's copy is a smart object too",
  madeSmart === 'true' && s.smart.join() === 'true,true',
  `${madeSmart} → ${s.smart.join()}`,
)
check("…and merging onto a smart object isn't offered", !s.canMergeDown)
const sources = await page.evaluate(() => {
  const [a, b] = window.lydia.stack.layers.slice(-2)
  return a.smart.source !== b.smart.source && a.smart.source.tiles.size === b.smart.source.tiles.size
})
check('…with a source of its own, sharing the same tiles', sources)

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
