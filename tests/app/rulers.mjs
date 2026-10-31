// Rulers (decision 78): the ways along a line, an ellipse and a vanishing point; which of several the pen chooses; the bar,
// the K key, the handles and Delete; strokes of the brush, the eraser, smudge, blur and liquify staying on them, with the
// stabilizer, with the symmetry and with a pixel brush; Shift's line staying free; the saved drawing and its autosave
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
const buttonWith = text => [...document.querySelectorAll('button')].find(b => b.textContent === text)
const click = text => page.evaluate(`(${buttonWith})(${JSON.stringify(text)}).click()`)
const hasButton = text => page.evaluate(`!!(${buttonWith})(${JSON.stringify(text)})`)
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
// Through these points of the paper, with the button down, in "steps" moves for each stretch
const stroke = async (points, steps = 12) => {
  const [first, ...others] = points
  const a = await pageOf(...first)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  for (const point of others) {
    const b = await pageOf(...point)
    await page.mouse.move(b.x, b.y, { steps })
  }
  await page.mouse.up()
  await sleep(250)
}
const brushAs = settings => page.evaluate(settings => window.lydia.engine.setBrush(settings), settings)
const rulers = () => page.evaluate(() => window.lydia.engine.getSnapshot().rulers)
const snapshot = () =>
  page.evaluate(() => {
    const { rulers, isEditingRulers, chosenRuler, isMovingSymmetry } = window.lydia.engine.getSnapshot()
    return { rulers, isEditingRulers, chosenRuler, isMovingSymmetry }
  })
const engineDoes = async (name, ...args) => {
  await page.evaluate((name, args) => window.lydia.engine[name](...args), name, args)
  await sleep(100)
}
// Take every ruler off, turned on or off as asked
const noRulers = async () => {
  for (let left = (await rulers()).list.length; left > 0; left--) {
    await page.evaluate(() => {
      const { engine } = window.lydia
      engine.setEditingRulers(true)
    })
    const { list } = await rulers()
    const last = list.at(-1)
    const handle = last.from ?? last.center ?? last.at
    const at = await pageOf(handle.x, handle.y)
    await page.mouse.click(at.x, at.y)
    await sleep(100)
    await press('Delete')
  }
  await engineDoes('setEditingRulers', false)
  await engineDoes('setRulersOn', false)
}
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
const forEachPainted = (list, each) => {
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      if (list[y * SIDE + x] > 0) each(x + 0.5, y + 0.5)
    }
  }
}
const painted = list => list.filter(a => a > 0).length
// How far the painted pixels go from the middle, up or down, and across
const bounds = list => {
  const box = { left: SIDE, right: 0, top: SIDE, bottom: 0 }
  forEachPainted(list, (x, y) => {
    box.left = Math.min(box.left, x)
    box.right = Math.max(box.right, x)
    box.top = Math.min(box.top, y)
    box.bottom = Math.max(box.bottom, y)
  })
  return box
}
// The farthest painted pixel from the line through "a" and "b"
const farthestFrom = (list, a, b) => {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  let far = 0
  forEachPainted(list, (x, y) => {
    far = Math.max(far, Math.abs((x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x)) / length)
  })
  return far
}
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

