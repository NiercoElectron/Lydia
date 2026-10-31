// Symmetry (decision 77): the copies of a dab; the bar and the Y key; left and right, up and down, four parts and radial,
// to the pixel where a mirror can be; one step of undo, and no darker where a stroke meets its copy; tips that aren't
// round, noise, the paper's grain, a pixel brush and pixel-perfect strokes; the eraser, smudge, blur and liquify; moving
// the center; the saved drawing and its autosave
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
await page.setViewport({ width: 1600, height: 1000 })
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
  await sleep(100)
}
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
const drag = async (from, to, steps = 20) => {
  const a = await pageOf(...from)
  const b = await pageOf(...to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps })
  await page.mouse.up()
  await sleep(200)
}
const setSymmetry = async change => {
  await page.evaluate(change => window.lydia.engine.setSymmetry(change), change)
  await sleep(100)
}
const brushAs = settings => page.evaluate(settings => window.lydia.engine.setBrush(settings), settings)
const barSlider = (label, value) =>
  page.evaluate(
    (label, value) => {
      const row = [...document.querySelectorAll('.toolbar label')].find(l => l.textContent.startsWith(label))
      const input = row.querySelector('input[type=range]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    label,
    value,
  )
// The alpha of each pixel of the active layer, in rows
const SIDE = 800
const alphas = () =>
  page.evaluate(SIDE => {
    const { app, gpu, stack } = window.lydia
    const out = new Array(SIDE * SIDE).fill(0)
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
            if (px < SIDE) out[py * SIDE + px] = pixels[(y * 256 + x) * 4 + 3]
          }
        }
      }
    }
    return out
  }, SIDE)
const painted = list => list.filter(a => a > 0).length
// How many pixels differ from the same picture mirrored or turned, by more than "by", around the center of the paper
const differences = (list, map, by = 0) => {
  let count = 0
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const [mx, my] = map(x, y)
      if (Math.abs(list[y * SIDE + x] - list[my * SIDE + mx]) > by) count++
    }
  }
  return count
}
const leftRight = (x, y) => [SIDE - 1 - x, y]
const upDown = (x, y) => [x, SIDE - 1 - y]
const quarterTurn = (x, y) => [SIDE - 1 - y, x]
const clean = async () => {
  await page.evaluate(() => window.lydia.engine.clearLayer())
  await sleep(400)
}

await page.goto('http://localhost:5198/', { waitUntil: 'networkidle0' })
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
await chooseBrush('Hard round')

// ----- The copies of a dab -----
const copies = await page.evaluate(async () => {
  const { symmetricDabs, copiesOf } = await import('/src/engine/symmetry.ts')
  const center = { x: 100, y: 100 }
  const dab = { x: 130, y: 90, size: 10, angle: 0.5, alpha: 1, seed: 7, pressure: 1 }
  const of = (mode, sectors = 6) => symmetricDabs({ mode, sectors, center }, dab, false)
  return {
    off: of('off').length,
    vertical: of('vertical').map(d => [d.x, d.y, !!d.flipped]),
    horizontal: of('horizontal').map(d => [d.x, d.y, !!d.flipped]),
    both: of('both').length,
    bothLast: of('both')[3],
    radial: of('radial', 6).length,
    radialAngle: of('radial', 4)[1].angle,
    radialFar: of('radial', 4)[1],
    counts: ['off', 'vertical', 'both'].map(mode => copiesOf({ mode, sectors: 6, center })),
    sectors: copiesOf({ mode: 'radial', sectors: 9, center }),
    pixel: symmetricDabs({ mode: 'radial', sectors: 3, center }, { ...dab, size: 3, x: 130.5, y: 90.5 }, true).map(
      d => [d.x % 1, d.angle],
    ),
  }
})
check('off, a dab stays alone', copies.off === 1)
check(
  'left and right: the x mirrored, the tip flipped',
  JSON.stringify(copies.vertical) === '[[130,90,false],[70,90,true]]',
  JSON.stringify(copies.vertical),
)
check(
  'up and down',
  JSON.stringify(copies.horizontal) === '[[130,90,false],[130,110,true]]',
  JSON.stringify(copies.horizontal),
)
check(
  'four parts: the last is turned half way round, not flipped',
  copies.both === 4 && copies.bothLast.x === 70 && copies.bothLast.y === 110 && !copies.bothLast.flipped,
)
check('radial: as many as parts', copies.radial === 6 && copies.sectors === 9 && copies.counts.join() === '1,2,4')
check(
  'and each turned, its tip too',
  Math.abs(copies.radialFar.x - 110) < 1e-9 &&
    Math.abs(copies.radialFar.y - 130) < 1e-9 &&
    Math.abs(copies.radialAngle - (0.5 + Math.PI / 2)) < 1e-9,
)
check(
  'a pixel brush stays on the pixels, its tip not turned',
  copies.pixel.every(([part, angle]) => part === 0.5 && angle === 0.5),
  JSON.stringify(copies.pixel),
)

