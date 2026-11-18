// The pen's tilt (decision 90): a brush can turn its tip toward where the pen leans, grow and flatten as it leans. The
// math of the dabs, the brush file, strokes and clicks of a pen leaning (sent as the browser gets them from a real
// pen), with the view turned, the brush's outline in the air, and the settings in the Brush Designer
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
await page.setViewport({ width: 1600, height: 900 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
const near = (a, b, by) => Math.abs(a - b) <= by
const click = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).click(), text)
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('lydia.language', 'en')
  indexedDB.deleteDatabase('lydia')
})
await page.reload({ waitUntil: 'networkidle0' })

// ----- The dabs -----
const math = await page.evaluate(async () => {
  const { createDabPath, leanOf, penBetween } = await import('/src/engine/dabs.ts')
  const { DEFAULT_SHAPE } = await import('/src/engine/brushFile.ts')
  const dabOf = (shape, pen) =>
    createDabPath({ ...DEFAULT_SHAPE, ...shape }, 40, { seed: 1 }).start({ x: 100, y: 100, ...pen })[0]
  const right = { x: 1, y: 0 }
  const down = { x: 0, y: 1 }
  return {
    plain: dabOf({}, { pressure: 1 }),
    plainLeaning: dabOf({}, { pressure: 1, tilt: down }),
    turned: dabOf({ tiltTurn: true }, { pressure: 1, tilt: down }),
    turnedUpright: dabOf({ tiltTurn: true, angle: 30 }, { pressure: 1 }),
    bigger: dabOf({ tiltSize: 1 }, { pressure: 1, tilt: right }),
    biggerHalf: dabOf({ tiltSize: 1 }, { pressure: 1, tilt: { x: 0.5, y: 0 } }),
    biggerPressed: dabOf({ tiltSize: 1, pressureSize: true }, { pressure: 0.5, tilt: right }),
    flatter: dabOf({ tiltFlatten: 0.8 }, { pressure: 1, tilt: right }),
    pixel: dabOf({ pixel: 'round', tiltTurn: true, tiltFlatten: 0.8, tiltSize: 1 }, { pressure: 1, tilt: down }),
    between: penBetween({ pressure: 0, tilt: { x: 1, y: 0 } }, { pressure: 1 }, 0.25),
    lean: leanOf({ pressure: 1, tilt: { x: 3, y: 4 } }),
  }
})
check(
  'a brush without tilt paints as before, leaning or not',
  math.plain.size === 40 &&
    math.plainLeaning.size === 40 &&
    math.plainLeaning.angle === math.plain.angle &&
    math.plainLeaning.roundness === undefined,
  JSON.stringify(math.plainLeaning),
)
check('Turn the tip: leaning down turns it a quarter turn', near(math.turned.angle, Math.PI / 2, 1e-9))
check('upright, it keeps its angle', near(math.turnedUpright.angle, Math.PI / 6, 1e-9))
check(
  'Bigger at 100%: twice as big lying down, half as much more at half the lean',
  math.bigger.size === 80 && math.biggerHalf.size === 60,
  `${math.bigger.size} ${math.biggerHalf.size}`,
)
check('the pressure still counts', math.biggerPressed.size === 40, `${math.biggerPressed.size}`)
check('Flatter at 80%: a fifth of its height lying down', near(math.flatter.roundness, 0.2, 1e-9))
check(
  "a pixel brush only grows: its tip doesn't turn nor flatten",
  math.pixel.size === 80 && math.pixel.angle === 0 && math.pixel.roundness === undefined,
  JSON.stringify(math.pixel),
)
check(
  'the pen between two points: its pressure and its tilt, toward none',
  near(math.between.pressure, 0.25, 1e-9) && near(math.between.tilt.x, 0.75, 1e-9) && math.between.tilt.y === 0,
)
check('a lean is never more than lying down', math.lean === 1)

