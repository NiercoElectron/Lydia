// Shapes (decision 79): their outlines and boxes; drawing each kind on a new layer, with Shift and Alt; one step of undo;
// fill and outline, their colors and the brush, changed after they are drawn; polygons and stars; a transform and a mesh
// keeping the outline as thick as it was; the move tool; a line's ends; a pixel brush and a grainy one; painting blocked,
// Convert to pixels, and a duplicate; the saved file, opened again and still editable, and its autosave
import fs from 'node:fs'
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
const hasButton = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].some(b => b.textContent === text), text)
const isDisabled = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).disabled, text)
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
const snapshot = () => page.evaluate(() => window.lydia.engine.getSnapshot())
const waitIdle = async () => {
  await sleep(100)
  await page.waitForFunction(
    () => {
      const snap = window.lydia.engine.getSnapshot()
      return !snap.task && !snap.transform && !snap.isUpdating && !window.lydia.projection.isUpdating()
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
const dragHandle = async (from, to) => {
  const a = await pageOf(...from)
  const b = await pageOf(...to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 10 })
  await page.mouse.up()
  await sleep(100)
}
const drag = async (from, to) => {
  await dragHandle(from, to)
  await waitIdle()
}
const style = change => page.evaluate(change => window.lydia.engine.setShapeStyle(change), change)
const commit = async () => {
  await page.evaluate(() => window.lydia.engine.commitShapeStyle())
  await waitIdle()
}
const styleNow = async () => (await snapshot()).shapeStyle
const kind = async value => {
  await page.select('.shape-kind', value)
  await waitIdle()
}
const activeShape = () => page.evaluate(() => window.lydia.stack.active.shape ?? null)
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
const colorAt = (list, x, y) => [0, 1, 2].map(c => list[(y * SIDE + x) * 4 + c])
const paintedCount = list => {
  let count = 0
  for (let i = 3; i < list.length; i += 4) if (list[i] > 127) count++
  return count
}
const paintBox = list => {
  const box = { left: SIDE, right: -1, top: SIDE, bottom: -1 }
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      if (alphaAt(list, x, y) < 128) continue
      box.left = Math.min(box.left, x)
      box.right = Math.max(box.right, x)
      box.top = Math.min(box.top, y)
      box.bottom = Math.max(box.bottom, y)
    }
  }
  return box
}
// How many painted pixels in a row in a column: how thick an outline is where a line crosses it, from the middle of the
// paint out: the run of paint from "from" going by "step"
const runLength = (list, x, y, stepX, stepY) => {
  while (alphaAt(list, x, y) < 128 && x > 0 && y > 0 && x < SIDE - 1 && y < SIDE - 1) {
    x += stepX
    y += stepY
  }
  let run = 0
  while (alphaAt(list, x, y) >= 128 && x > 0 && y > 0 && x < SIDE - 1 && y < SIDE - 1) {
    run++
    x += stepX
    y += stepY
  }
  return run
}
const near = (a, b, by = 1) => Math.abs(a - b) <= by

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

