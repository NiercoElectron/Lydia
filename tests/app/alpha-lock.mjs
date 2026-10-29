// Locking a layer's transparency: the lock in the row, the brush and the fill bucket coloring only the paint there
// (live too), the eraser blocked with a notice, saved, copied, unlocked
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
    const active = s.layers.find(l => l.id === s.activeLayerId)
    return { locked: active.alphaLocked, all: s.layers.map(l => l.alphaLocked) }
  })
const waitIdle = () =>
  page.waitForFunction(
    () => {
      const s = window.lydia.engine.getSnapshot()
      return !s.task && !s.isUpdating
    },
    { timeout: 30000 },
  )
const setColor = color =>
  page.evaluate(color => {
    const input = document.querySelector('input[type=color]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, color)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, color)
const drag = async (x0, y0, x1, y1, during) => {
  const a = await pageOf(x0, y0),
    b = await pageOf(x1, y1)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 })
  await page.mouse.move(b.x, b.y, { steps: 4 })
  await frames()
  if (during) await during()
  await page.mouse.up()
  await sleep(150)
}
const clickAt = async (x, y) => {
  const p = await pageOf(x, y)
  await page.mouse.click(p.x, p.y)
  await sleep(150)
}
const lockButton = () => page.$('.layers-list button[title*="transparency"]')

await newDrawing(300, 200)
await page.evaluate(() =>
  [...document.querySelectorAll('button.brush')].find(b => b.textContent.trim().startsWith('Hard round')).click(),
)
await sleep(300)
await setSize(20)
await setColor('#ff0000')
await sleep(100)
await drag(20, 30, 120, 30)
check(
  'unlocked at first, with the open lock',
  !(await snap()).locked &&
    (await page.$eval('.layers-list button[title*="transparency"]', b => b.getAttribute('aria-pressed'))) === 'false',
)
await (await lockButton()).click()
await sleep(100)
check('the lock locks it', (await snap()).locked)

// The brush colors only the paint there, also while painting
await setColor('#0000ff')
await sleep(100)
const live = {}
await drag(60, 5, 60, 100, async () => {
  live.on = await colorAt(60, 30)
  live.off = await colorAt(60, 80)
})
check(
  'while painting: blue on the red, nothing beside it',
  live.on === '#0000ff' && live.off === '#ffffff',
  `${live.on} ${live.off}`,
)
check(
  'after: the same',
  (await colorAt(60, 30)) === '#0000ff' &&
    (await colorAt(60, 80)) === '#ffffff' &&
    (await colorAt(30, 30)) === '#ff0000',
)
const tilesAfter = await page.evaluate(() => window.lydia.stack.active.tiles.size)
check('no empty tiles made where there was no paint', tilesAfter === 1, String(tilesAfter))

// The eraser can't be used, and says why
await page.keyboard.press('e')
await sleep(150)
const notice = await page.evaluate(() => [...document.querySelectorAll('.notice')].map(n => n.textContent).join())
check('the eraser says the transparency is locked', notice.includes('transparency is locked'), notice)
await drag(20, 30, 50, 30)
check('…and takes nothing away', (await colorAt(30, 30)) === '#ff0000')
await page.keyboard.press('b')
await sleep(100)

// The fill bucket colors only the paint
await page.keyboard.press('f')
await sleep(100)
await setColor('#00ff00')
await sleep(100)
await clickAt(200, 150)
await waitIdle()
check(
  'a fill where there is no paint does nothing',
  (await colorAt(200, 150)) === '#ffffff' && (await page.evaluate(() => window.lydia.stack.active.tiles.size)) === 1,
)
await clickAt(30, 30)
await waitIdle()
check(
  'a fill on the paint colors it green, and nothing beside it',
  (await colorAt(30, 30)) === '#00ff00' && (await colorAt(30, 60)) === '#ffffff',
  `${await colorAt(30, 30)} ${await colorAt(30, 60)}`,
)
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await waitIdle()
check('undo brings the red back, still locked', (await colorAt(30, 30)) === '#ff0000' && (await snap()).locked)

// Kept with the drawing, and by a copy
const saved = await page.evaluate(async () => {
  const { parseProject } = await import('/src/engine/projectFile.ts')
  return parseProject(await (await window.lydia.engine.saveProject()).arrayBuffer()).layers.map(
    l => l.alphaLocked === true,
  )
})
check('saved with the drawing', saved.join() === 'true', saved.join())
await page.evaluate(() => window.lydia.engine.duplicateLayer())
await waitIdle()
check('a copy is locked too', (await snap()).all.join() === 'true,true')
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await waitIdle()

// Unlocked, the brush paints anywhere again
await (await lockButton()).click()
await sleep(100)
await page.keyboard.press('b')
await sleep(100)
await setColor('#0000ff')
await sleep(100)
await drag(150, 80, 150, 120)
check('unlocked: paints anywhere again', !(await snap()).locked && (await colorAt(150, 100)) === '#0000ff')

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
