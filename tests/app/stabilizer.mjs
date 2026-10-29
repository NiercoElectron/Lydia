// The stabilizer: shown with the brush and the eraser only; Smooth taking the wobble out and ending where the pen came
// up, lagging and catching up with the pen held still; String keeping the brush still within the string and pulling
// it behind further; 0 for off; remembered
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { CACHE_DIR, LAUNCH, OUT, ROOT } from './setup.mjs'
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

// Is the paper painted at this point (darker than light gray)?
const painted = (x, y) =>
  page.evaluate(
    (x, y) => {
      const c = window.lydia.projection.colorAt(x, y)
      return c !== null && parseInt(c.slice(1, 3), 16) < 128
    },
    x,
    y,
  )
// The highest and lowest painted rows between columns x0 and x1 (every 4th column), from y0 to y1
const spread = (x0, x1, y0, y1) =>
  page.evaluate(
    (x0, x1, y0, y1) => {
      let top = Infinity,
        bottom = -Infinity
      for (let x = x0; x <= x1; x += 4)
        for (let y = y0; y <= y1; y++) {
          const c = window.lydia.projection.colorAt(x, y)
          if (c && parseInt(c.slice(1, 3), 16) < 128) {
            top = Math.min(top, y)
            bottom = Math.max(bottom, y)
          }
        }
      return bottom - top
    },
    x0,
    x1,
    y0,
    y1,
  )
// The stabilizer is in the Advanced panel: opened to change it, and closed again with Esc
const openAdvanced = () =>
  page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Advanced ▾')?.click())
const setStabilizer = async (strength, mode) => {
  await openAdvanced()
  await page.evaluate(
    (strength, mode) => {
      const input = [...document.querySelectorAll('label')]
        .find(l => l.textContent.startsWith('Stabilizer'))
        .querySelector('input[type=range]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(strength))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      if (mode) [...document.querySelectorAll('button')].find(b => b.textContent === mode).click()
    },
    strength,
    mode,
  )
  await page.keyboard.press('Escape')
  await sleep(50)
}
const hasStabilizer = async () => {
  await openAdvanced()
  const has = await page.evaluate(() =>
    [...document.querySelectorAll('label')].some(l => l.textContent.startsWith('Stabilizer')),
  )
  await page.keyboard.press('Escape')
  await sleep(50)
  return has
}
// A shaky horizontal line: up and down by "wobble" every 6 pixels, at y, from x0 to x1
async function shaky(x0, x1, y, wobble) {
  await moveTo(x0, y)
  await page.mouse.down()
  for (let x = x0, i = 0; x <= x1; x += 6, i++) await moveTo(x, y + (i % 2 ? wobble : -wobble))
  await moveTo(x1, y)
  await page.mouse.up()
  await sleep(100)
}

await newDrawing(1000, 800)
await keys('b')
await chooseBrush('Hard round')
await setSize(6)
check('the Stabilizer shows with the brush', await hasStabilizer())
await keys('s')
check('…not with the selection', !(await hasStabilizer()))
await keys('e')
check('…and with the eraser', await hasStabilizer())
await keys('b')

await shaky(100, 400, 150, 10)
const raw = await spread(160, 340, 120, 180)
await setStabilizer(60, 'Smooth')
await shaky(100, 400, 300, 10)
const smooth = await spread(160, 340, 270, 330)
check('Smooth takes the wobble out', raw >= 20 && smooth <= raw / 2, `wobble ${raw} px without, ${smooth} px with`)
check('…and the line still ends where the pen came up', await painted(400, 300))

// Holding still, the brush keeps going toward the pen
await moveTo(100, 450)
await page.mouse.down()
await moveTo(400, 450)
const early = await painted(395, 450)
await sleep(1500)
const late = await painted(395, 450)
const o = await page.evaluate(() => {
  const g = window.lydia.app.stage.children.at(-1)
  return { visible: g.visible, width: g.getLocalBounds().width }
})
await page.mouse.up()
check('with the pen held still, the brush lags, then reaches it', !early && late, `${early} then ${late}`)

await moveTo(100, 520)
await page.mouse.down()
await moveTo(400, 520)
await frames()
const lagLine = await page.evaluate(() => {
  const g = window.lydia.app.stage.children.at(-1)
  return { visible: g.visible, width: g.getLocalBounds().width }
})
await page.mouse.up()
check(
  'while it lags, a line joins the brush to the pen',
  lagLine.visible && lagLine.width > 100,
  `${lagLine.width.toFixed(0)} px across`,
)

// String: within the string's length nothing moves; further, the brush is pulled, and catches up at the end
await setStabilizer(50, 'String')
const zoom = await page.evaluate(() => window.lydia.world.scale.y)
const length = 40 / zoom // half of 80 pixels of the screen, in pixels of the paper
await moveTo(100, 620)
await page.mouse.down()
await moveTo(100 + length * 0.7, 620)
await sleep(300)
const within = await painted(100 + length * 0.5, 620)
await moveTo(400, 620)
await sleep(300)
const pulled = await painted(400 - length - 10, 620)
const notYet = await painted(400 - length + 10, 620)
await page.mouse.up()
await sleep(100)
const caught = await painted(398, 620)
check('String: within the string, the brush stays', !within)
check('…further, it is pulled behind the pen by the string', pulled && !notYet)
check('…and catches up when the pen comes up', caught)

// Off: painted right under the pen
await setStabilizer(0)
await moveTo(100, 700)
await page.mouse.down()
await moveTo(400, 700)
const direct = await painted(398, 700)
await page.mouse.up()
check('at 0 it is off: the paint is right under the pen', direct)

const saved = await page.evaluate(() => localStorage.getItem('lydia.stabilizer'))
check('remembered', saved === '{"mode":"string","strength":0}', saved)
await page.screenshot({ path: OUT + '/stabilizer.png' })

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