// ----- The outlines and the boxes -----
const math = await page.evaluate(async () => {
  const { shapeBox, shapePath, lineEnds, transformedShape, DEFAULT_SHAPE_STYLE } = await import('/src/engine/shapes.ts')
  const { shapeInProject } = await import('/src/engine/projectFile.ts')
  const shape = (kind, more = {}) => ({
    ...DEFAULT_SHAPE_STYLE,
    kind,
    from: { x: 100, y: 100 },
    to: { x: 300, y: 300 },
    placements: [],
    ...more,
  })
  const square = { x: 100, y: 100, width: 200, height: 200 }
  const quadOf = (x, y, w, h) => [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
  const moved = transformedShape(shape('rectangle'), square, quadOf(150, 100, 200, 200))
  const twice = transformedShape(moved, { x: 150, y: 100, width: 200, height: 200 }, quadOf(150, 100, 400, 200))
  const line = shape('line')
  const flatFile = { ...shape('star'), outline: { ...shape('star').outline, brush: 0 } }
  const goodBrush = JSON.stringify({ name: 'x' })
  return {
    rectangle: shapePath(shape('rectangle')),
    ellipse: shapePath(shape('ellipse')),
    line: shapePath(line),
    pentagon: shapePath(shape('polygon')),
    star: shapePath(shape('star', { sides: 6, depth: 40 })),
    placements: twice.placements.length,
    twice: shapePath(twice).points,
    ends: lineEnds(transformedShape(line, square, quadOf(150, 100, 200, 200))),
    bentEnds: lineEnds({ ...line, placements: [{ bounds: square, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], warp: {} }] }),
    notLine: lineEnds(shape('ellipse')),
    even: shapeBox('rectangle', { x: 0, y: 0 }, { x: 100, y: -40 }, true, false),
    middle: shapeBox('ellipse', { x: 50, y: 50 }, { x: 80, y: 90 }, false, true),
    level: shapeBox('line', { x: 0, y: 0 }, { x: 100, y: 3 }, true, false),
    damaged: [
      shapeInProject(null, []),
      shapeInProject(flatFile, null),
      shapeInProject(flatFile, ['not a brush']),
      shapeInProject({ ...flatFile, kind: 'blob' }, [goodBrush]),
      shapeInProject({ ...flatFile, sides: 99 }, [goodBrush]),
      shapeInProject({ ...flatFile, placements: [{ bounds: square, matrix: [1] }] }, [goodBrush]),
      shapeInProject({ ...flatFile, fill: { isOn: true, color: 'red' } }, [goodBrush]),
    ],
  }
})
check(
  'a rectangle has its four corners',
  math.rectangle.isClosed && math.rectangle.points.length === 4 && math.rectangle.points[2].x === 300,
  JSON.stringify(math.rectangle),
)
check(
  'an ellipse is round, in many points',
  math.ellipse.isClosed &&
    math.ellipse.points.length > 100 &&
    math.ellipse.points.every(p => near(Math.hypot(p.x - 200, p.y - 200), 100, 1e-6)),
  `${math.ellipse.points.length}`,
)
check('a line is open', !math.line.isClosed && math.line.points.length === 2, JSON.stringify(math.line))
check(
  'a polygon has its sides, the first corner up',
  math.pentagon.points.length === 5 &&
    near(math.pentagon.points[0].y, 100, 1e-6) &&
    near(math.pentagon.points[0].x, 200, 1e-6),
  JSON.stringify(math.pentagon.points[0]),
)
check(
  'a star goes in and out',
  math.star.points.length === 12 &&
    near(Math.hypot(math.star.points[1].x - 200, math.star.points[1].y - 200), 40, 1e-6) &&
    near(Math.hypot(math.star.points[2].x - 200, math.star.points[2].y - 200), 100, 1e-6),
)
check(
  'two transforms in a row, each from where the last left it, are one matrix',
  math.placements === 1 && near(math.twice[0].x, 150, 1e-6) && near(math.twice[1].x, 550, 1e-6),
  JSON.stringify(math.twice),
)
check('a line ends where it was taken', near(math.ends[1].x, 350, 1e-6), JSON.stringify(math.ends))
check('a bent one has no ends to take, nor has an ellipse', math.bentEnds === null && math.notLine === null)
check('Shift keeps a box square', math.even.to.x === 100 && math.even.to.y === -100, JSON.stringify(math.even))
check(
  'Alt draws it from its middle',
  math.middle.from.x === 20 && math.middle.from.y === 10,
  JSON.stringify(math.middle),
)
check('Shift keeps a line level', math.level.to.y === 0, JSON.stringify(math.level))
check(
  'nonsense in a file is left out',
  math.damaged.every(shape => shape === null),
)

