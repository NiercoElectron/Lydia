// Smudge and blur (decision 71): their buttons, keys and own settings; smudge drags paint, further the stronger, across
// the tiles' edges; blur softens an edge and nothing away from it; both undone exactly, only on the active layer,
// only inside the selection, keeping a locked transparency; the pen's pressure changes the strength, not the size
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
const chooseBrush = async name => {
  await page.evaluate(
    name =>
      [...document.querySelectorAll('button.brush')]
        .find(b => b.querySelector('.brush-name').textContent === name)
        .click(),
    name,
  )
  await sleep(300)
}
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
// A solid block of red on the active layer, painted with the brush
const redBlock = (left, top, right, bottom) =>
  page.evaluate(
    (left, top, right, bottom) => {
      const { brush, engine } = window.lydia
      engine.setBrush({ size: 20, color: '#ff0000', tool: 'brush', opacity: 1 })
      for (let y = top + 10; y <= bottom - 10; y += 8) {
        brush.startStroke(left + 10, y, 1)
        brush.continueStroke([{ x: right - 10, y, pressure: 1 }])
        brush.endStroke()
      }
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
// How far paint goes along a row: the last x from "from" with some paint
const reachOf = async (from, to, y) => {
  const row = await alphas(from, y, to - from, 1)
  return from + row.findLastIndex(a => a > 8)
}
const layerAction = text => click(text)

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
await chooseBrush('Hard round')

// ----- The buttons, keys and settings -----
const tools = await page.$$eval('.tool-column button', buttons => buttons.map(b => b.ariaLabel))
check('Smudge and Blur come after the eraser', tools.slice(1, 4).join() === 'Eraser,Smudge,Blur', tools.join())
await press('u')
check('U chooses Smudge', await page.$eval('.tool-column button[aria-label=Smudge]', b => b.ariaPressed === 'true'))
check('it has Strength, not Opacity', (await hasBarSlider('Strength')) && !(await hasBarSlider('Opacity')))
await barSlider('Size', 60)
await barSlider('Strength', 80)
await sleep(100)
await press('j')
check(
  'J chooses Blur, with its own Size and Strength',
  (await barSlider('Size')) === 40 && (await barSlider('Strength')) === 50,
)
await press('b')
check('the brush keeps its size', (await barSlider('Size')) === 20)
await press('u')
check('Smudge kept its own', (await barSlider('Size')) === 60 && (await barSlider('Strength')) === 80)

// ----- Smudge -----
await redBlock(40, 40, 200, 200)
await barSlider('Size', 40)
await barSlider('Strength', 50)
await sleep(100)
const before = await pixels(190, 120, 200, 1)
await drag([180, 120], [360, 120])
const reachMid = await reachOf(190, 500, 120)
check('smudge drags the paint past its edge', reachMid > 240, `to x = ${reachMid}`)
check('at 50%, it fades away before the stroke ends', reachMid < 350, `to x = ${reachMid}`)
const dragged = (await pixels(reachMid - 15, 120, 1, 1))[0]
check(
  'the paint dragged is still red, and thinner',
  dragged[3] > 0 && dragged[3] < 255 && dragged[0] / dragged[3] > 0.95 && dragged[1] === 0,
  dragged.join(),
)
const profile = await alphas(205, 120, 120, 1)
const drops = profile.filter((a, i) => i > 0 && a > profile[i - 1] + 3).length
check('it fades along the stroke, with no jump at the tile edge (x = 256)', drops === 0, `${drops} rises`)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/smudge.png' })

await click('Undo')
await sleep(300)
check('undo puts every pixel back', same(await pixels(190, 120, 200, 1), before))

await barSlider('Strength', 90)
await sleep(100)
await drag([180, 120], [360, 120])
const reachStrong = await reachOf(190, 500, 120)
check('stronger, it drags further', reachStrong > reachMid, `${reachMid} → ${reachStrong}`)
await click('Undo')
await sleep(300)

// ----- Blur -----
await press('j')
await barSlider('Size', 60)
await barSlider('Strength', 100)
await sleep(100)
const hardEdge = (await alphas(180, 120, 40, 1)).filter(a => a > 0 && a < 255).length
const awayBefore = await pixels(100, 60, 20, 1)
await drag([200, 80], [200, 160], 20)
const softEdge = (await alphas(180, 120, 40, 1)).filter(a => a > 0 && a < 255).length
check('blur softens an edge', softEdge > hardEdge + 3, `${hardEdge} → ${softEdge} partly painted`)
check('and nothing away from it', same(await pixels(100, 60, 20, 1), awayBefore))
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/blur.png' })
await click('Undo')
await sleep(300)
check('undone too', (await alphas(180, 120, 40, 1)).filter(a => a > 0 && a < 255).length === hardEdge)

// ----- Only the active layer -----
await layerAction('New layer')
await sleep(200)
await press('u')
await barSlider('Strength', 90)
await sleep(100)
await drag([180, 120], [360, 120])
check(
  'smudge reads only the active layer',
  (await alphas(160, 120, 200, 1)).every(a => a === 0),
)
await click('Undo')
await sleep(200)
await click('Delete layer')
await sleep(300)

// ----- Only inside the selection -----
await press('s')
await drag([100, 100], [300, 140])
await press('u')
await drag([180, 120], [400, 120])
check('inside the selection it drags', (await reachOf(190, 300, 120)) > 230)
check(
  'outside it, no paint comes out',
  (await alphas(305, 120, 200, 1)).every(a => a === 0),
)
await click('Undo')
await sleep(200)
await page.evaluate(() => window.lydia.engine.deselect())
await sleep(200)

// ----- A locked transparency -----
const toggleLock = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('button.icon-button')]
      .find(b => /^(Lock its|Its) transparency/.test(b.title))
      .click(),
  )
await toggleLock()
await sleep(200)
const locked = await page.evaluate(() => {
  const { engine } = window.lydia
  const { layers, activeLayerId } = engine.getSnapshot()
  return layers.find(layer => layer.id === activeLayerId).alphaLocked
})
check('the transparency is locked', locked)
await drag([180, 120], [400, 120])
check(
  'a locked transparency stays as it was',
  (await alphas(210, 120, 200, 1)).every(a => a === 0),
)
await click('Undo')
await sleep(200)
await toggleLock()
await sleep(200)

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
await penStroke([180, 120], [360, 120], 0.3)
const lightReach = await reachOf(190, 500, 120)
const lightWidth = (await alphas(208, 90, 1, 60)).filter(a => a > 0).length
await click('Undo')
await sleep(300)
await penStroke([180, 120], [360, 120], 1)
const hardReach = await reachOf(190, 500, 120)
const hardWidth = (await alphas(208, 90, 1, 60)).filter(a => a > 0).length
check('more pressure drags further', hardReach > lightReach, `${lightReach} → ${hardReach}`)
check('and the size stays', Math.abs(hardWidth - lightWidth) <= 6, `${lightWidth} and ${hardWidth} pixels wide`)

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
