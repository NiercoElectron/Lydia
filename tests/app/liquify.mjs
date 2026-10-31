// Liquify (decision 73): its button, key, modes and own settings; push moves the picture along the stroke, across the
// tiles' edges, with no seam; bloat and pucker change the size of what is under the brush, and go on while the pen holds
// still; twirl turns it; reconstruct gets back to the very pixels; many strokes don't soften the picture; undo and redo
// take the map along; only the active layer, only inside the selection, keeping a locked transparency; another change
// starts again from the layer as it is; a smart object isn't changed; the pen's pressure changes the strength
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
await page.setViewport({ width: 1500, height: 1000 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
const click = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).click(), text)
const press = async key => {
  await page.keyboard.press(key)
  await sleep(80)
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
const drag = async (from, to, steps = 30) => {
  const a = await pageOf(...from)
  const b = await pageOf(...to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps })
  await page.mouse.up()
  await sleep(150)
}
// The pointer goes down at this point, holds still for a while, and comes up
const hold = async (at, ms) => {
  const a = await pageOf(...at)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await sleep(ms)
  await page.mouse.up()
  await sleep(150)
}
const barSlider = (label, value) =>
  page.evaluate(
    (label, value) => {
      const row = [...document.querySelectorAll('.toolbar label')].find(l => l.textContent.startsWith(label))
      const input = row.querySelector('input[type=range]')
      if (value !== undefined) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value))
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      return Number(input.value)
    },
    label,
    value,
  )
const hasBarSlider = label =>
  page.evaluate(
    label => [...document.querySelectorAll('.toolbar label')].some(l => l.textContent.startsWith(label)),
    label,
  )
const settings = async (size, strength) => {
  await barSlider('Size', size)
  await barSlider('Strength', strength)
  await sleep(100)
}
// Lines across the layer, a grid to see every movement by. Painted with the brush, in a block of the paper
const gridOfLines = (left, top, right, bottom) =>
  page.evaluate(
    (left, top, right, bottom) => {
      const { brush, engine } = window.lydia
      engine.setBrush({ size: 6, color: '#ff0000', tool: 'brush', opacity: 1 })
      const line = (x0, y0, x1, y1) => {
        brush.startStroke(x0, y0, 1)
        brush.continueStroke([{ x: x1, y: y1, pressure: 1 }])
        brush.endStroke()
      }
      for (let y = top; y <= bottom; y += 40) line(left, y, right, y)
      for (let x = left; x <= right; x += 40) line(x, top, x, bottom)
    },
    left,
    top,
    right,
    bottom,
  )
// The active layer's pixels, red, green, blue and alpha, in a box of the paper
const pixels = (x, y, width, height) =>
  page.evaluate(
    (x, y, width, height) => {
      const { app, gpu, stack } = window.lydia
      const cache = new Map()
      const out = []
      for (let py = y; py < y + height; py++) {
        for (let px = x; px < x + width; px++) {
          const column = Math.floor(px / 256)
          const row = Math.floor(py / 256)
          const key = column + ',' + row
          if (!cache.has(key)) {
            const texture = gpu.getTexture(stack.active, column, row, false)
            cache.set(key, texture ? app.renderer.extract.pixels(texture).pixels : null)
          }
          const tile = cache.get(key)
          const at = ((py % 256) * 256 + (px % 256)) * 4
          out.push(tile ? [...tile.slice(at, at + 4)] : [0, 0, 0, 0])
        }
      }
      return out
    },
    x,
    y,
    width,
    height,
  )