// ----- The bar and the key -----
const modeOf = () => page.evaluate(() => window.lydia.engine.getSnapshot().symmetry.mode)
const hasButton = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].some(b => b.textContent === text), text)
check('it starts off', (await modeOf()) === 'off')
check('without its center buttons', !(await hasButton('Move center')))
await press('y')
check('Y turns it on', (await modeOf()) === 'vertical')
check('with them', (await hasButton('Move center')) && (await hasButton('Center')))
await page.select('.symmetry-mode', 'radial')
await sleep(150)
check('the list chooses it', (await modeOf()) === 'radial')
await press('y')
check('Y turns it off', (await modeOf()) === 'off')
await press('y')
check('and back as it was', (await modeOf()) === 'radial')
await press('y')

// ----- Mirrors, to the pixel -----
await brushAs({ size: 30, color: '#000000', tool: 'brush', opacity: 1 })
await setSymmetry({ mode: 'vertical' })
await drag([120, 150], [330, 420])
let list = await alphas()
// The graphics card rounds a mirrored tip a little differently: a few levels of 255, on a few pixels of a soft edge
const ROUNDING = 8
check(
  'left and right: both sides alike',
  differences(list, leftRight, ROUNDING) === 0,
  `${differences(list, leftRight, ROUNDING)} differ`,
)
check(
  'both are painted',
  painted(list.filter((_, i) => i % SIDE < 400)) > 2000 && painted(list.filter((_, i) => i % SIDE >= 400)) > 2000,
)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/symmetry.png' })
await click('Undo')
await sleep(300)
check('one step of undo takes both away', painted(await alphas()) === 0)

await setSymmetry({ mode: 'horizontal' })
await drag([150, 120], [420, 330])
list = await alphas()
check('up and down too', differences(list, upDown, ROUNDING) === 0, `${differences(list, upDown, ROUNDING)} differ`)
await click('Undo')
await sleep(300)

await setSymmetry({ mode: 'both' })
await drag([150, 120], [380, 330])
list = await alphas()
check(
  'four parts, alike',
  painted(list) > 8000 && differences(list, leftRight, ROUNDING) === 0 && differences(list, upDown, ROUNDING) === 0,
  `${differences(list, leftRight, ROUNDING)} and ${differences(list, upDown, ROUNDING)} differ`,
)
await click('Undo')
await sleep(300)

await setSymmetry({ mode: 'radial', sectors: 4 })
await drag([130, 110], [350, 300])
list = await alphas()
const turnedOff = differences(list, quarterTurn, 40)
check(
  'radial: each part turned',
  painted(list) > 8000 && turnedOff < painted(list) * 0.01,
  `${turnedOff} of ${painted(list)} differ`,
)
await click('Undo')
await sleep(300)
await setSymmetry({ mode: 'radial', sectors: 7 })
await setSymmetry({ mode: 'off' })
await drag([500, 200], [500, 260])
const alone = painted(await alphas())
await click('Undo')
await sleep(300)
await setSymmetry({ mode: 'radial', sectors: 7 })
await drag([500, 200], [500, 260])
const seven = painted(await alphas())
check('seven parts paint seven times as much', Math.abs(seven / alone - 7) < 0.5, `${alone} → ${seven}`)
await click('Undo')
await sleep(300)

// ----- No darker where a stroke meets its copy -----
await setSymmetry({ mode: 'vertical' })
await brushAs({ size: 40, color: '#000000', tool: 'brush', opacity: 0.5 })
await drag([300, 400], [500, 400])
list = await alphas()
const most = list.reduce((a, b) => Math.max(a, b), 0)
check('a stroke across the line is no darker where it meets its copy', most <= 129, `at most ${most}`)
await click('Undo')
await sleep(300)
await brushAs({ opacity: 1 })

// ----- Tips that aren't round -----
for (const [name, tolerance, share] of [
  ['Calligraphy', 40, 0.03],
  ['Chalk', 96, 0.12],
]) {
  await chooseBrush(name)
  await brushAs({ size: 60 })
  await sleep(100)
  await drag([150, 150], [340, 300])
  list = await alphas()
  const off = differences(list, leftRight, tolerance)
  check(`${name} is mirrored with its tip`, off < painted(list) * share, `${off} of ${painted(list)} differ`)
  await click('Undo')
  await sleep(300)
}