// ----- The ways along a ruler -----
const math = await page.evaluate(async () => {
  const { createHold, isRulers, newRuler } = await import('/src/engine/rulers.ts')
  const at = (x, y, pressure = 1) => ({ x, y, pressure })
  const line = { kind: 'line', from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }
  const slanted = { kind: 'line', from: { x: 0, y: 0 }, to: { x: 100, y: 100 } }
  const point = { kind: 'point', at: { x: 100, y: 100 } }
  const ellipse = { kind: 'ellipse', center: { x: 400, y: 400 }, end: { x: 470, y: 470 }, side: 40 }

  const level = createHold([line], at(50, 200), 10).along([at(60, 230, 0.4), at(90, 170, 0.8)])
  const parallel = createHold([slanted], at(100, 300), 10).along([at(300, 300)])
  const toPoint = createHold([point], at(300, 300), 10).along([at(500, 520)])

  // On the ellipse's own axes, how far along it a point is: the same along all of a stroke
  const across = Math.hypot(70, 70)
  const sizeOf = ({ x, y }) => {
    const dx = x - 400
    const dy = y - 400
    const a = (dx + dy) * Math.SQRT1_2
    const b = (dy - dx) * Math.SQRT1_2
    return Math.hypot(a / across, b / 40)
  }
  const start = at(550, 300)
  const round = createHold([ellipse], start, 10).along([at(600, 600), at(250, 500, 0.2)])
  const sizes = round.map(sizeOf)
  const gaps = round.slice(1).map((p, i) => Math.hypot(p.x - round[i].x, p.y - round[i].y))
  const onItself = createHold([ellipse], at(470, 470), 10).along([at(330, 330)])

  // Several rulers: the first few pixels wait, then the pen's direction chooses
  const two = [
    { kind: 'point', at: { x: -200, y: 400 } },
    { kind: 'point', at: { x: 1000, y: 400 } },
  ]
  const onward = createHold(two, at(400, 100), 10)
  const waited = onward.along([at(404, 102)]).length
  const chosenRight = onward.along([at(412, 106), at(600, 110)])
  const chosenLeft = createHold(two, at(400, 100), 10).along([at(412, 94), at(800, 0)])
  const mixed = [line, { kind: 'line', from: { x: 0, y: 0 }, to: { x: 0, y: 100 } }]
  const upright = createHold(mixed, at(50, 50), 10).along([at(51, 62), at(90, 120)])
  const short = createHold(two, at(400, 100), 10)
  const shortWaited = short.along([at(404, 102)]).length
  const shortEnd = short.finish()
  const stillPen = createHold(two, at(400, 100), 10).finish()

  const onPoint = createHold([point], at(100, 100), 10)
  const onPointWaited = onPoint.along([at(104, 100)]).length
  const onPointLine = onPoint.along([at(120, 100), at(150, 180)])
  const free = createHold([ellipse], at(400, 400), 10).along([at(415, 400)])
  const flat = { kind: 'line', from: { x: 5, y: 5 }, to: { x: 5, y: 5 } }

  return {
    level,
    parallel,
    toPoint,
    sizes,
    biggestGap: Math.max(...gaps),
    lastPressure: round.at(-1).pressure,
    onItself: onItself.at(-1),
    waited,
    chosenRight,
    chosenLeft,
    upright,
    shortWaited,
    shortEnd,
    stillPen,
    onPointWaited,
    onPointLine,
    free,
    noLength: createHold([flat], at(9, 9), 10).along([at(14, 30)]),
    damaged: [
      isRulers(null),
      isRulers({ isOn: true }),
      isRulers({ isOn: 'yes', list: [] }),
      isRulers({ isOn: true, list: [{ kind: 'spiral' }] }),
      isRulers({ isOn: true, list: [{ kind: 'point', at: { x: 'a', y: 1 } }] }),
      isRulers({ isOn: true, list: [{ ...ellipse, side: 0 }] }),
    ],
    good: ['line', 'ellipse', 'point'].map(kind =>
      isRulers({ isOn: true, list: [newRuler(kind, { x: 10, y: 10 }, 100)] }),
    ),
  }
})
const near = (a, b, by = 1e-6) => Math.abs(a - b) <= by
check(
  'a line ruler: the stroke goes parallel to it, from where it started, keeping the pressure',
  math.level.every(p => p.y === 200) &&
    math.level[0].x === 60 &&
    math.level[1].x === 90 &&
    math.level[0].pressure === 0.4,
  JSON.stringify(math.level),
)
check('at any angle', near(math.parallel[0].x, 200) && near(math.parallel[0].y, 400), JSON.stringify(math.parallel))
check(
  'a vanishing point: the stroke stays on the line through it',
  near(math.toPoint[0].x, math.toPoint[0].y),
  JSON.stringify(math.toPoint),
)
const spread = Math.max(...math.sizes) - Math.min(...math.sizes)
check('an ellipse: the stroke stays on one the same shape, turned too', spread < 1e-9, `off by ${spread}`)
check('with no straight pieces when the pen jumps', math.biggestGap < 6, `gap ${math.biggestGap}`)
check('and the pressure goes along', near(math.lastPressure, 0.2), `${math.lastPressure}`)
check(
  'a point on the ellipse is its own closest point',
  near(math.onItself.x, 330, 1e-4) && near(math.onItself.y, 330, 1e-4),
  JSON.stringify(math.onItself),
)
check('with several, the first pixels wait', math.waited === 0)
const onLineThrough = (list, vanish, start) =>
  list.every(
    p =>
      Math.abs((p.x - start.x) * (vanish.y - start.y) - (p.y - start.y) * (vanish.x - start.x)) <
      1e-6 * Math.hypot(vanish.x - start.x, vanish.y - start.y) * 1000,
  )