// ----- The brush file -----
const file = await page.evaluate(async () => {
  const { parseBrushFile, serializeBrushFile } = await import('/src/engine/brushFile.ts')
  const library = await import('/src/brushLibrary.ts')
  const { preset } = library.builtInBrush('soft-round')
  const saved = serializeBrushFile({ ...preset, tiltTurn: true, tiltSize: 1.5, tiltFlatten: 0.4 })
  const back = parseBrushFile(saved, 'x')
  const data = JSON.parse(saved)
  delete data.tiltTurn
  delete data.tiltSize
  delete data.tiltFlatten
  const old = parseBrushFile(JSON.stringify(data), 'x')
  const tooMuch = parseBrushFile(JSON.stringify({ ...data, tiltSize: 50, tiltFlatten: 2 }), 'x')
  const pick = ({ tiltTurn, tiltSize, tiltFlatten }) => ({ tiltTurn, tiltSize, tiltFlatten })
  return { back: pick(back), old: pick(old), tooMuch: pick(tooMuch) }
})
check(
  'a brush file keeps its tilt',
  file.back.tiltTurn === true && file.back.tiltSize === 1.5 && file.back.tiltFlatten === 0.4,
  JSON.stringify(file.back),
)
check(
  'one from before has none',
  file.old.tiltTurn === false && file.old.tiltSize === 0 && file.old.tiltFlatten === 0,
  JSON.stringify(file.old),
)
check(
  'and a file asking too much gets the most there is',
  file.tooMuch.tiltSize === 2 && file.tooMuch.tiltFlatten === 0.9,
  JSON.stringify(file.tooMuch),
)