// The paper's grain stays the paper's: each side falls on grooves of its own, so they are alike but not the same
await chooseBrush('Pencil')
await brushAs({ size: 60 })
await sleep(100)
await drag([150, 150], [340, 300])
list = await alphas()
const leftSide = painted(list.filter((_, i) => i % SIDE < 400))
const rightSide = painted(list.filter((_, i) => i % SIDE >= 400))
check(
  "the Pencil paints both sides, on the paper's grain",
  Math.abs(leftSide - rightSide) < leftSide * 0.15,
  `${leftSide} and ${rightSide}`,
)
await click('Undo')
await sleep(300)

// ----- Pixel brushes -----
await chooseBrush('Pixel')
await brushAs({ size: 5 })
await sleep(150)
await drag([120, 150], [340, 262])
list = await alphas()
check(
  'a pixel brush, to the pixel',
  painted(list) > 500 && differences(list, leftRight) === 0,
  `${differences(list, leftRight)} differ`,
)
await click('Undo')
await sleep(300)
await click('Pixel-perfect')
await sleep(150)
await brushAs({ size: 1 })
await sleep(150)
await drag([120, 150], [340, 262], 60)
list = await alphas()
check(
  'pixel-perfect too',
  painted(list) > 200 && differences(list, leftRight) === 0,
  `${differences(list, leftRight)} differ`,
)
const doubled = (() => {
  let corners = 0
  for (let y = 1; y < SIDE - 1; y++) {
    for (let x = 1; x < SIDE - 1; x++) {
      if (list[y * SIDE + x] === 0) continue
      const right = list[y * SIDE + x + 1] > 0
      const left = list[y * SIDE + x - 1] > 0
      const up = list[(y - 1) * SIDE + x] > 0
      const down = list[(y + 1) * SIDE + x] > 0
      if ((right || left) && (up || down)) corners++
    }
  }
  return corners
})()
check('with no doubled corners on either side', doubled === 0, `${doubled} corners`)
await click('Undo')
await sleep(300)
await click('Pixel-perfect')
await sleep(150)

// ----- A selection, and a stroke off the side -----
await chooseBrush('Hard round')
await brushAs({ size: 30 })
await press('s')
await drag([100, 100], [300, 300])
await press('b')
await sleep(100)
await drag([150, 200], [250, 200])
list = await alphas()
check('outside the selection, the copy leaves nothing', painted(list.filter((_, i) => i % SIDE >= 400)) === 0)
await click('Undo')
await sleep(300)
await page.evaluate(() => window.lydia.engine.deselect())
await sleep(200)

// ----- The eraser, and straight lines -----
await setSymmetry({ mode: 'off' })
await brushAs({ size: 200 })
await drag([100, 400], [700, 400], 30)
await setSymmetry({ mode: 'vertical' })
await press('e')
await barSlider('Size', 40)
await sleep(120)
await drag([200, 300], [200, 500])
list = await alphas()
check(
  'the eraser is mirrored',
  list[400 * SIDE + 200] === 0 && list[400 * SIDE + 599] === 0 && list[400 * SIDE + 400] === 255,
)
await press('b')
await clean()

await brushAs({ size: 20 })
const shiftLine = await pageOf(320, 500)
await drag([100, 100], [110, 110], 3)
await page.keyboard.down('Shift')
await page.mouse.move(shiftLine.x, shiftLine.y)
await page.mouse.down()
await page.mouse.up()
await page.keyboard.up('Shift')
await sleep(300)
list = await alphas()
check(
  'a straight line too',
  painted(list) > 8000 && differences(list, leftRight, ROUNDING) < painted(list) * 0.001, // see decision 77
  `${differences(list, leftRight, ROUNDING)} of ${painted(list)} differ`,
)
await clean()

// ----- Smudge, blur and liquify -----
const block = async () => {
  await chooseBrush('Hard round')
  await brushAs({ size: 60, opacity: 1, color: '#000000', tool: 'brush' })
  await setSymmetry({ mode: 'vertical' })
  for (const y of [260, 310, 360]) await drag([120, y], [420, y], 30)
}
await block()
const blockBefore = await alphas()
await press('u')
await barSlider('Size', 50)
await barSlider('Strength', 90)
await sleep(120)
await drag([200, 300], [200, 460])
list = await alphas()
const smudged = differences(list, leftRight, 48)
check(
  'smudge is mirrored',
  differences(list, (x, y) => [x, y], 0) === 0 && painted(list) > painted(blockBefore) + 800,
  `${painted(blockBefore)} → ${painted(list)}`,
)
check('to within a little', smudged < painted(list) * 0.01, `${smudged} differ`)
await click('Undo')
await sleep(400)