check(
  'then the pen going toward one takes that one, with what waited',
  math.chosenRight.length === 3 && onLineThrough(math.chosenRight, { x: 1000, y: 400 }, { x: 400, y: 100 }),
  JSON.stringify(math.chosenRight),
)
check(
  'and going the other way, the other one',
  onLineThrough(math.chosenLeft, { x: -200, y: 400 }, { x: 400, y: 100 }),
  JSON.stringify(math.chosenLeft),
)
check(
  'it goes by the direction: an upright line for a stroke going up or down',
  math.upright.every(p => p.x === 50),
  JSON.stringify(math.upright),
)
check(
  'a stroke too short to choose still goes where it went',
  math.shortWaited === 0 && math.shortEnd.length === 1,
  JSON.stringify(math.shortEnd),
)
check('and a click goes nowhere', math.stillPen.length === 0)
check(
  'starting on the vanishing point itself, the pen gives the line',
  math.onPointWaited === 0 && math.onPointLine.every(p => near(p.y, 100)),
  JSON.stringify(math.onPointLine),
)
check(
  'starting in the middle of an ellipse, it is free: no ellipse goes through there',
  near(math.free[0].x, 415),
  JSON.stringify(math.free),
)
check('a ruler with no length leaves the stroke free', math.noLength[0].y === 30, JSON.stringify(math.noLength))
check(
  'nonsense in a file is left out',
  math.damaged.every(ok => !ok),
)
check(
  'new rulers are good ones',
  math.good.every(ok => ok),
)

// ----- The bar and the keys -----
check('off at first', !(await snapshot()).rulers.isOn && !(await hasButton('Line')))
await press('k')
check('K turns them on', (await snapshot()).rulers.isOn && (await hasButton('Line')))
await press('k')
check('and off', !(await snapshot()).rulers.isOn)
await click('Rulers')
await sleep(100)
check('so does the button', (await snapshot()).rulers.isOn)
check('with nothing to edit yet', await page.evaluate(`(${buttonWith})('Edit rulers').disabled`))
await click('Line')
await sleep(150)
let state = await snapshot()
check(
  'a new ruler is added and ready to place',
  state.rulers.list.length === 1 && state.isEditingRulers && state.chosenRuler === 0,
  JSON.stringify(state),
)
const middleLine = state.rulers.list[0]
const middleY = (middleLine.from.y + middleLine.to.y) / 2
check('in the middle of the screen', near(middleY, 400, 2), `${middleY}`)
check('Remove ruler shows while editing', await hasButton('Remove ruler'))

