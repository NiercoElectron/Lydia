// The curves tool (decision 89): the curve's line and handles; corners, smooth points and Alt; closing on the first
// point, Enter and a double click ending it open, Esc, Backspace and Ctrl+Z while drawing; a curve as a shape on a new
// layer, one step of undo, filled, with thin ends; Make Selection; Edit shape dragging a point; the file and the autosave
import fs from 'node:fs'
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
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
const click = text =>
  page.evaluate(text => {
    const named = selector => [...document.querySelectorAll(selector)].find(b => b.textContent === text)
    ;(named('.toolbar button') ?? named('button')).click()
  }, text)
const isDisabled = text =>
  page.evaluate(
    text => [...document.querySelectorAll('.toolbar button')].find(b => b.textContent === text).disabled,
    text,
  )
const isPressed = text =>
  page.evaluate(
    text => [...document.querySelectorAll('.toolbar button')].find(b => b.textContent === text).ariaPressed === 'true',
    text,
  )
const press = async (key, modifier) => {
  if (modifier) await page.keyboard.down(modifier)
  await page.keyboard.press(key)
  if (modifier) await page.keyboard.up(modifier)
  await sleep(100)
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
// A click on a point of the paper, a corner of the curve
const put = async (x, y) => {
  const at = await pageOf(x, y)
  await page.mouse.click(at.x, at.y)
  await sleep(80)
}
// A point of the paper pulled to another: a smooth point, its handles pulled out
const pull = async ([x, y], [toX, toY], modifier) => {
  const a = await pageOf(x, y)
  const b = await pageOf(toX, toY)
  await page.mouse.move(a.x, a.y)
  if (modifier) await page.keyboard.down(modifier) // held from the start, as Alt on the last point
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 8 })
  await page.mouse.up()
  if (modifier) await page.keyboard.up(modifier)
  await sleep(80)
}
const activeShape = () => page.evaluate(() => window.lydia.stack.active.shape ?? null)
const style = change => page.evaluate(change => window.lydia.engine.setShapeStyle(change), change)
const styleNow = async () => (await snapshot()).shapeStyle
// Each pixel's alpha on the active layer
const SIDE = 800
const alphasOf = () =>
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
const alphaAt = (list, x, y) => list[y * SIDE + x]
// How many painted pixels in a column, across a level line
const thickness = (list, x) => {
  let count = 0
  for (let y = 0; y < SIDE; y++) if (alphaAt(list, x, y) >= 128) count++
  return count
}
const near = (a, b, by = 1e-6) => Math.abs(a - b) <= by
// How much a pixel of the paper is selected (0–255), or null when nothing is
const selectedAt = (x, y) =>
  page.evaluate(
    (x, y) => {
      const selection = window.lydia.engine.getSelection()
      if (!selection) return null
      const column = Math.floor(x / 256)
      const row = Math.floor(y / 256)
      const tile = selection.get(column + ',' + row)
      if (!tile) return 0
      if (tile === 'full') return 255
      const width = window.lydia.projection.tiles.get(column + ',' + row).width
      return tile[(Math.floor(y) - row * 256) * width + (Math.floor(x) - column * 256)]
    },
    x,
    y,
  )
const chooseSelects = async label => {
  await page.evaluate(
    label => [...document.querySelectorAll('.curve-selects button')].find(b => b.textContent === label).click(),
    label,
  )
  await sleep(100)
}
const rounded = ({ x, y }) => ({ x: Math.round(x), y: Math.round(y) })

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
await page.evaluate(() =>
  [...document.querySelectorAll('button.brush')]
    .find(b => b.querySelector('.brush-name').textContent === 'Hard round')
    .click(),
)
await sleep(300)

