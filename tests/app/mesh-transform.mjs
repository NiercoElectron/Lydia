// The mesh of a transform (decision 72): the surface through its points; Free and Mesh, and the number of points; a
// point dragged bends the object in a smooth curve; bent and turned together; cancelled; undone, also step by step
// inside a transform; the mesh still there
// when the transform is opened again and in a saved drawing; an unbent mesh leaving nothing behind (screenshots to look
// at)
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
await page.setViewport({ width: 1500, height: 1000 })
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
const snapshot = () => page.evaluate(() => window.lydia.engine.getSnapshot())
const waitIdle = () =>
  page.waitForFunction(
    () => {
      const snap = window.lydia.engine.getSnapshot()
      return !snap.task && !snap.transform && !snap.isUpdating
    },
    { timeout: 60000, polling: 20 },
  )
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
const drag = async (from, to) => {
  const a = await pageOf(...from)
  const b = await pageOf(...to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 10 })
  await page.mouse.up()
  await sleep(200)
}
// What the active layer has at a row: where its paint starts and ends
const paintAt = y =>
  page.evaluate(y => {
    const { app, gpu, stack } = window.lydia
    const row = Math.floor(y / 256)
    let first = -1
    let last = -1
    for (let column = 0; column < 16; column++) {
      const texture = gpu.getTexture(stack.active, column, row, false)
      if (!texture) continue
      const { pixels } = app.renderer.extract.pixels(texture)
      for (let x = 0; x < 256; x++) {
        if (pixels[((y % 256) * 256 + x) * 4 + 3] < 128) continue
        if (first < 0) first = column * 256 + x
        last = column * 256 + x
      }
    }
    return { first, last }
  }, y)
const startTransform = async () => {
  await page.keyboard.press('v')
  await sleep(100)
  await click('Transform')
  await page.waitForFunction(() => window.lydia.engine.getSnapshot().transform !== null, { timeout: 60000 })
  await sleep(200)
}
const apply = async () => {
  await page.keyboard.press('Enter')
  await waitIdle()
  await sleep(300)
}
const smart = () =>
  page.evaluate(() => {
    const { warp, corners } = window.lydia.stack.active.smart ?? {}
    return { warp, corners }
  })

await page.goto('http://localhost:5198/', { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('lydia')
})
await page.reload({ waitUntil: 'networkidle0' })

// ----- The surface -----
const maths = await page.evaluate(async () => {
  const { flatWarp, isFlatWarp, resizedWarp, warpPoint } = await import('/src/engine/warp.ts')
  const flat = flatWarp(4)
  const bent = flatWarp(4)
  bent.points[5] = { x: 0.5, y: 0.2 }
  const passes = bent.points.every((point, i) => {
    const at = warpPoint(bent, (i % 4) / 3, Math.floor(i / 4) / 3)
    return Math.hypot(at.x - point.x, at.y - point.y) < 1e-9
  })
  const flatAt = warpPoint(flat, 0.37, 0.81)
  const outside = warpPoint(flat, -0.1, 0.5)
  const resized = resizedWarp(bent, 6)
  const sameShape = [0.2, 0.5, 0.75].every(u => {
    const a = warpPoint(bent, u, u)
    const b = warpPoint(resized, u, u)
    return Math.hypot(a.x - b.x, a.y - b.y) < 0.03
  })
  return {
    passes,
    flatStays: Math.hypot(flatAt.x - 0.37, flatAt.y - 0.81) < 1e-9,
    outside: Math.abs(outside.x + 0.1) < 1e-9 && Math.abs(outside.y - 0.5) < 1e-9,
    sameShape,
    flatIsFlat: isFlatWarp(flat) && !isFlatWarp(bent),
    resizedFlat: isFlatWarp(resizedWarp(flat, 5)),
  }
})
check('the surface goes through every point', maths.passes)
check('an unbent mesh moves nothing', maths.flatStays && maths.flatIsFlat)
check('just outside the square, points move with its edge', maths.outside)
check('more points keep the same shape', maths.sameShape && maths.resizedFlat)

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
await sleep(800)
await page.evaluate(() =>
  [...document.querySelectorAll('button.brush')]
    .find(b => b.querySelector('.brush-name').textContent === 'Hard round')
    .click(),
)
await sleep(300)
// A tall bar: from x = 400 to 700, y = 200 to 800
await page.evaluate(() => {
  const { brush, engine } = window.lydia
  engine.setBrush({ size: 40, color: '#2060c0', tool: 'brush', opacity: 1 })
  for (let x = 420; x <= 680; x += 26) {
    brush.startStroke(x, 220, 1)
    brush.continueStroke([{ x, y: 780, pressure: 1 }])
    brush.endStroke()
  }
})
await sleep(300)
const barBefore = await paintAt(500)