await press('j')
await barSlider('Size', 60)
await barSlider('Strength', 100)
await sleep(120)
await drag([200, 230], [200, 390])
list = await alphas()
const blurred = differences(list, leftRight, 32)
const soft = list.filter(a => a > 0 && a < 255).length
check(
  'blur is mirrored',
  blurred < painted(list) * 0.01 && soft > blockBefore.filter(a => a > 0 && a < 255).length + 300,
  `${blurred} differ, ${soft} soft`,
)
await click('Undo')
await sleep(400)

await press('q')
await barSlider('Size', 160)
await barSlider('Strength', 100)
await sleep(120)
await drag([200, 200], [200, 330])
list = await alphas()
const moved = differences(list, leftRight, 48)
const changed = list.filter((a, i) => a !== blockBefore[i]).length
check('liquify is mirrored', changed > 1000 && moved < painted(list) * 0.01, `${changed} changed, ${moved} differ`)
await click('Bloat')
await sleep(100)
await click('Twirl')
await sleep(100)
await click('Undo')
await sleep(400)
const hold = async at => {
  const a = await pageOf(...at)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await sleep(400)
  await page.mouse.up()
  await sleep(200)
}
await hold([200, 310])
list = await alphas()
const twirled = differences(list, leftRight, 64)
check(
  'a twirl turns the other way on the other side',
  twirled < painted(list) * 0.02,
  `${twirled} of ${painted(list)} differ`,
)
await click('Undo')
await sleep(400)
await click('Reconstruct')
await sleep(100)
await click('Push')
await sleep(100)
await press('b')
await clean()

// ----- Moving the center -----
await setSymmetry({ mode: 'vertical' })
await click('Move center')
await sleep(150)
await drag([400, 400], [300, 250], 6)
const moved2 = await page.evaluate(() => window.lydia.engine.getSnapshot().symmetry.center)
check('dragging moves the center', moved2.x === 300 && moved2.y === 250, JSON.stringify(moved2))
check('and paints nothing', painted(await alphas()) === 0)
await click('Move center')
await sleep(150)
await brushAs({ size: 30, color: '#000000', tool: 'brush', opacity: 1 })
await drag([150, 500], [220, 600])
list = await alphas()
check(
  'strokes mirror around it',
  painted(list) > 1000 && differences(list, (x, y) => (x < 600 ? [599 - x, y] : [x, y])) === 0,
)
await click('Undo')
await sleep(300)
await click('Center')
await sleep(150)
const backAt = await page.evaluate(() => window.lydia.engine.getSnapshot().symmetry.center)
check('Center puts it back', backAt.x === 400 && backAt.y === 400, JSON.stringify(backAt))
await click('Move center')
await sleep(150)
await drag([400, 400], [5000, 400], 4)
const atEdge = await page.evaluate(() => window.lydia.engine.getSnapshot().symmetry.center)
check('it stays on the paper', atEdge.x === SIDE, JSON.stringify(atEdge))
await click('Move center')
await click('Center')
await sleep(150)

// ----- The saved drawing, and its autosave -----
await setSymmetry({ mode: 'radial', sectors: 5, center: { x: 250.5, y: 300 } })
const inFile = () =>
  page.evaluate(async () => {
    const { parseProject } = await import('/src/engine/projectFile.ts')
    const file = await window.lydia.engine.saveProject()
    return parseProject(await file.arrayBuffer()).symmetry ?? null
  })
const kept = await inFile()
check(
  'the file keeps it',
  JSON.stringify(kept) === '{"mode":"radial","sectors":5,"center":{"x":250.5,"y":300}}',
  JSON.stringify(kept),
)
await page.evaluate(() => window.lydia.autosaveNow())
await sleep(200)
const recovered = await page.evaluate(async () => {
  const { listAutosaved, loadAutosaved } = await import('/src/autosave.ts')
  const [drawing] = await listAutosaved()
  return drawing ? (await loadAutosaved(drawing.id)).symmetry : 'no copy'
})
check('and so does its autosave', recovered?.sectors === 5, JSON.stringify(recovered))
await setSymmetry({ mode: 'off' })
check('off, the file has none', (await inFile()) === null)
const damaged = await page.evaluate(async () => {
  const { isSymmetry } = await import('/src/engine/symmetry.ts')
  const center = { x: 10, y: 10 }
  return [
    isSymmetry({ mode: 'radial', sectors: 99, center }, 100, 100),
    isSymmetry({ mode: 'spiral', sectors: 4, center }, 100, 100),
    isSymmetry({ mode: 'radial', sectors: 4, center: { x: 900, y: 1 } }, 100, 100),
    isSymmetry(null, 100, 100),
  ]
})
check(
  'nonsense in a file is left out',
  damaged.every(ok => !ok),
)

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