// ----- The line and the handles -----
const math = await page.evaluate(async () => {
  const { curveLine, withHandle, cornerAt } = await import('/src/engine/curves.ts')
  const { shapeInProject } = await import('/src/engine/projectFile.ts')
  const { DEFAULT_CURVE_STYLE } = await import('/src/engine/shapes.ts')
  const corners = {
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ].map(cornerAt),
    isClosed: false,
  }
  const arch = {
    points: [
      { at: { x: 100, y: 400 }, before: { x: 100, y: 400 }, after: { x: 100, y: 200 }, isSmooth: true },
      { at: { x: 500, y: 400 }, before: { x: 500, y: 200 }, after: { x: 500, y: 400 }, isSmooth: true },
    ],
    isClosed: false,
  }
  const smooth = { at: { x: 0, y: 0 }, before: { x: -10, y: 0 }, after: { x: 10, y: 0 }, isSmooth: true }
  const archLine = curveLine(arch)
  const goodBrush = (await import('/src/brushes/soft-round.lydbrush?raw')).default
  const inFile = {
    ...DEFAULT_CURVE_STYLE,
    from: { x: 100, y: 400 },
    to: { x: 500, y: 400 },
    placements: [],
    curve: arch,
    outline: { ...DEFAULT_CURVE_STYLE.outline, brush: 0 },
  }
  const { taper, ...noTaper } = inFile
  return {
    corners: curveLine(corners),
    closed: curveLine({ ...corners, isClosed: true }),
    archMiddle: archLine[Math.floor(archLine.length / 2)],
    archEnds: [archLine[0], archLine.at(-1)],
    archCount: archLine.length,
    turned: withHandle(smooth, 'after', { x: 0, y: 20 }, false),
    broken: withHandle(smooth, 'after', { x: 0, y: 20 }, true),
    good: shapeInProject(inFile, [goodBrush]) !== null,
    oldTaper: shapeInProject(noTaper, [goodBrush])?.taper,
    hadTaper: taper !== undefined,
    damaged: [
      shapeInProject({ ...inFile, curve: undefined }, [goodBrush]),
      shapeInProject({ ...inFile, curve: { ...arch, points: arch.points.slice(1) } }, [goodBrush]),
      shapeInProject({ ...inFile, curve: { ...arch, points: [{ at: { x: 1 } }, arch.points[1]] } }, [goodBrush]),
      shapeInProject({ ...inFile, taper: { start: -1, end: 0, thins: 'size' } }, [goodBrush]),
      shapeInProject({ ...inFile, taper: { start: 0, end: 0, thins: 'color' } }, [goodBrush]),
    ],
  }
})
check(
  'corners join with straight lines, through each point',
  JSON.stringify(math.corners) === '[{"x":0,"y":0},{"x":100,"y":0},{"x":100,"y":100}]',
  JSON.stringify(math.corners),
)
check(
  'a closed curve comes back to its first point, not repeating it',
  math.closed.length === 3,
  JSON.stringify(math.closed),
)
check(
  'handles bend it: an arch from end to end, its top three quarters of the way to the handles',
  near(math.archEnds[0].x, 100) &&
    near(math.archEnds[1].x, 500) &&
    near(math.archMiddle.x, 300, 3) &&
    near(math.archMiddle.y, 250, 1) &&
    math.archCount > 100,
  `${JSON.stringify(math.archMiddle)} of ${math.archCount}`,
)
check(
  'a smooth point turns its other handle, as long as it was',
  near(math.turned.before.x, 0) && near(math.turned.before.y, -10) && math.turned.isSmooth,
  JSON.stringify(math.turned),
)
check(
  'and Alt lets it be, a corner',
  math.broken.before.x === -10 && math.broken.before.y === 0 && !math.broken.isSmooth,
  JSON.stringify(math.broken),
)
check('a curve in a file is a shape', math.good)
check(
  'with no taper in it, its ends are whole',
  math.hadTaper && math.oldTaper?.start === 0 && math.oldTaper?.end === 0,
  JSON.stringify(math.oldTaper),
)
check(
  'nonsense in a file is left out',
  math.damaged.every(shape => shape === null),
  JSON.stringify(math.damaged.map(shape => shape !== null)),
)

// ----- The tool -----
await press('c')
check(
  'C chooses Curves, in the tool column',
  await page.$eval('.tool-column button[aria-label=Curves]', b => b.ariaPressed === 'true'),
)
check(
  'its bar makes a shape, outlined, with no kind to choose',
  (await isPressed('Shape')) && (await page.$('.shape-kind')) === null && (await styleNow()).outline.isOn,
)
check('and nothing filled at first', !(await styleNow()).fill.isOn)
const layersAtFirst = (await snapshot()).layers.length
await put(100, 100)
check('a click starts a curve', (await snapshot()).isDrawingCurve)
check(
  'and the bar says how to end it',
  await page.$$eval('.toolbar .notice', notes => notes.some(n => n.textContent.includes('Click the first point'))),
)
await put(300, 100)
await press('Escape')
let snap = await snapshot()
check('Esc throws it away', !snap.isDrawingCurve && snap.layers.length === layersAtFirst)