// The handles
await stroke([
  [middleLine.to.x, middleLine.to.y],
  [600, 150],
])
state = await snapshot()
let ruler = state.rulers.list[0]
check(
  'a handle moves one end',
  near(ruler.to.x, 600, 1) && near(ruler.to.y, 150, 1) && near(ruler.from.x, middleLine.from.x),
  JSON.stringify(ruler),
)
check('editing paints nothing', painted(await alphas()) === 0)
const lineMiddle = { x: (ruler.from.x + ruler.to.x) / 2, y: (ruler.from.y + ruler.to.y) / 2 }
await stroke([
  [lineMiddle.x, lineMiddle.y],
  [lineMiddle.x + 50, lineMiddle.y + 70],
])
const movedRuler = (await snapshot()).rulers.list[0]
check(
  'its line moves all of it',
  near(movedRuler.to.x - ruler.to.x, 50, 1) &&
    near(movedRuler.to.y - ruler.to.y, 70, 1) &&
    near(movedRuler.from.y - ruler.from.y, 70, 1),
  JSON.stringify(movedRuler),
)
await stroke([
  [50, 750],
  [52, 750],
])
check('a click off it chooses none', (await snapshot()).chosenRuler === null)
await stroke([
  [movedRuler.to.x, movedRuler.to.y],
  [movedRuler.to.x, movedRuler.to.y],
])
check('a click on it chooses it', (await snapshot()).chosenRuler === 0)
await click('Remove ruler')
await sleep(100)
state = await snapshot()
check('Remove ruler removes it', state.rulers.list.length === 0)
check('and with none left, it goes back to the tool', !state.isEditingRulers)

await click('Ellipse')
await sleep(150)
state = await snapshot()
const startEllipse = state.rulers.list[0]
const sideHandle = { x: startEllipse.center.x, y: startEllipse.center.y + startEllipse.side }
await stroke([
  [sideHandle.x, sideHandle.y],
  [sideHandle.x + 30, sideHandle.y + 40],
])
let ellipse = (await snapshot()).rulers.list[0]
check(
  "an ellipse's side handle changes only its width",
  near(ellipse.side, startEllipse.side + 40, 1) &&
    near(ellipse.end.x, startEllipse.end.x) &&
    near(ellipse.center.x, startEllipse.center.x),
  JSON.stringify(ellipse),
)
await stroke([
  [ellipse.end.x, ellipse.end.y],
  [ellipse.center.x + 150, ellipse.center.y + 150],
])
ellipse = (await snapshot()).rulers.list[0]
check(
  'its end handle turns it',
  near(Math.atan2(ellipse.end.y - ellipse.center.y, ellipse.end.x - ellipse.center.x), Math.PI / 4, 0.02),
  JSON.stringify(ellipse),
)
const beforeCenter = ellipse
await stroke([
  [ellipse.center.x, ellipse.center.y],
  [ellipse.center.x - 10, ellipse.center.y - 20],
])
ellipse = (await snapshot()).rulers.list[0]
check(
  'its center handle moves all of it',
  near(ellipse.end.x - beforeCenter.end.x, -10, 1) && near(ellipse.end.y - beforeCenter.end.y, -20, 1),
  JSON.stringify(ellipse),
)

await engineDoes('selectAll')
await brushAs({ size: 30, color: '#000000', tool: 'brush', opacity: 1 })
await engineDoes('setEditingRulers', false)
await stroke([
  [ellipse.center.x + 200, ellipse.center.y - 200],
  [ellipse.center.x + 260, ellipse.center.y - 150],
])
const beforeDelete = painted(await alphas())
await engineDoes('setEditingRulers', true)
await stroke([
  [ellipse.center.x, ellipse.center.y],
  [ellipse.center.x, ellipse.center.y],
])
await press('Delete')
await sleep(300)
check(
  'Delete removes the chosen ruler, and leaves the paint alone',
  (await snapshot()).rulers.list.length === 0 && painted(await alphas()) === beforeDelete && beforeDelete > 0,
  `${beforeDelete}`,
)
await engineDoes('deselect')
await clean()

await page.evaluate(() => {
  const { engine } = window.lydia
  engine.setSymmetry({ mode: 'vertical' })
  engine.setMovingSymmetry(true)
  engine.addRuler('point')
})
await sleep(100)
state = await snapshot()
check('adding one stops moving the center of the symmetry', state.isEditingRulers && !state.isMovingSymmetry)
await engineDoes('setMovingSymmetry', true)
state = await snapshot()
check('and moving the center stops editing them', !state.isEditingRulers && state.isMovingSymmetry)
await engineDoes('setMovingSymmetry', false)
await page.evaluate(() => window.lydia.engine.setSymmetry({ mode: 'off' }))
await noRulers()