// ----- The modes -----
await startTransform()
check('it starts in Free', (await snapshot()).transform.mode === 'free')
check('with no list of points', !(await page.$('.toolbar select')))
await click('Mesh')
await sleep(200)
let state = (await snapshot()).transform
check('Mesh shows 4×4 points', state.mode === 'mesh' && state.warpSide === 4, JSON.stringify(state))
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/mesh-flat.png' })

// The object's square is the bar, from (400, 200) to (700, 800): the points are at thirds of it
const pointAt = (column, row) => [400 + column * 100, 200 + row * 200]

// A point of the middle pulled right, on the right edge
await drag(pointAt(3, 1), [pointAt(3, 1)[0] + 180, pointAt(3, 1)[1]])
await drag(pointAt(3, 2), [pointAt(3, 2)[0] + 180, pointAt(3, 2)[1]])
await sleep(300)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/mesh-bent.png' })

// Cancelling leaves everything as it was
await page.keyboard.press('Escape')
await sleep(400)
const afterCancel = await paintAt(500)
check('Esc leaves it as it was', afterCancel.last === barBefore.last, JSON.stringify(afterCancel))

// ----- Bending -----
await startTransform()
await click('Mesh')
await sleep(200)
await drag(pointAt(3, 1), [pointAt(3, 1)[0] + 180, pointAt(3, 1)[1]])
await drag(pointAt(3, 2), [pointAt(3, 2)[0] + 180, pointAt(3, 2)[1]])
await apply()
const bentMiddle = await paintAt(500)
const nearTop = await paintAt(215)
check(
  'the right side goes out where the points were dragged',
  bentMiddle.last > barBefore.last + 150,
  `${barBefore.last} → ${bentMiddle.last}`,
)
check('the left side stays', Math.abs(bentMiddle.first - barBefore.first) <= 3, `${bentMiddle.first}`)
check('its corner stays', nearTop.last < barBefore.last + 40, `${nearTop.last}`)
// The edge along the height: a curve with no corners, its steps changing little from one row to the next
const edge = []
for (let y = 210; y <= 790; y += 20) edge.push((await paintAt(y)).last)
const steps = edge.slice(1).map((x, i) => x - edge[i])
const bends = steps.slice(1).map((step, i) => Math.abs(step - steps[i]))
check('the edge is a smooth curve', Math.max(...bends) <= 12, `biggest change of step ${Math.max(...bends)}`)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/mesh-applied.png' })
check('the mesh stays in the smart object', (await smart()).warp?.side === 4)
const bent = (await smart()).warp

// ----- It can be opened again -----
await startTransform()
state = (await snapshot()).transform
check('opened again, the mesh shows', state.mode === 'mesh' && state.warpSide === 4)
await page.select('.toolbar select', '6')
await sleep(300)
state = (await snapshot()).transform
check('6×6 points', state.warpSide === 6)
await page.select('.toolbar select', '4')
await sleep(200)

// Free and Mesh together: the corners move the bent object
await click('Free')
await sleep(200)
check('Free keeps the mesh', (await snapshot()).transform.mode === 'free')
await page.keyboard.press('Escape')
await sleep(400)
check('Esc keeps the mesh it had', JSON.stringify((await smart()).warp) === JSON.stringify(bent))
const stillBent = await paintAt(500)
check('and the picture', stillBent.last === bentMiddle.last, `${stillBent.last}`)

await startTransform()
await click('Free')
await sleep(200)
// Moved by dragging inside: the bend goes along
await drag([500, 500], [400, 500])
await apply()
const moved = await paintAt(500)
check('moving it takes the bend along', Math.abs(moved.last - (bentMiddle.last - 100)) <= 3, `${moved.last}`)
await click('Undo')
await sleep(400)
check('undo brings it back', (await paintAt(500)).last === bentMiddle.last)
await waitIdle()

// ----- Undo inside a transform: each drag is a step -----
const undoKeys = async (...keys) => {
  for (const key of keys.slice(0, -1)) await page.keyboard.down(key)
  await page.keyboard.press(keys.at(-1))
  for (const key of keys.slice(0, -1).reverse()) await page.keyboard.up(key)
  await sleep(200)
}
await startTransform()
let snap = await snapshot()
check('nothing to undo yet in the transform', !snap.canUndo && !snap.canRedo)
await undoKeys('Control', 'z')
check('Ctrl+Z then leaves it open', (await snapshot()).transform !== null)
const pulled = [pointAt(0, 1)[0] - 150, pointAt(0, 1)[1]]
await drag(pointAt(0, 1), pulled)
await drag(pointAt(0, 2), [pointAt(0, 2)[0] - 150, pointAt(0, 2)[1]])
snap = await snapshot()
check('two drags can be undone', snap.canUndo && !snap.canRedo)
await undoKeys('Control', 'z')
await undoKeys('Control', 'z')
snap = await snapshot()
check('Ctrl+Z goes back, drag by drag, in the same transform', !snap.canUndo && snap.canRedo && snap.transform !== null)
await undoKeys('Control', 'Shift', 'z')
snap = await snapshot()
check('Ctrl+Shift+Z goes forward', snap.canUndo && snap.canRedo)
await undoKeys('Control', 'z')
await apply()
check('applied, the undone drags are gone', JSON.stringify((await smart()).warp) === JSON.stringify(bent))
await click('Undo')
await sleep(400)
await waitIdle()