// Three corners, ended with Enter
await put(100, 100)
await put(400, 100)
await put(400, 300)
const drawing = await page.$('.draw-space canvas')
const drafted = await drawing.screenshot({ path: OUT + '/curves-draft.png' })
check('the curve shows while it is drawn', drafted.length > 0)
await press('Enter')
await waitIdle()
snap = await snapshot()
check(
  'Enter ends it: a curve on a new layer, the active one',
  !snap.isDrawingCurve &&
    snap.layers.length === layersAtFirst + 1 &&
    snap.isCurveLayer &&
    snap.layers.at(-1).isCurve &&
    snap.layers.at(-1).isShape,
  JSON.stringify(snap.layers.map(l => [l.name, l.isCurve])),
)
let shape = await activeShape()
check('open, with its three points', !shape.curve.isClosed && shape.curve.points.length === 3)
let alphas = await alphasOf()
check(
  'painted along its lines with the brush',
  alphaAt(alphas, 250, 100) > 200 && alphaAt(alphas, 400, 200) > 200 && alphaAt(alphas, 250, 200) === 0,
  [alphaAt(alphas, 250, 100), alphaAt(alphas, 400, 200), alphaAt(alphas, 250, 200)].join(),
)
check('as wide as the brush', thickness(alphas, 250) >= 19 && thickness(alphas, 250) <= 21, `${thickness(alphas, 250)}`)
await click('Undo')
await waitIdle()
check('one step of undo takes it away', (await snapshot()).layers.length === layersAtFirst)
await click('Redo')
await waitIdle()
check('and redo brings it back', (await snapshot()).isCurveLayer)

// Backspace and Ctrl+Z take back the last point while drawing; a double click ends it
const layersNow = (await snapshot()).layers.length
await put(100, 500)
await put(300, 500)
await put(300, 700)
await press('Backspace')
await press('z', 'Control')
check('Backspace and Ctrl+Z take back points', (await snapshot()).layers.length === layersNow)
const end = await pageOf(500, 500)
await put(500, 500)
await page.mouse.click(end.x, end.y)
await waitIdle()
shape = await activeShape()
check(
  'and a double click ends it open',
  (await snapshot()).layers.length === layersNow + 1 &&
    JSON.stringify(shape.curve.points.map(p => rounded(p.at))) === '[{"x":100,"y":500},{"x":500,"y":500}]',
  JSON.stringify(shape.curve.points.map(p => p.at)),
)

// A smooth point, pulled out, and Alt on the last point turning its next handle alone
await pull([100, 300], [100, 200])
await pull([300, 300], [300, 400])
await pull([300, 300], [400, 300], 'Alt')
await press('Enter')
await waitIdle()
shape = await activeShape()
const [first, second] = shape.curve.points
check(
  'a drag puts a smooth point, its handles on both sides',
  first.isSmooth && near(first.after.x, 100, 0.6) && near(first.after.y, 200, 0.6) && near(first.before.y, 400, 0.6),
  JSON.stringify(first),
)
check(
  'Alt on the last point turns its next handle alone, a corner',
  !second.isSmooth && near(second.after.x, 400, 0.6) && near(second.before.y, 200, 0.6),
  JSON.stringify(second),
)
check('pulling on the last point puts no new one', shape.curve.points.length === 2, `${shape.curve.points.length}`)

// Closed on the first point, filled, and with thin ends when open
await style({ fill: { ...(await styleNow()).fill, isOn: true } })
await put(500, 100)
await put(700, 100)
await put(700, 300)
await put(500, 100)
await waitIdle()
shape = await activeShape()
alphas = await alphasOf()
check('clicking the first point closes it', shape.curve.isClosed && shape.curve.points.length === 3)
check('and its fill fills it', alphaAt(alphas, 650, 150) > 200, `${alphaAt(alphas, 650, 150)}`)
await style({ fill: { ...(await styleNow()).fill, isOn: false } })
await style({ taper: { start: 150, end: 150, thins: 'size' } })
await put(100, 650)
await put(700, 650)
await press('Enter')
await waitIdle()
alphas = await alphasOf()
check(
  'an open one thins out toward its ends',
  thickness(alphas, 400) >= 19 && thickness(alphas, 130) < 10 && thickness(alphas, 130) > 0,
  `${thickness(alphas, 400)} in the middle, ${thickness(alphas, 130)} near the start`,
)
await style({ taper: { start: 0, end: 0, thins: 'size' } })