// ----- Strokes on them -----
await brushAs({ size: 20, color: '#000000', tool: 'brush', opacity: 1 })
await engineDoes('addRuler', 'line')
await engineDoes('setEditingRulers', false)
const wandering = [
  [100, 150],
  [300, 240],
  [500, 90],
  [700, 300],
]
await stroke(wandering)
let list = await alphas()
let box = bounds(list)
check(
  'a stroke stays level, wherever the pen goes',
  box.top >= 138 && box.bottom <= 162 && box.left < 95 && box.right > 705,
  JSON.stringify(box),
)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/rulers-line.png' })
await click('Undo')
await sleep(300)
check('one step of undo', painted(await alphas()) === 0)

await press('k')
await stroke(wandering)
box = bounds(await alphas())
check('with them off, it goes with the pen, and they stay', box.bottom > 280, JSON.stringify(box))
check('they stay', (await rulers()).list.length === 1)
await click('Undo')
await sleep(300)
await press('k')

// Shift's line is a line of its own
await stroke([
  [200, 200],
  [210, 200],
])
const a = await pageOf(600, 500)
await page.keyboard.down('Shift')
await page.mouse.move(a.x, a.y)
await page.mouse.down()
await page.mouse.up()
await page.keyboard.up('Shift')
await sleep(300)
box = bounds(await alphas())
check("Shift's straight line doesn't follow them", box.bottom > 490, JSON.stringify(box))
await click('Undo')
await sleep(200)
await click('Undo')
await sleep(300)

// With the stabilizer the stroke is still exactly on it
await page.evaluate(() => window.lydia.engine.setStabilizer({ mode: 'smooth', strength: 60 }))
await stroke(wandering)
box = bounds(await alphas())
check('with the stabilizer too', box.top >= 138 && box.bottom <= 162 && box.right > 500, JSON.stringify(box))
await click('Undo')
await sleep(300)
await page.evaluate(() => window.lydia.engine.setStabilizer({ mode: 'string', strength: 60 }))
await stroke(wandering)
box = bounds(await alphas())
check('and on its string', box.top >= 138 && box.bottom <= 162 && box.right > 400, JSON.stringify(box))
await click('Undo')
await sleep(300)
await page.evaluate(() => window.lydia.engine.setStabilizer({ mode: 'smooth', strength: 0 }))

// With the symmetry each side stays on it
await page.evaluate(() => window.lydia.engine.setSymmetry({ mode: 'vertical' }))
await stroke([
  [100, 150],
  [300, 260],
])
box = bounds(await alphas())
check(
  'the copies of the symmetry follow',
  box.top >= 138 && box.bottom <= 162 && box.left < 95 && box.right > 705,
  JSON.stringify(box),
)
await click('Undo')
await sleep(300)
await page.evaluate(() => window.lydia.engine.setSymmetry({ mode: 'off' }))

// A pixel brush stays on one row
await chooseBrush('Pixel')
await brushAs({ size: 1, color: '#000000', tool: 'brush', opacity: 1 })
await stroke([
  [100, 300],
  [300, 380],
  [500, 200],
])
list = await alphas()
const rowsPainted = new Set()
forEachPainted(list, (_, y) => rowsPainted.add(y))
check('a pixel brush paints one row of pixels', rowsPainted.size === 1, [...rowsPainted].join())
await click('Undo')
await sleep(300)
await chooseBrush('Hard round')
await brushAs({ size: 20, color: '#000000', tool: 'brush', opacity: 1 })
await noRulers()

