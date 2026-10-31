// Losing the graphics card (decision 76): a message with its code; the drawing opens again by itself, from RAM, with its
// layers, tiles and view; a copy of it in the Recover list first; painting and undo work again; it can happen twice;
// strokes not yet in RAM are the only thing gone; the Brush Designer says so too
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { CACHE_DIR, LAUNCH, ROOT } from './setup.mjs'
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
const alerts = []
page.on('pageerror', e => problems.push('PAGE ERROR ' + e))
page.on('console', m => {
  const text = m.text()
  // The browser and PixiJS tell of the lost card themselves, as they should
  if (/context|WebGL|GL_|lost/i.test(text)) return
  if (text.startsWith('Canvas2D: Multiple readback')) return // this test's own reading of the canvases
  if (m.type() === 'error' || m.type() === 'warn') problems.push(m.type() + ': ' + text)
})
page.on('dialog', dialog => {
  alerts.push(dialog.message())
  dialog.accept()
})
await page.setViewport({ width: 1400, height: 900 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
const click = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).click(), text)
const at = ([x, y]) =>
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
  const a = await at(from)
  const b = await at(to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 8 })
  await page.mouse.up()
  await sleep(200)
}
const waitSaved = () => page.waitForFunction(() => !window.lydia.gpu.hasUnsaved(), { timeout: 20000 })
const picture = () =>
  page.evaluate(() => {
    const { app, gpu, stack, engine } = window.lydia
    const out = {}
    for (const layer of stack.layers) {
      for (const key of gpu.tilesWithPaint(layer)) {
        const [column, row] = key.split(',').map(Number)
        const pixels = app.renderer.extract.pixels(gpu.getTexture(layer, column, row, false)).pixels
        let sum = 0
        for (let i = 0; i < pixels.length; i++) sum = (sum * 31 + pixels[i]) | 0
        out[`${layer.name}/${key}`] = sum
      }
    }
    const snapshot = engine.getSnapshot()
    return { out, layers: snapshot.layers.map(l => [l.name, l.opacity, l.visible].join()) }
  })
const viewOf = () =>
  page.evaluate(() => {
    const { world } = window.lydia
    return [world.scale.y, world.rotation].map(n => n.toFixed(4)).join()
  })
const stored = () =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('lydia-autosave')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const running = open.result.transaction(['drawings'], 'readonly')
          const drawings = running.objectStore('drawings').getAll()
          running.oncomplete = () => {
            open.result.close()
            resolve(drawings.result)
          }
        }
      }),
  )
// Wait for the new engine. Asked from here, not with waitForFunction, whose watching in the page doesn't go on after an
// alert: the page itself goes on fine
const reopened = async () => {
  const started = Date.now()
  while (Date.now() - started < 90000) {
    const isOpen = await page.evaluate(() => {
      try {
        return (
          window.lydia?.app?.canvas !== window.__oldCanvas &&
          window.lydia?.autosaveNow !== undefined &&
          !window.lydia.app.renderer.gl.isContextLost()
        )
      } catch {
        return false // the old engine, while it is destroyed
      }
    })
    if (isOpen) break
    await sleep(100)
  }
  console.log(`     reopened in ${Date.now() - started} ms`)
  await sleep(800)
}
// Take the graphics card away, as a browser does
const loseCard = async () => {
  await page.evaluate(() => {
    const { app } = window.lydia
    window.__oldCanvas = app.canvas
    app.renderer.gl.getExtension('WEBGL_lose_context').loseContext()
  })
  await reopened()
}

await page.goto('http://localhost:5198/', { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('lydia')
  indexedDB.deleteDatabase('lydia-autosave')
})
await page.reload({ waitUntil: 'networkidle0' })
await sleep(300)
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
await page.waitForFunction(() => window.lydia?.engine && window.lydia.app.renderer && window.lydia.autosaveNow, {
  timeout: 90000,
})
await sleep(500)

await drag([100, 100], [500, 100])
await page.evaluate(() => window.lydia.engine.addLayer())
await sleep(200)
await drag([100, 300], [700, 300])
await page.keyboard.press('r') // another tool, to see it is still chosen
await sleep(100)
await page.keyboard.press('b')
await sleep(100)
await page.evaluate(() => {
  const { engine } = window.lydia
  engine.setBrush({ size: 44 })
})
await waitSaved()
await sleep(300)
const before = await picture()
const viewBefore = await viewOf()

await loseCard()
check(
  'it says so, with its code',
  alerts.some(text => text.startsWith('LYD-403')),
  alerts.join(),
)
const after = await picture()
check('every tile comes back', JSON.stringify(after.out) === JSON.stringify(before.out))
check('and the layers', JSON.stringify(after.layers) === JSON.stringify(before.layers), after.layers.join(' | '))
check('and the view', (await viewOf()) === viewBefore)
const snapshot = await page.evaluate(() => window.lydia.engine.getSnapshot())
check('it counts as not saved', snapshot.isModified)
check('the undo history is gone, not half there', !snapshot.canUndo && !snapshot.canRedo)

const copies = await stored()
check('a copy was kept first', copies.length === 1 && copies[0].isComplete, String(copies.length))