// ----- Make: Selection -----
await click('Selection')
await sleep(100)
const layersBeforeSelecting = (await snapshot()).layers.length
check(
  'making a selection hides the look of the shapes',
  !(await page.$$eval('.toolbar button', bs => bs.some(b => b.textContent === 'Outline'))),
)
await put(150, 150)
await put(350, 150)
await put(250, 350)
await press('Enter')
await waitIdle()
snap = await snapshot()
check(
  'a curve ended with Make Selection selects inside it, with no new layer',
  snap.hasSelection &&
    snap.layers.length === layersBeforeSelecting &&
    (await selectedAt(250, 200)) === 255 &&
    (await selectedAt(450, 200)) === 0,
  `${await selectedAt(250, 200)} inside, ${await selectedAt(450, 200)} outside`,
)
check(
  'it replaces the selection at first',
  (await page.$eval('.curve-selects button[aria-pressed=true]', b => b.textContent)) === 'Replace',
)
const ring = async ([left, top, right, bottom]) => {
  await put(left, top)
  await put(right, top)
  await put(right, bottom)
  await put(left, bottom)
  await put(left, top)
  await waitIdle()
}
await chooseSelects('Add')
await ring([450, 150, 650, 300])
check(
  'Add adds another part',
  (await selectedAt(550, 200)) === 255 && (await selectedAt(250, 200)) === 255,
  `${await selectedAt(550, 200)} ${await selectedAt(250, 200)}`,
)
await chooseSelects('Take away')
await ring([200, 170, 300, 230])
check(
  'Take away takes a hole out of it',
  (await selectedAt(250, 200)) === 0 && (await selectedAt(330, 160)) === 255 && (await selectedAt(550, 200)) === 255,
  `${await selectedAt(250, 200)} ${await selectedAt(330, 160)} ${await selectedAt(550, 200)}`,
)
await chooseSelects('Replace')
await ring([450, 150, 650, 300])
check(
  'and Replace takes the place of all of it',
  (await selectedAt(550, 200)) === 255 && (await selectedAt(330, 160)) === 0,
)
check('none of it made a layer', (await snapshot()).layers.length === layersBeforeSelecting)
await page.evaluate(() => window.lydia.engine.deselect())
await click('Shape')
await sleep(100)

// ----- Edit shape -----
await page.evaluate(() => {
  const { engine, stack } = window.lydia
  const curve = stack.layers.findLast(layer => layer.shape?.curve?.points.length === 3 && !layer.shape.curve.isClosed)
  engine.selectLayer(curve.id)
})
await sleep(100)
check(
  'the shape tool does not edit a curve',
  await (async () => {
    await press('p')
    const disabled = await isDisabled('Edit shape')
    await press('c')
    return disabled
  })(),
)
check('the curves tool does', !(await isDisabled('Edit shape')))
await click('Edit shape')
await sleep(200)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/curves-edit.png' })
const layersBeforeEdit = (await snapshot()).layers.length
await pull([400, 300], [600, 400])
await waitIdle()
shape = await activeShape()
alphas = await alphasOf()
check(
  'dragging a point moves it, and the curve is painted again',
  JSON.stringify(rounded(shape.curve.points[2].at)) === '{"x":600,"y":400}' &&
    alphaAt(alphas, 500, 250) > 200 &&
    alphaAt(alphas, 400, 250) === 0 &&
    (await snapshot()).layers.length === layersBeforeEdit,
  JSON.stringify(shape.curve.points[2]),
)
await click('Undo')
await waitIdle()
shape = await activeShape()
check('one step of undo puts it back', JSON.stringify(rounded(shape.curve.points[2].at)) === '{"x":400,"y":300}')
check(
  'its layer shows the icon of a curve',
  (await page.evaluate(() => document.querySelectorAll('.smart-icon[aria-label="Curve"]').length)) >= 4,
)
await click('Edit shape')
await sleep(100)

// Choosing another tool ends a curve being drawn
const layersBeforeSwitch = (await snapshot()).layers.length
await put(100, 750)
await put(300, 750)
await press('b')
await waitIdle()
check('another tool ends a curve as it is', (await snapshot()).layers.length === layersBeforeSwitch + 1)

// ----- The file and the autosave -----
const saved = await page.evaluate(async () => {
  const blob = await window.lydia.engine.saveProject()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(s)
})
const bytes = Buffer.from(saved, 'base64')
fs.writeFileSync(OUT + '/curves.lyd', bytes)
const header = JSON.parse(bytes.subarray(12, 12 + bytes.readUInt32LE(8)).toString())
const curvesInFile = header.layers.filter(layer => layer.shape?.kind === 'curve')
check(
  'the file keeps the curves, their points and their taper',
  curvesInFile.length === layersBeforeSwitch + 1 - layersAtFirst &&
    curvesInFile.every(layer => layer.shape.curve.points.length >= 2 && layer.shape.taper),
  `${curvesInFile.length}`,
)
await page.evaluate(() => window.lydia.autosaveNow())
await sleep(300)
const recovered = await page.evaluate(async () => {
  const { listAutosaved, loadAutosaved } = await import('/src/autosave.ts')
  const [drawing] = await listAutosaved()
  const project = await loadAutosaved(drawing.id)
  return project.layers.filter(layer => layer.shape?.curve).length
})
check('and so does its autosave', recovered === curvesInFile.length, `${recovered}`)

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