// ----- Drawing -----
await press('p')
check('P chooses the tool, with its bar', (await page.$('.shape-kind')) !== null)
check('its fill on and its outline off at first', (await styleNow()).fill.isOn && !(await styleNow()).outline.isOn)
check("the only thing on can't go off", await isDisabled('Fill'))
const layersAtFirst = (await snapshot()).layers.length
await drag([200, 150], [600, 450])
let snap = await snapshot()
check(
  'a shape is a new layer, the active one',
  snap.layers.length === layersAtFirst + 1 && snap.isShapeLayer && snap.layers.at(-1).isShape,
  JSON.stringify(snap.layers.map(l => l.name)),
)
check('named like any layer', snap.layers.at(-1).name === 'Layer 2', snap.layers.at(-1).name)
let list = await pixelsOf()
let box = paintBox(list)
check(
  'filled as far as it was dragged',
  near(box.left, 200) && near(box.right, 599) && near(box.top, 150) && near(box.bottom, 449),
  JSON.stringify(box),
)
check('all of it', near(paintedCount(list), 400 * 300, 900), `${paintedCount(list)}`)
check('it shows', (await page.evaluate(() => window.lydia.projection.colorAt(400, 300))) === '#000000')
await click('Undo')
await waitIdle()
check('one step of undo takes it away', (await snapshot()).layers.length === layersAtFirst)
await click('Redo')
await waitIdle()
snap = await snapshot()
check('and redo brings it back, a shape', snap.isShapeLayer && paintedCount(await pixelsOf()) > 100000)
const before = (await snapshot()).layers.length
const a = await pageOf(100, 100)
await page.mouse.click(a.x, a.y)
await sleep(200)
check('a click draws nothing', (await snapshot()).layers.length === before)

// ----- Several in a row -----
// The bar sets the next shape, so the active one stays as it is, and the next goes on a new layer
const firstShape = await activeShape()
const layersBefore = (await snapshot()).layers.length
await kind('ellipse')
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#00ff00' }))
await page.evaluate(() => window.lydia.engine.setShapeColor('fill'))
await sleep(100)
check('the bar leaves the active shape alone', JSON.stringify(await activeShape()) === JSON.stringify(firstShape))
await drag([50, 500], [250, 700])
snap = await snapshot()
check(
  'and the next one comes out as it says, on a layer of its own',
  snap.layers.length === layersBefore + 1 &&
    (await activeShape()).kind === 'ellipse' &&
    (await activeShape()).fill.color === '#00ff00',
  JSON.stringify((await activeShape()).fill),
)
check('with no need to change layers', snap.isShapeLayer && !snap.isEditingShape)
await click('Undo')
await waitIdle()
await kind('rectangle')
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#000000' }))
await page.evaluate(() => window.lydia.engine.setShapeColor('fill'))
await sleep(100)

// ----- What can change after it is drawn -----
await click('Edit shape')
await sleep(100)
check('Edit shape shows the active shape', (await snapshot()).isEditingShape)
const editingLayers = (await snapshot()).layers.length
await drag([50, 500], [250, 700])
check('and dragging draws no other meanwhile', (await snapshot()).layers.length === editingLayers)
await click('Edit shape')
await sleep(100)
await kind('star')
await click('Edit shape')
await sleep(100)
check('it keeps apart from the next one', (await snapshot()).shapeStyle.kind === 'rectangle')
await click('Edit shape')
await sleep(100)
await kind('rectangle')
await click('Edit shape')
await sleep(100)
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#ff0000' }))
await page.evaluate(() => window.lydia.engine.setShapeColor('fill'))
await waitIdle()
list = await pixelsOf()
check(
  'the fill takes the color chosen now',
  colorAt(list, 400, 300).join() === '255,0,0',
  colorAt(list, 400, 300).join(),
)
await chooseBrush('Hard round')
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#0000ff' }))
await click('Outline')
await waitIdle()
await page.evaluate(() => window.lydia.engine.setShapeColor('outline'))
await waitIdle()
await style({ outline: { ...(await styleNow()).outline, size: 40 } })
await commit()
list = await pixelsOf()
box = paintBox(list)
check('the outline goes around it', near(box.left, 180, 2) && near(box.right, 619, 2), JSON.stringify(box))
check('its color on the edge', colorAt(list, 400, 150).join() === '0,0,255', colorAt(list, 400, 150).join())
check('and the fill stays inside', colorAt(list, 400, 300).join() === '255,0,0')
await click('Fill')
await waitIdle()
list = await pixelsOf()
check('with no fill, the inside is empty', alphaAt(list, 400, 300) === 0 && alphaAt(list, 400, 150) === 255)
check('as thick as its size', near(runLength(list, 400, 100, 0, 1), 40, 2), `${runLength(list, 400, 100, 0, 1)}`)
await click('Fill')
await waitIdle()