const alphas = async (x, y, width, height) => (await pixels(x, y, width, height)).map(p => p[3])
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const differing = (a, b) => a.filter((p, i) => JSON.stringify(p) !== JSON.stringify(b[i])).length
// The most any channel differs by, between two pictures
const worstDifference = (a, b) => Math.max(...a.flatMap((p, i) => p.map((value, k) => Math.abs(value - b[i][k]))))
// How many pixels are partly painted: the softer a picture, the more
const softPixels = list => list.filter(p => p[3] > 0 && p[3] < 255).length
const mode = async name => {
  await click(name)
  await sleep(100)
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
  [0, 800],
  [1, 800],
]) {
  await inputs[i].click({ clickCount: 3 })
  await inputs[i].type(String(value))
}
await page.click('button[type=submit]')
await page.waitForFunction(
  () => window.lydia?.engine && window.lydia.app.renderer && document.querySelectorAll('button.brush').length > 0,
  { timeout: 90000 },
)
await sleep(800)
await page.evaluate(() =>
  [...document.querySelectorAll('button.brush')]
    .find(b => b.querySelector('.brush-name').textContent === 'Hard round')
    .click(),
)
await sleep(300)

// ----- The button, key, modes and settings -----
const tools = await page.$$eval('.tool-column button', buttons => buttons.map(b => b.ariaLabel))
check('Liquify comes after Blur', tools.slice(3, 5).join() === 'Blur,Liquify', tools.join())
await press('q')
check('Q chooses Liquify', await page.$eval('.tool-column button[aria-label=Liquify]', b => b.ariaPressed === 'true'))
check('it has Strength, not Opacity', (await hasBarSlider('Strength')) && !(await hasBarSlider('Opacity')))
const modes = await page.$$eval('.toolbar .button-group button', buttons => buttons.map(b => b.textContent))
check(
  'the five modes are in the bar',
  ['Push', 'Bloat', 'Pucker', 'Twirl', 'Reconstruct'].every(name => modes.includes(name)),
  modes.join(),
)
await barSlider('Size', 150)
await sleep(100)
await press('b')
check('the brush keeps its size', (await barSlider('Size')) === 20)
await press('q')
check('Liquify kept its own', (await barSlider('Size')) === 150)

// ----- Push -----
await gridOfLines(120, 120, 680, 680)
await sleep(300)
await page.evaluate(() => window.lydia.engine.setTool('liquify'))
await settings(160, 100)
const original = await pixels(100, 100, 600, 600)
const away = await pixels(620, 620, 60, 60)
// Across the tiles' edges at 256 and 512 pixels
await drag([200, 256], [320, 256])
const pushed = await pixels(100, 100, 600, 600)
check('push moves the picture', differing(pushed, original) > 1000, `${differing(pushed, original)} pixels changed`)
check('and nothing away from the stroke', same(await pixels(620, 620, 60, 60), away))
const column = (await alphas(296, 200, 1, 112)).filter(a => a > 128).length
check('the line pushed goes along with the pen', column > 8, `${column} painted`)
// A vertical line crossing a tile's edge, bent there: its neighbors across the edge must meet
const atEdge = await pixels(240, 255, 120, 2)
const seam = worstDifference(atEdge.slice(0, 120), atEdge.slice(120))
check('no seam at the edge between two tiles', seam < 80, `at most ${seam} of 255 between the rows`)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/liquify-push.png' })

// ----- Undo and redo take the map along -----
await click('Undo')
await sleep(300)
check('undo puts every pixel back', same(await pixels(100, 100, 600, 600), original))
await click('Redo')
await sleep(300)
const redone = await pixels(100, 100, 600, 600)
check('redo puts the stroke back', same(redone, pushed), `${differing(redone, pushed)} pixels differ`)

// ----- Reconstruct: back to the very pixels -----
await mode('Reconstruct')
await settings(300, 100)
// Strokes until it is all back: one over nothing left to do changes nothing, so it isn't a step
const reconstruct = async (from, to) => {
  for (let count = 1; count <= 12; count++) {
    await drag(from, to, 12)
    if (same(await pixels(100, 100, 600, 600), original)) return count
  }
  return 12
}
const rebuildSteps = await reconstruct([180, 256], [340, 256])
const rebuilt = await pixels(100, 100, 600, 600)
check(
  'reconstruct gets back to the very pixels',
  same(rebuilt, original),
  `${differing(rebuilt, original)} pixels differ`,
)