// ----- Painting with a pen that leans -----
await click('New project…')
await page.waitForSelector('dialog.new-project[open]')
const inputs = await page.$$('dialog input[type=number]')
for (const [i, value] of [
  [0, 1200],
  [1, 1000],
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
const useBrush = (shape, size) =>
  page.evaluate(
    async (shape, size) => {
      const library = await import('/src/brushLibrary.ts')
      const brush = library.builtInBrush('hard-round')
      const { engine } = window.lydia
      engine.setBrushTip(await library.tipOf(brush), { ...brush.preset, ...shape })
      engine.setBrush({ size, color: '#000000', tool: 'brush', opacity: 1 })
    },
    shape,
    size,
  )
// A pen event as the browser gets it from a real pen, with its tilt in degrees
const cdp = await page.createCDPSession()
const pen = async (type, x, y, { buttons = 0, tiltX = 0, tiltY = 0, shift = false } = {}) => {
  const p = await pageOf(x, y)
  await cdp.send('Input.dispatchMouseEvent', {
    type,
    x: p.x,
    y: p.y,
    button: type === 'mouseMoved' ? 'none' : 'left',
    buttons,
    clickCount: type === 'mouseMoved' ? 0 : 1,
    pointerType: 'pen',
    force: buttons ? 1 : 0,
    tiltX,
    tiltY,
    modifiers: shift ? 8 : 0,
  })
}
const penStroke = async (points, tilt) => {
  await pen('mouseMoved', ...points[0], tilt)
  await pen('mousePressed', ...points[0], { ...tilt, buttons: 1 })
  for (const point of points.slice(1)) await pen('mouseMoved', ...point, { ...tilt, buttons: 1 })
  await pen('mouseReleased', ...points.at(-1), tilt)
  await sleep(100)
}
const penClick = (x, y, tilt) => penStroke([[x, y]], tilt)
const along = (fromX, toX, y) => Array.from({ length: 16 }, (_, i) => [fromX + ((toX - fromX) * i) / 15, y])
// How many pixels are painted dark on a line of the paper, across or down from a point, "reach" pixels each way
const darkRun = (x, y, reach, isDown) =>
  page.evaluate(
    (x, y, reach, isDown) => {
      const { projection } = window.lydia
      let count = 0
      for (let d = -reach; d <= reach; d++) {
        const color = projection.colorAt(isDown ? x : x + d, isDown ? y + d : y)
        if (color && parseInt(color.slice(1, 3), 16) < 128) count++
      }
      return count
    },
    x,
    y,
    reach,
    isDown,
  )

await useBrush({ tiltSize: 1, pressureSize: false }, 40)
await penStroke(along(100, 400, 100), { tiltY: 60 })
let run = await darkRun(250, 100, 70, true)
check('Bigger: a stroke with the pen lying down is twice as thick', near(run, 80, 3), `${run}`)
await penStroke(along(100, 400, 230), {})
run = await darkRun(250, 230, 70, true)
check('with the pen upright, as thick as the brush', near(run, 40, 3), `${run}`)
await page.mouse.move(...Object.values(await pageOf(100, 340)))
await page.mouse.down()
for (const [x, y] of along(100, 400, 340)) await page.mouse.move(...Object.values(await pageOf(x, y)))
await page.mouse.up()
await sleep(100)
run = await darkRun(250, 340, 70, true)
check('and with the mouse too', near(run, 40, 3), `${run}`)
await penStroke(along(100, 400, 460), { tiltY: 30 })
run = await darkRun(250, 460, 70, true)
check('leaning halfway (30°), half as much more', near(run, 60, 3), `${run}`)
await penClick(700, 460, { tiltY: 60, shift: true })
run = await darkRun(600, 460, 70, true)
check('a straight line with Shift follows the tilt too', near(run, 80, 3), `${run}`)

await useBrush({ tiltTurn: true, tiltFlatten: 0.8, pressureSize: false }, 100)
await penClick(200, 850, { tiltX: 60 })
let across = await darkRun(200, 850, 70, false)
let down = await darkRun(200, 850, 70, true)
check(
  'Turn the tip and Flatter: leaning right, a long mark across',
  near(across, 100, 3) && near(down, 20, 3),
  `${across} × ${down}`,
)
await penClick(450, 850, { tiltY: 60 })
across = await darkRun(450, 850, 70, false)
down = await darkRun(450, 850, 70, true)
check('leaning down, a long mark down', near(across, 20, 3) && near(down, 100, 3), `${across} × ${down}`)

await page.evaluate(() => window.lydia.engine.turnView(90))
await sleep(200)
await penClick(900, 700, { tiltX: 60 })
across = await darkRun(900, 700, 70, false)
down = await darkRun(900, 700, 70, true)
check(
  'with the view turned a quarter, leaning right on the screen is down the paper',
  near(across, 20, 3) && near(down, 100, 3),
  `${across} × ${down}`,
)
await page.evaluate(() => window.lydia.engine.turnView(0))
await sleep(200)

// ----- The outline, with the pen in the air -----
const outline = async () => {
  await frames()
  return page.evaluate(() => {
    const g = window.lydia.app.stage.children.at(-1)
    const b = g.getLocalBounds()
    return { visible: g.visible, width: b.width, height: b.height }
  })
}
await pen('mouseMoved', 900, 300, { tiltX: 60 })
let shown = await outline()
check(
  'the outline turns and flattens as the pen leans in the air',
  shown.visible && shown.width > shown.height * 4,
  `${shown.width.toFixed(1)} × ${shown.height.toFixed(1)}`,
)
await pen('mouseMoved', 900, 310, { tiltY: 60 })
shown = await outline()
check(
  'leaning down, it turns down',
  shown.height > shown.width * 4,
  `${shown.width.toFixed(1)} × ${shown.height.toFixed(1)}`,
)
await page.mouse.move(...Object.values(await pageOf(900, 320)))
shown = await outline()
check(
  'with the mouse, round',
  near(shown.width, shown.height, 2),
  `${shown.width.toFixed(1)} × ${shown.height.toFixed(1)}`,
)
await pen('mouseMoved', 900, 300, { tiltX: 40, tiltY: 40 })
await frames()
await page.screenshot({ path: `${OUT}/pen-tilt.png` })
await useBrush({ tiltSize: 1, pressureSize: false }, 100)
await pen('mouseMoved', 900, 330, { tiltY: 60 })
const bigger = await outline()
await pen('mouseMoved', 900, 340, {})
const upright = await outline()
check(
  'and it grows as the pen leans',
  near(bigger.width / upright.width, 2, 0.1),
  `${bigger.width.toFixed(1)} / ${upright.width.toFixed(1)}`,
)

// ----- The Brush Designer -----
page.on('dialog', dialog => dialog.accept()) // leaving the drawing without saving it
await page.reload({ waitUntil: 'networkidle0' })
await page.click('.home-actions button:nth-child(3)')
await click('Open Brush Designer')
await page.waitForFunction(() => document.querySelector('.shape-controls'), { timeout: 60000 })
const controls = await page.$eval('.shape-controls', el => el.textContent)
await page.evaluate(() =>
  [...document.querySelectorAll('.shape-tabs button')].find(each => each.textContent === 'Pen tilt').click(),
)
await sleep(100)
const tiltShown = await page.$$eval('.shape-page:not([hidden]) label', labels => labels.map(each => each.textContent))
await page.screenshot({ path: `${OUT}/pen-tilt-designer.png` })
check('under its own tab', tiltShown.length === 3 && tiltShown[0].includes('Turn the tip'), tiltShown.join(' / '))
check(
  'the Brush Designer has the pen tilt settings',
  ['Pen tilt', 'Turn the tip', 'Bigger', 'Flatter'].every(each => controls.includes(each)),
)

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