// One step of undo for each change, and a slider is one when it is let go
const sizeBefore = (await activeShape()).outline.size
await page.evaluate(() => {
  const label = [...document.querySelectorAll('.toolbar label')].find(l => l.textContent.startsWith('Size'))
  const input = label.querySelector('input[type=range]')
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  for (const value of [50, 60, 70]) {
    setValue.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
})
await waitIdle()
check(
  'a slider changes it when let go',
  (await activeShape()).outline.size === 70,
  `${(await activeShape()).outline.size}`,
)
await click('Undo')
await waitIdle()
check('as one step of undo', (await activeShape()).outline.size === sizeBefore, `${(await activeShape()).outline.size}`)

// How many sides, and the kind
await kind('ellipse')
await click('Outline')
await waitIdle()
list = await pixelsOf()
check(
  'a rectangle can become an ellipse',
  (await activeShape()).kind === 'ellipse' && near(paintedCount(list), Math.PI * 200 * 150, 1500),
  `${paintedCount(list)}`,
)
await kind('polygon')
await style({ sides: 3 })
await commit()
list = await pixelsOf()
check('a polygon, with 3 sides', alphaAt(list, 400, 155) === 255 && alphaAt(list, 230, 160) === 0)
await kind('star')
await style({ sides: 5, depth: 30 })
await commit()
const star = paintedCount(await pixelsOf())
await style({ depth: 80 })
await commit()
check('a star gets fatter with its depth', paintedCount(await pixelsOf()) > star * 1.5, `${star}`)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/shapes-star.png' })
await kind('rectangle')

// With another brush: nothing depends on the library
await click('Outline')
await waitIdle()
await style({ outline: { ...(await styleNow()).outline, size: 60 } })
await commit()
const hardFile = (await activeShape()).outline.brush
await chooseBrush('Pencil')
await press('p')
await click('Use this brush')
await waitIdle()
const pencilShape = await activeShape()
check('it takes the brush chosen now', pencilShape.outline.brush !== hardFile)
list = await pixelsOf()
const onEdge = []
for (let x = 300; x < 500; x++) onEdge.push(alphaAt(list, x, 135)) // outside the fill
check(
  "a brush's paper grain shows on the outline",
  onEdge.some(alpha => alpha < 128) && onEdge.some(alpha => alpha > 0),
  `${Math.min(...onEdge)} to ${Math.max(...onEdge)}`,
)
await click('Undo')
await waitIdle()
check('undo gives the old one back', (await activeShape()).outline.brush === hardFile)
await chooseBrush('Pixel')
await press('p')
await click('Use this brush')
await waitIdle()
list = await pixelsOf()
let isHard = true
for (let i = 3; i < list.length; i += 4) if (list[i] !== 0 && list[i] !== 255) isHard = false
check('a pixel brush has hard edges, all around', isHard)
await click('Undo')
await waitIdle()
await chooseBrush('Hard round')
await press('p')

// ----- Transforms -----
await style({ outline: { ...(await styleNow()).outline, size: 20 } })
await commit()
const transform = async () => {
  await click('Transform')
  await page.waitForFunction(() => window.lydia.engine.getSnapshot().transform !== null, { timeout: 60000 })
  await sleep(200)
}
const apply = async () => {
  await page.keyboard.press('Enter')
  await waitIdle()
}
await click('Fill')
await waitIdle()
list = await pixelsOf()
box = paintBox(list)
const thickBefore = runLength(list, 400, box.top - 5, 0, 1)
await transform()
check('a shape has handles', (await snapshot()).transform !== null)
await dragHandle([box.right + 1, (box.top + box.bottom) / 2], [box.right + 1 - 300, (box.top + box.bottom) / 2])
await apply()
list = await pixelsOf()
const squeezed = paintBox(list)
check('it can be squeezed', near(squeezed.right, box.right - 300, 8), JSON.stringify(squeezed))
const middleY = Math.round((squeezed.top + squeezed.bottom) / 2)
const sideThick = runLength(list, 20, middleY, 1, 0)
check(
  'and its outline stays as thick, on every side',
  near(sideThick, thickBefore, 2) && near(runLength(list, 250, 5, 0, 1), thickBefore, 2),
  `${sideThick} and ${thickBefore}`,
)
snap = await snapshot()
check('and it is still a shape', snap.isShapeLayer && (await activeShape()).placements.length === 1)
await style({ sides: 5 })
await kind('star')
list = await pixelsOf()
check(
  'with its kind still free to change',
  (await activeShape()).kind === 'star' && paintBox(list).right < box.right - 200,
)
await click('Undo')
await waitIdle()
await click('Undo')
await waitIdle()
check('undo gives the shape back from before', (await activeShape()).placements.length === 0)
list = await pixelsOf()
check('and its picture', near(paintBox(list).right, box.right, 1), JSON.stringify(paintBox(list)))

// A mesh bends the sides, and the outline follows them
await transform()
await click('Mesh')
await sleep(300)
const meshPoints = await page.evaluate(() => window.lydia.engine.getSnapshot().transform)
const third = (box.right - box.left) / 3
await dragHandle([box.left + third, box.top + (box.bottom - box.top) / 3], [box.left + third, box.top - 80])
await apply()
list = await pixelsOf()
check(
  'a mesh bends it',
  (await activeShape()).placements.some(p => p.warp),
  JSON.stringify(meshPoints?.mode),
)
check(
  'and its outline stays as wide',
  near(runLength(list, 700, 300, -1, 0), thickBefore, 3),
  `${runLength(list, 700, 300, -1, 0)}`,
)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/shapes-mesh.png' })
await click('Undo')
await waitIdle()

// The move tool moves it, without losing anything
await press('v')
await drag([400, 300], [450, 340])
await waitIdle()
list = await pixelsOf()
const movedBox = paintBox(list)
check(
  'the move tool moves it',
  near(movedBox.left, box.left + 50, 1) && near(movedBox.top, box.top + 40, 1),
  JSON.stringify(movedBox),
)
await press('p')
await style({ outline: { ...(await styleNow()).outline, size: 30 } })
await commit()
const afterMove = paintBox(await pixelsOf())
check('and it is painted there from then on', near(afterMove.left + 5, movedBox.left, 2), JSON.stringify(afterMove))
await click('Undo')
await waitIdle()
await click('Undo')
await waitIdle()

// ----- A line -----
await click('Edit shape')
await sleep(100)
await kind('line')
await drag([100, 650], [700, 650])
list = await pixelsOf()
box = paintBox(list)
check(
  'a line, outlined with the brush',
  near(box.top, 640, 2) && near(box.bottom, 659, 2) && near(box.right, 709, 2),
  JSON.stringify(box),
)
check('with nothing to fill', !(await hasButton('Fill')))
check("and its outline can't go off", await isDisabled('Outline'))
await click('Edit shape')
await sleep(300)
await drag([700, 650], [500, 750])
const movedLine = await activeShape()
check(
  'its end moves',
  near(movedLine.to.x, 500, 1) && near(movedLine.to.y, 750, 1) && near(movedLine.from.x, 100, 1),
  JSON.stringify(movedLine.to),
)
await click('Undo')
await waitIdle()

// ----- Painting on it -----
await press('b')
check(
  "the brush can't paint on it",
  await page.evaluate(() => document.querySelector('.notice')?.textContent.includes('shape')),
)
const pixelsBefore = paintedCount(await pixelsOf())
await drag([200, 650], [300, 300])
check('nor does it', paintedCount(await pixelsOf()) === pixelsBefore)
await click('Convert to pixels')
await sleep(200)
check('until it is pixels', !(await snapshot()).isShapeLayer)
await drag([200, 200], [300, 300])
check('and then it paints', paintedCount(await pixelsOf()) > pixelsBefore)
await click('Undo')
await waitIdle()
await click('Undo')
await waitIdle()
check('undo makes it a shape again', (await snapshot()).isShapeLayer)

await click('Duplicate')
await waitIdle()
snap = await snapshot()
check(
  'a copy is a shape too',
  snap.isShapeLayer && snap.layers.at(-1).isShape,
  JSON.stringify(snap.layers.map(l => l.name)),
)
await click('Undo')
await waitIdle()

// ----- The saved drawing, opened again, and its autosave -----
const saved = await page.evaluate(async () => {
  const blob = await window.lydia.engine.saveProject()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(s)
})
const bytes = Buffer.from(saved, 'base64')
fs.writeFileSync(OUT + '/shapes.lyd', bytes)
const header = JSON.parse(bytes.subarray(12, 12 + bytes.readUInt32LE(8)).toString())
const shapesInFile = header.layers.filter(layer => layer.shape)
check('the file keeps them', shapesInFile.length === 2, `${shapesInFile.length}`)
check('and each brush once', header.brushes?.length === 1, `${header.brushes?.length}`)
await page.evaluate(() => window.lydia.autosaveNow())
await sleep(300)
const recovered = await page.evaluate(async () => {
  const { listAutosaved, loadAutosaved } = await import('/src/autosave.ts')
  const [drawing] = await listAutosaved()
  const project = await loadAutosaved(drawing.id)
  return project.layers.map(layer => layer.shape?.kind ?? null)
})
check('and so does its autosave', recovered.filter(Boolean).length === 2, JSON.stringify(recovered))
const picture = await pixelsOf()
page.on('dialog', d => d.accept())
await click('Back')
await sleep(300)
const [chooser] = await Promise.all([page.waitForFileChooser(), click('Open project')])
await chooser.accept([OUT + '/shapes.lyd'])
await page.waitForFunction(() => window.lydia?.engine && document.querySelectorAll('button.brush').length > 0, {
  timeout: 60000,
})
await sleep(800)
snap = await snapshot()
check('opened again, it is a shape', snap.isShapeLayer, JSON.stringify(snap.layers.map(l => [l.name, l.isShape])))
let same = 0
const opened = await pixelsOf()
for (let i = 0; i < opened.length; i++) if (opened[i] !== picture[i]) same++
check('with its picture', same === 0, `${same} differ`)
await press('p')
await sleep(100)
await click('Edit shape')
await sleep(100)
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#00ff00' }))
await page.evaluate(() => window.lydia.engine.setShapeColor('outline'))
await waitIdle()
const greenLine = paintBox(await pixelsOf())
const reopened = await pixelsOf()
check(
  'and it can still change, with its brush out of the file',
  colorAt(reopened, 300, 650).join() === '0,255,0',
  `${colorAt(reopened, 300, 650).join()} ${JSON.stringify(greenLine)}`,
)

// ----- With the other layers -----
// Multiply gives the same color where the star under it has as much red, no green, and nearly as much blue
await click('New layer')
await waitIdle()
await kind('rectangle')
await style({ fill: { isOn: true, color: '#ff00fd' }, outline: { ...(await styleNow()).outline, isOn: false } })
await sleep(100)
await drag([100, 100], [300, 300])
await click('New layer')
await waitIdle()
await style({ fill: { isOn: true, color: '#ff0040' }, outline: { ...(await styleNow()).outline, isOn: false } })
await sleep(100)
await drag([200, 200], [400, 400])
await page.evaluate(() => {
  const { engine, stack } = window.lydia
  engine.setLayerBlendMode(stack.active.id, 'multiply')
})
await waitIdle()
const shownAt = (x, y) => page.evaluate((x, y) => window.lydia.projection.colorAt(x, y), x, y)
check(
  'a shape multiplies what is under it',
  (await shownAt(350, 350)) === '#ff0040' && ['#ff003f', '#ff0040'].includes(await shownAt(250, 250)),
  `${await shownAt(350, 350)} over white, ${await shownAt(250, 250)} over the magenta`,
)
await click('Edit shape')
await sleep(100)
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#808080' }))
await page.evaluate(() => window.lydia.engine.setShapeColor('fill'))
await waitIdle()
check('and a gray one darkens it', (await shownAt(250, 250)) === '#80007f', await shownAt(250, 250))
check(
  'its layer shows the icon of a shape',
  (await page.evaluate(() => document.querySelectorAll('.smart-icon[aria-label="Shape"]').length)) >= 3,
)

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