// Undoing one stroke of Reconstruct brings the map back too
const steps = await page.evaluate(() => window.lydia.engine.getSnapshot().canUndo)
check('reconstruct can be undone', steps)
for (let i = 0; i < rebuildSteps; i++) {
  await click('Undo')
  await sleep(120)
}
await sleep(200)
check('undone, the push is back', same(await pixels(100, 100, 600, 600), pushed))
await drag([180, 256], [340, 256], 12)
check('and reconstruct still reaches it', differing(await pixels(100, 100, 600, 600), pushed) > 500)
await click('Undo')
await sleep(200)
await click('Undo')
await sleep(300)
check('all undone, the original', same(await pixels(100, 100, 600, 600), original))

// ----- Many strokes don't soften the picture -----
await mode('Push')
await settings(160, 60)
const softBefore = softPixels(original)
for (let i = 0; i < 12; i++) {
  await drag([300, 300], [380, 300], 8)
  await drag([380, 300], [300, 300], 8)
}
const softAfter = softPixels(await pixels(100, 100, 600, 600))
check(
  'twenty-four strokes leave the edges as sharp',
  softAfter < softBefore * 1.6,
  `${softBefore} → ${softAfter} partly painted pixels`,
)
await mode('Reconstruct')
await settings(400, 100)
const manySteps = await reconstruct([200, 300], [480, 300])
const afterMany = await pixels(100, 100, 600, 600)
check(
  'and reconstruct still gets back to the pixels',
  same(afterMany, original),
  `${differing(afterMany, original)} differ`,
)
for (let i = 0; i < 24 + manySteps; i++) await click('Undo')
await sleep(400)
check('undone', same(await pixels(100, 100, 600, 600), original))

// ----- Bloat, pucker and twirl -----
// The space between two lines, in the middle of a square of the grid: its width along a row
const gapAt = async (y, from, to) => {
  const row = await alphas(from, y, to - from, 1)
  const middle = Math.floor(row.length / 2)
  let left = middle
  let right = middle
  while (left > 0 && row[left] < 128) left--
  while (right < row.length - 1 && row[right] < 128) right++
  return right - left
}
const gap = await gapAt(340, 260, 340)
await mode('Bloat')
await settings(140, 100)
await hold([300, 340], 500)
const bloated = await gapAt(340, 220, 380)
check('bloat makes the middle bigger, more the longer it stays', bloated > gap * 1.3, `${gap} → ${bloated} pixels`)
await click('Undo')
await sleep(300)
await hold([300, 340], 120)
const bloatedLess = await gapAt(340, 220, 380)
check('held for less, less', bloatedLess < bloated && bloatedLess >= gap, `${bloatedLess} and ${bloated} pixels`)
await click('Undo')
await sleep(300)

await mode('Pucker')
await hold([300, 340], 500)
const puckered = await gapAt(340, 260, 340)
check('pucker makes the middle smaller', puckered < gap * 0.8, `${gap} → ${puckered} pixels`)
await click('Undo')
await sleep(300)

await mode('Twirl')
const straight = await pixels(240, 260, 120, 120)
await hold([300, 340], 500)
check('twirl turns what is around the middle', differing(await pixels(240, 260, 120, 120), straight) > 500)
await click('Undo')
await sleep(300)

// ----- Only the active layer -----
await click('New layer')
await sleep(200)
await page.evaluate(() => window.lydia.engine.setTool('liquify'))
await mode('Push')
await settings(160, 100)
await drag([200, 256], [320, 256])
check(
  'it reads only the active layer',
  (await alphas(200, 256, 200, 1)).every(a => a === 0),
)
await click('Delete layer')
await sleep(300)