// An ellipse
await engineDoes('addRuler', 'ellipse')
const placedEllipse = (await rulers()).list[0]
await stroke([
  [placedEllipse.end.x, placedEllipse.end.y],
  [placedEllipse.center.x + 110, placedEllipse.center.y - 110],
])
await stroke([
  [placedEllipse.center.x, placedEllipse.center.y + placedEllipse.side],
  [placedEllipse.center.x, placedEllipse.center.y + 60],
])
await engineDoes('setEditingRulers', false)
const round = (await rulers()).list[0]
const across = Math.hypot(round.end.x - round.center.x, round.end.y - round.center.y)
const cos = (round.end.x - round.center.x) / across
const sin = (round.end.y - round.center.y) / across
const sizeOf = (x, y) => {
  const dx = x - round.center.x
  const dy = y - round.center.y
  return Math.hypot((dx * cos + dy * sin) / across, (dy * cos - dx * sin) / round.side)
}
const paperAtTurn = (turn, size) => {
  const u = across * size * Math.cos(turn)
  const v = round.side * size * Math.sin(turn)
  return [round.center.x + u * cos - v * sin, round.center.y + u * sin + v * cos]
}
// The pen goes around rather roughly, in big jumps, a bit too far out or in
const JUMPS = 12
const loop = [paperAtTurn(0, 1.5)]
for (let jump = 1; jump <= JUMPS; jump++) {
  loop.push(paperAtTurn((jump * 2 * Math.PI) / JUMPS, 1.5 + (jump % 2 ? 0.2 : -0.2)))
}
await stroke(loop, 1)
list = await alphas()
let farthest = 0
forEachPainted(list, (x, y) => {
  farthest = Math.max(farthest, Math.abs(sizeOf(x, y) - 1.5) * Math.min(across, round.side))
})
check('a stroke stays on the ellipse through where it started', painted(list) > 0 && farthest <= 12, `${farthest}`)
let holes = 0
for (let turn = 0; turn < 360; turn += 2) {
  const [x, y] = paperAtTurn((turn * Math.PI) / 180, 1.5)
  if (list[Math.floor(y) * SIDE + Math.floor(x)] === 0) holes++
}
check('all the way around, in one smooth line', holes === 0, `${holes} holes`)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/rulers-ellipse.png' })
await click('Undo')
await sleep(300)

await stroke([paperAtTurn(0.5, 0.6), paperAtTurn(1.5, 0.8), paperAtTurn(2.5, 0.5)])
list = await alphas()
farthest = 0
forEachPainted(list, (x, y) => {
  farthest = Math.max(farthest, Math.abs(sizeOf(x, y) - 0.6) * Math.min(across, round.side))
})
check('inside it, one the same shape', painted(list) > 0 && farthest <= 12, `${farthest}`)
await click('Undo')
await sleep(300)
await noRulers()

// Two vanishing points
await engineDoes('addRuler', 'point')
const firstPoint = (await rulers()).list[0].at
await stroke([
  [firstPoint.x, firstPoint.y],
  [100, 100],
])
await engineDoes('addRuler', 'point')
const secondPoint = (await rulers()).list[1].at
await stroke([
  [secondPoint.x, secondPoint.y],
  [700, 100],
])
await engineDoes('setEditingRulers', false)
const [left, right] = (await rulers()).list.map(r => r.at)
check('two vanishing points in place', near(left.x, 100, 1) && near(right.x, 700, 1), JSON.stringify([left, right]))
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/rulers-points.png' })
const start = { x: 400, y: 600 }
await stroke([
  [start.x, start.y],
  [320, 500],
  [230, 370],
])
const towardLeft = farthestFrom(await alphas(), left, start)
await click('Undo')
await sleep(300)
await stroke([
  [start.x, start.y],
  [480, 500],
  [570, 370],
])
const towardRight = farthestFrom(await alphas(), right, start)
await click('Undo')
await sleep(300)
// As wide as the brush paints a straight line of the same slant, with no ruler
await press('k')
const lineEnd = { x: start.x + (left.x - start.x) * 0.6, y: start.y + (left.y - start.y) * 0.6 }
await stroke([
  [start.x, start.y],
  [start.x, start.y],
])
const endOnPage = await pageOf(lineEnd.x, lineEnd.y)
await page.keyboard.down('Shift')
await page.mouse.move(endOnPage.x, endOnPage.y)
await page.mouse.down()
await page.mouse.up()
await page.keyboard.up('Shift')
await sleep(300)
const brushWidth = farthestFrom(await alphas(), left, start)
await click('Undo')
await sleep(200)
await click('Undo')
await sleep(300)
await press('k')
check(
  'a stroke toward one goes to it, as wide as a free line',
  towardLeft <= brushWidth + 0.5,
  `${towardLeft} and ${brushWidth}`,
)
check('and toward the other, to the other', towardRight <= brushWidth + 0.5, `${towardRight} and ${brushWidth}`)
await noRulers()