await startTransform()
await drag(pointAt(0, 1), pulled)
await undoKeys('Control', 'z')
await drag(pointAt(0, 2), [pointAt(0, 2)[0] - 150, pointAt(0, 2)[1]])
await undoKeys('Control', 'Shift', 'z')
await apply()
check(
  'a new drag takes the place of what was undone',
  (await paintAt(400)).first > (await paintAt(600)).first + 80,
  `${(await paintAt(400)).first} and ${(await paintAt(600)).first}`,
)
await click('Undo')
await sleep(400)
await waitIdle()

// The same with the handles of Free
await startTransform()
await click('Free')
await sleep(200)
await drag([500, 500], [400, 500])
await undoKeys('Control', 'z')
await apply()
check('the handles of Free too', (await paintAt(500)).last === bentMiddle.last, String((await paintAt(500)).last))
await click('Undo')
await sleep(400)
await waitIdle()

// The number of points is a step
await startTransform()
await page.select('.toolbar select', '6')
await sleep(200)
check('changing the points is a step', (await snapshot()).canUndo)
await undoKeys('Control', 'z')
check('undone, there are 4 again', (await snapshot()).transform.warpSide === 4)
await page.keyboard.press('Escape')
await sleep(400)
check('Esc still leaves it as it was', JSON.stringify((await smart()).warp) === JSON.stringify(bent))

// ----- A saved drawing -----
const saved = await page.evaluate(async () => {
  const blob = await window.lydia.engine.saveProject()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(s)
})
const bytes = Buffer.from(saved, 'base64')
fs.writeFileSync(OUT + '/mesh.lyd', bytes)
const header = JSON.parse(bytes.subarray(12, 12 + bytes.readUInt32LE(8)).toString())
check('the file keeps the mesh', header.layers[0].smart.warp?.side === 4)

page.removeAllListeners('dialog')
page.on('dialog', d => d.accept())
await click('Back')
await sleep(300)
const [chooser] = await Promise.all([page.waitForFileChooser(), click('Open project')])
await chooser.accept([OUT + '/mesh.lyd'])
await page.waitForFunction(() => window.lydia?.engine && document.querySelectorAll('button.brush').length > 0, {
  timeout: 60000,
})
await sleep(800)
check('opened again, it is the same', JSON.stringify((await smart()).warp) === JSON.stringify(bent))
check('and so is the picture', (await paintAt(500)).last === bentMiddle.last)

// A mesh that is broken in a file
const damaged = await page.evaluate(async text => {
  const { parseProject } = await import('/src/engine/projectFile.ts')
  const file = Uint8Array.from(atob(text), c => c.charCodeAt(0))
  const length = new DataView(file.buffer).getUint32(8, true)
  const head = JSON.parse(new TextDecoder().decode(file.subarray(12, 12 + length)))
  head.layers[0].smart.warp.points.pop()
  const encoded = new TextEncoder().encode(JSON.stringify(head))
  const out = new Uint8Array(12 + encoded.length + file.length - 12 - length)
  out.set(file.subarray(0, 8))
  new DataView(out.buffer).setUint32(8, encoded.length, true)
  out.set(encoded, 12)
  out.set(file.subarray(12 + length), 12 + encoded.length)
  try {
    parseProject(out.buffer)
    return 'opened'
  } catch (error) {
    return error.message
  }
}, saved)
check('a broken mesh is a damaged file', damaged.startsWith('LYD-104'), damaged)

// ----- An unbent mesh leaves nothing behind -----
await page.evaluate(() => {
  const { engine } = window.lydia
  engine.addLayer()
})
await sleep(300)
await page.evaluate(() => {
  const { brush, engine } = window.lydia
  engine.setBrush({ size: 40, color: '#c02020', tool: 'brush', opacity: 1 })
  brush.startStroke(100, 100, 1)
  brush.continueStroke([{ x: 300, y: 100, pressure: 1 }])
  brush.endStroke()
})
await sleep(300)
await startTransform()
await click('Mesh')
await sleep(200)
await apply()
check('an unbent mesh is not kept', (await smart()).warp === undefined)

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