// ----- Only inside the selection -----
await press('s')
await drag([200, 200], [420, 320])
await press('q')
await sleep(100)
await mode('Push')
await drag([240, 256], [360, 256])
const selected = await pixels(100, 100, 600, 600)
const rowOf = y => selected.slice((y - 100) * 600, (y - 100) * 600 + 600)
const originalRow = y => original.slice((y - 100) * 600, (y - 100) * 600 + 600)
check('inside the selection it moves', differing(rowOf(260), originalRow(260)) > 10)
check('outside it, nothing does', same(rowOf(190), originalRow(190)) && same(rowOf(340), originalRow(340)))
await click('Undo')
await sleep(300)
await page.evaluate(() => window.lydia.engine.deselect())
await sleep(200)

// ----- A locked transparency -----
const toggleLock = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('button.icon-button')]
      .find(b => /^(Lock its|Its) transparency/.test(b.title))
      .click(),
  )
const alphaOf = list => list.map(p => p[3])
await toggleLock()
await sleep(200)
await drag([200, 256], [320, 256])
check('a locked transparency stays as it was', same(alphaOf(await pixels(100, 100, 600, 600)), alphaOf(original)))
await click('Undo')
await sleep(300)
await toggleLock()
await sleep(200)

// ----- Another change: the next stroke starts from the layer as it is -----
await drag([200, 256], [320, 256])
const session = () => page.evaluate(() => [...window.lydia.liquify.storedTiles()].length)
check('a session keeps the tiles it uses', (await session()) > 0)
await press('b')
await drag([600, 200], [650, 200], 6)
await press('q')
await sleep(200)
const painted = await pixels(100, 100, 600, 600)
check('painting ends it', (await session()) === 0)
await mode('Reconstruct')
await barSlider('Size', 300)
await sleep(100)
await drag([180, 256], [340, 256], 12)
check('reconstruct then has nothing to go back to', same(await pixels(100, 100, 600, 600), painted))

// ----- Another layer ends it too -----
await mode('Push')
await drag([200, 256], [320, 256])
check('a new session', (await session()) > 0)
await click('New layer')
await sleep(300)
check('choosing another layer ends it', (await session()) === 0)
await click('Delete layer')
await sleep(300)

// ----- A smart object isn't changed -----
await page.evaluate(() => window.lydia.engine.setTool('move'))
await page.evaluate(() => window.lydia.engine.startTransform())
await sleep(700)
await page.keyboard.press('Enter')
await sleep(700)
const object = await pixels(100, 100, 600, 600)
await page.evaluate(() => window.lydia.engine.setTool('liquify'))
await sleep(100)
await drag([200, 256], [320, 256])
check('a smart object is left alone', same(await pixels(100, 100, 600, 600), object))
await click('Undo')
await sleep(500)

// ----- The pen's pressure changes the strength -----
const cdp = await page.createCDPSession()
const penStroke = async (from, to, force) => {
  const a = await pageOf(...from)
  const b = await pageOf(...to)
  const send = (type, x, y, buttons, pressure) =>
    cdp.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: type === 'mouseMoved' ? 'none' : 'left',
      buttons,
      clickCount: type === 'mouseMoved' ? 0 : 1,
      pointerType: 'pen',
      force: pressure,
    })
  await send('mouseMoved', a.x, a.y, 0, 0)
  await send('mousePressed', a.x, a.y, 1, force)
  for (let i = 1; i <= 30; i++) {
    await send('mouseMoved', a.x + ((b.x - a.x) * i) / 30, a.y + ((b.y - a.y) * i) / 30, 1, force)
  }
  await send('mouseReleased', b.x, b.y, 0, 0)
  await sleep(200)
}
const start = await pixels(100, 100, 600, 600)
await penStroke([200, 500], [320, 500], 0.3)
const light = differing(await pixels(100, 100, 600, 600), start)
await click('Undo')
await sleep(300)
await penStroke([200, 500], [320, 500], 1)
const hard = differing(await pixels(100, 100, 600, 600), start)
check('more pressure moves more', hard > light, `${light} and ${hard} pixels changed`)

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