// It goes on working
await drag([100, 500], [500, 500])
await waitSaved()
const painted = await picture()
check('painting works', Object.keys(painted.out).length >= Object.keys(after.out).length)
check('and undo', await page.evaluate(() => window.lydia.engine.getSnapshot().canUndo))
await page.evaluate(() => window.lydia.autosaveNow())
await sleep(200)
check('its next copy takes the place of the first', (await stored()).length === 1)

// Twice
alerts.length = 0
await loseCard()
check('it can happen again', alerts.length === 1 && alerts[0].startsWith('LYD-403'), alerts.join())
check('with the same drawing', JSON.stringify((await picture()).out) === JSON.stringify(painted.out))

// A stroke still only on the graphics card is what goes. The rest stays
alerts.length = 0
await page.evaluate(() => {
  const { brush, engine, app } = window.lydia
  engine.setBrush({ size: 30, color: '#ff0000', tool: 'brush', opacity: 1 })
  brush.startStroke(100, 700, 1)
  brush.continueStroke([{ x: 700, y: 700, pressure: 1 }])
  brush.endStroke()
  window.__oldCanvas = app.canvas
  app.renderer.gl.getExtension('WEBGL_lose_context').loseContext()
})
await reopened()
check(
  'the last stroke is gone, as the message says',
  JSON.stringify((await picture()).out) === JSON.stringify(painted.out),
)

// Going back: the copy stays, since the drawing isn't saved anywhere
await click('Back')
await sleep(800)
check('back on the start screen, it can be recovered', (await page.$$eval('.recover li', rows => rows.length)) === 1)

// ----- The Brush Designer -----
alerts.length = 0
await click('Open Brush Designer')
await page.waitForFunction(() => window.lydia?.app?.renderer && document.querySelector('.draw-space canvas'), {
  timeout: 90000,
})
await sleep(800)
await page.evaluate(() => window.lydia.app.renderer.gl.getExtension('WEBGL_lose_context').loseContext())
await sleep(800)
check(
  'the Brush Designer says so too',
  alerts.some(text => text.startsWith('LYD-404')),
  alerts.join(),
)

// ----- A real crash of the graphics process -----
// It takes all that was on the card, not only the drawing's context
await page.reload({ waitUntil: 'networkidle0' })
await sleep(300)
await click('New project…')
await page.waitForSelector('dialog.new-project[open]')
await page.click('button[type=submit]')
await page.waitForFunction(
  () => window.lydia?.autosaveNow && document.querySelectorAll('canvas.brush-preview').length > 3,
  { timeout: 90000 },
)
await sleep(1500)
await drag([100, 100], [500, 100])
await waitSaved()
await sleep(300)
// How much of each canvas of the screen is painted
const painted2d = () =>
  page.evaluate(() => {
    const count = canvas => {
      const { data } = canvas
        .getContext('2d', { willReadFrequently: true })
        .getImageData(0, 0, canvas.width, canvas.height)
      let filled = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) filled++
      return filled
    }
    return {
      samples: [...document.querySelectorAll('canvas.brush-preview')].map(count),
      picker: count(document.querySelector('.color-panel canvas')),
    }
  })
const screenBefore = await painted2d()
const canvasTaken = page.evaluate(
  () =>
    new Promise(resolve => {
      document.querySelector('.color-panel canvas').addEventListener('contextlost', () => resolve(true), { once: true })
    }),
)
const crashBefore = await picture()
check(
  '(the samples and the color triangle are painted)',
  screenBefore.samples.every(n => n > 0) && screenBefore.picker > 1000,
)
await page.evaluate(() => {
  window.__oldCanvas = window.lydia.app.canvas
})
alerts.length = 0
const browserSession = await browser.target().createCDPSession()
await browserSession.send('Browser.crashGpuProcess').catch(e => console.log('     no crash:', e.message))
await reopened()
check('the browser really took the canvases away', await canvasTaken)
check(
  'a real crash says so too',
  alerts.some(text => text.startsWith('LYD-403')),
  alerts.join(),
)
check('the drawing comes back', JSON.stringify((await picture()).out) === JSON.stringify(crashBefore.out))
await sleep(1500) // the browser gives the canvases back about a second later
const screenAfter = await painted2d()
check(
  'the samples are painted again',
  screenAfter.samples.every(n => n > 0),
  screenAfter.samples.join(),
)
check('and the color triangle', screenAfter.picker === screenBefore.picker, String(screenAfter.picker))
const sample = await page.evaluate(async () => {
  const { paintSample, sampleWave } = await import('/src/engine/previewSurface.ts')
  const { brush } = window.lydia
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 44
  await paintSample(canvas, 160, brush.getTip(), brush.getShape(), 22, sampleWave(160, 44, 13))
  const { data } = canvas.getContext('2d').getImageData(0, 0, 160, 44)
  return data.filter((_, i) => i % 4 === 3 && data[i] > 0).length
})
check('a new sample paints, with a new renderer', sample > 100, `${sample} pixels`)
await drag([100, 300], [500, 300])
await waitSaved()
check('and painting works', Object.keys((await picture()).out).length >= Object.keys(crashBefore.out).length)

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