// ----- The eraser, smudge, blur and liquify -----
// Black bars up and down the paper, which any of these tools changes where it goes, then a tool going wherever along a
// level ruler: nothing changes far from the ruler
const bars = async () => {
  await chooseBrush('Hard round')
  await brushAs({ size: 40, opacity: 1, color: '#000000', tool: 'brush' })
  for (let x = 100; x <= 700; x += 100) {
    await stroke(
      [
        [x, 60],
        [x, 740],
      ],
      4,
    )
  }
}
const changedRows = (before, after) => {
  let top = SIDE
  let bottom = 0
  let count = 0
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      if (Math.abs(before[y * SIDE + x] - after[y * SIDE + x]) > 4) {
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
        count++
      }
    }
  }
  return { top, bottom, count }
}
await engineDoes('addRuler', 'line')
await engineDoes('setEditingRulers', false)
await engineDoes('setRulersOn', false)
const placedY = (await rulers()).list[0].from.y
check('a level ruler for the tools', near(placedY, 400, 2), `${placedY}`)
// How far each reaches from the ruler: half its size, and liquify's own starts at 100
for (const [name, key, reach] of [
  ['the eraser', 'e', 20],
  ['smudge', 'u', 20],
  ['blur', 'j', 20],
  ['liquify', 'q', 50],
]) {
  await bars()
  await engineDoes('setRulersOn', true)
  await press(key)
  await sleep(100)
  const wander = [
    [100, 260],
    [300, 340],
    [500, 160],
    [700, 300],
  ]
  const before = await alphas()
  await stroke(wander)
  const rows = changedRows(before, await alphas())
  check(
    `${name} stays on it, with the pen far off`,
    rows.count > 200 && rows.top >= 260 - reach - 1 && rows.bottom <= 260 + reach,
    JSON.stringify(rows),
  )
  await click('Undo')
  await sleep(300)
  await engineDoes('setRulersOn', false)
  await stroke(wander)
  const free = changedRows(before, await alphas())
  check(`and goes with the pen with them off`, free.top < 180 && free.bottom > 320, JSON.stringify(free))
  await sleep(200)
  await press('b')
  await engineDoes('setRulersOn', false)
  await clean()
}
await engineDoes('setRulersOn', true)
await noRulers()

// ----- The saved drawing, and its autosave -----
await engineDoes('addRuler', 'ellipse')
await engineDoes('addRuler', 'point')
await engineDoes('setEditingRulers', false)
const expected = JSON.stringify(await rulers())
const inFile = () =>
  page.evaluate(async () => {
    const { parseProject } = await import('/src/engine/projectFile.ts')
    const file = await window.lydia.engine.saveProject()
    return parseProject(await file.arrayBuffer()).rulers ?? null
  })
const kept = await inFile()
check('the file keeps them', JSON.stringify(kept) === expected, JSON.stringify(kept))
await page.evaluate(() => window.lydia.autosaveNow())
await sleep(200)
const recovered = await page.evaluate(async () => {
  const { listAutosaved, loadAutosaved } = await import('/src/autosave.ts')
  const [drawing] = await listAutosaved()
  return drawing ? (await loadAutosaved(drawing.id)).rulers : 'no copy'
})
check('and so does its autosave', JSON.stringify(recovered) === expected, JSON.stringify(recovered))
await noRulers()
check('with none, the file has none', (await inFile()) === null)

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
