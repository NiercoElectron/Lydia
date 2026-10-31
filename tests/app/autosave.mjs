// Autosave (decision 75): the setting on the start screen; a copy of the drawing kept in the browser; the Recover list
// after the page goes away, with a picture; the drawing recovered to the pixel, with its layers, folders, smart objects
// and export scale; each autosave writing only what changed, undo included; nothing recoverable after Save or closing with nothing to
// lose; a copy left half written; a damaged copy; never more than five; Delete; painting never waiting
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
page.on('pageerror', e => problems.push('PAGE ERROR ' + e))
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warn') problems.push(m.type() + ': ' + m.text())
})
page.on('dialog', dialog => {
  if (dialog.type() === 'alert') problems.push('ALERT ' + dialog.message())
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
const SETTLED = () => window.lydia?.engine && window.lydia.app.renderer && window.lydia.autosaveNow
const newDrawing = async (width = 800, height = 800) => {
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
  await page.evaluate(() => {
    if (window.lydia) window.lydia.autosaveNow = undefined
  })
  await page.click('button[type=submit]')
  await page.waitForFunction(SETTLED, { timeout: 90000 })
  await sleep(500)
}
const stroke = (color, x0, y0, x1, y1, size = 30) =>
  page.evaluate(
    ([color, x0, y0, x1, y1, size]) => {
      const { brush, engine } = window.lydia
      engine.setBrush({ size, color, tool: 'brush', opacity: 1 })
      brush.startStroke(x0, y0, 1)
      brush.continueStroke([{ x: x1, y: y1, pressure: 1 }])
      brush.endStroke()
    },
    [color, x0, y0, x1, y1, size],
  )
// Through the mouse, as painting is, so the engine hears of the change
const drag = async (from, to) => {
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
  const a = await at(from)
  const b = await at(to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 8 })
  await page.mouse.up()
  await sleep(200)
}
const autosaveNow = async () => {
  await page.evaluate(() => window.lydia.autosaveNow())
  await sleep(100)
}
const pixelsOf = () =>
  page.evaluate(async () => {
    const { app, gpu, stack, engine } = window.lydia
    // Every layer's tiles, each by its name and place
    const out = {}
    for (const layer of stack.layers) {
      for (const key of gpu.tilesWithPaint(layer)) {
        const [column, row] = key.split(',').map(Number)
        const texture = gpu.getTexture(layer, column, row, false)
        const pixels = app.renderer.extract.pixels(texture).pixels
        let sum = 0
        for (let i = 0; i < pixels.length; i++) sum = (sum * 31 + pixels[i]) | 0
        out[`${layer.name}/${key}`] = sum
      }
    }
    return { out, snapshot: engine.getSnapshot().layers.map(l => [l.name, l.visible, l.opacity, l.blendMode].join()) }
  })
// How many records the database has, and how many bytes in tiles
const stored = () =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('lydia-autosave')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result
          const running = database.transaction(['drawings', 'tiles'], 'readonly')
          const drawings = running.objectStore('drawings').getAll()
          const tiles = running.objectStore('tiles').getAllKeys()
          running.oncomplete = () => {
            database.close()
            resolve({ drawings: drawings.result, tiles: tiles.result })
          }
        }
      }),
  )
const recoverRows = () => page.$$eval('.recover li', rows => rows.length)
const goToStart = async () => {
  await page.reload({ waitUntil: 'networkidle0' })
  await sleep(500)
}

await page.goto('http://localhost:5198/', { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('lydia')
  indexedDB.deleteDatabase('lydia-autosave')
})
await page.reload({ waitUntil: 'networkidle0' })
await sleep(300)

// ----- The setting -----
const selected = () =>
  page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find(l => l.textContent.startsWith('Autosave'))
    return label.querySelector('select').value
  })
check('it starts at 2 minutes', (await selected()) === '2')
const choices = await page.evaluate(() =>
  [
    ...[...document.querySelectorAll('label')]
      .find(l => l.textContent.startsWith('Autosave'))
      .querySelectorAll('option'),
  ].map(o => o.textContent),
)
check('1, 2, 5 minutes or off', choices.join() === 'Every 1 min,Every 2 min,Every 5 min,Off', choices.join())
check('nothing to recover at first', (await recoverRows()) === 0)

// ----- A copy, and the page going away -----
await newDrawing()
await drag([100, 100], [400, 100])
await stroke('#ff0000', 300, 200, 300, 600)
await page.evaluate(() => window.lydia.engine.addLayer())
await sleep(200)
await drag([100, 300], [700, 300])
await page.evaluate(() => {
  const { engine } = window.lydia
  engine.setLayerOpacity(engine.getSnapshot().activeLayerId, 0.5)
  engine.finishLayerOpacity()
  const painted = engine.getSnapshot().activeLayerId
  engine.addFolder()
  engine.selectLayer(painted) // a folder can't be painted on
})
await sleep(300)
const before = await pixelsOf()
await autosaveNow()
const first = await stored()
check('one drawing kept', first.drawings.length === 1 && first.drawings[0].isComplete, String(first.drawings.length))
check('with its tiles', first.tiles.length > 3, `${first.tiles.length} tiles`)
check('and a picture', first.drawings[0].thumbnail !== null)

// Each autosave only writes what changed
await autosaveNow()
const same = await stored()
check('nothing changed, no tile is written', same.tiles.length === first.tiles.length)
await drag([100, 500], [140, 500])
await autosaveNow()
const more = await stored()
const added = more.tiles.filter(key => !first.tiles.some(old => old[1] === key[1])).length
check('a small stroke writes only its tiles', added > 0 && added <= 4, `${added} of ${more.tiles.length}`)
await click('Undo')
await sleep(300)
await autosaveNow()
const fewer = await stored()
check('and the tiles no longer used go away', fewer.tiles.length < more.tiles.length, `${fewer.tiles.length}`)
// Undo brought back tiles that had left the drawing: each one must still be in the copy. And the other way
await click('Redo')
await sleep(300)
await autosaveNow()
await click('Undo')
await sleep(300)
await autosaveNow()

await page.evaluate(() => {
  window.onbeforeunload = null
})
await goToStart()
check('after the page goes away, it is in the Recover list', (await recoverRows()) === 1)
check(
  'with its picture, size and time',
  await page.$eval('.recover li', li => li.querySelector('img') !== null && li.textContent.includes('800×800')),
)
const shown = await page.$eval(
  '.recover img',
  img => new Promise(r => (img.complete ? r(img.naturalWidth) : (img.onload = () => r(img.naturalWidth)))),
)
check('the picture opens', shown > 100, `${shown} wide`)

// ----- Recovering -----
await page.evaluate(() =>
  [...document.querySelectorAll('.recover li button')].find(b => b.textContent === 'Open').click(),
)
await page.waitForFunction(SETTLED, { timeout: 90000 })
await sleep(600)
const after = await pixelsOf()
check('every tile comes back, to the pixel', JSON.stringify(after.out) === JSON.stringify(before.out))
check(
  'the layers and folder too',
  JSON.stringify(after.snapshot) === JSON.stringify(before.snapshot),
  after.snapshot.join(' | '),
)
check('it counts as not saved', await page.evaluate(() => window.lydia.engine.getSnapshot().isModified))

// It goes on from there, in place of the copy it came from
await drag([500, 500], [600, 500])
await autosaveNow()
check("its next copy takes the old one's place", (await stored()).drawings.length === 1)

// ----- All that a file keeps comes back -----
await goToStart()
await page.evaluate(() =>
  [...document.querySelectorAll('.recover li button')].find(b => b.textContent === 'Delete').click(),
)
await sleep(400)
await newDrawing()
await stroke('#0000ff', 100, 400, 700, 400, 60)
await drag([100, 100], [400, 100])
await sleep(300)
await page.evaluate(() => window.lydia.engine.startTransform())
await sleep(800)
await page.keyboard.press('Enter')
await sleep(800)
const kept = () =>
  page.evaluate(() => {
    const { engine, stack } = window.lydia
    const snapshot = engine.getSnapshot()
    const { smart } = stack.active
    return {
      isSmart: smart !== undefined,
      sourceTiles: smart?.source.tiles.size,
      corners: JSON.stringify(smart?.corners),
      zoom: engine.getSnapshot().exportScale,
      trayColors: JSON.stringify(snapshot.trayColors),
    }
  })
await page.evaluate(() => {
  window.lydia.engine.setExportScale(2)
  window.lydia.engine.setTrayColors(['#123456'])
})
await sleep(200)
const keptBefore = await kept()
const objectBefore = await pixelsOf()
await autosaveNow()
await goToStart()
await page.evaluate(() =>
  [...document.querySelectorAll('.recover li button')].find(b => b.textContent === 'Open').click(),
)
await page.waitForFunction(SETTLED, { timeout: 90000 })
await sleep(600)
const keptAfter = await kept()
check(
  'a smart object comes back, with its source',
  keptBefore.isSmart && JSON.stringify(keptAfter) === JSON.stringify(keptBefore),
  JSON.stringify(keptAfter),
)
check('with its tiles', JSON.stringify((await pixelsOf()).out) === JSON.stringify(objectBefore.out))

// ----- Save: nothing to recover -----
await click('Save')
await sleep(800)
await goToStart()
check('after Save, nothing to recover', (await recoverRows()) === 0)

await newDrawing()
await drag([100, 100], [200, 100])
await autosaveNow()
await click('Save')
await sleep(800)
await click('Back')
await sleep(500)
await goToStart()
const closed = await stored()
check(
  'closed with nothing to lose, the copy goes away',
  closed.drawings.every(d => d.isSaved),
  JSON.stringify(closed.drawings.length),
)

// ----- A copy left half written -----
await newDrawing()
await drag([100, 100], [400, 100])
await autosaveNow()
const whole = await pixelsOf()
await drag([100, 200], [400, 200])
// Tiles are in the database, and the list of what the drawing has never comes: as if the browser crashed
await page.evaluate(
  () =>
    new Promise(resolve => {
      const open = indexedDB.open('lydia-autosave')
      open.onsuccess = () => {
        const running = open.result.transaction(['drawings', 'tiles'], 'readwrite')
        const store = running.objectStore('tiles')
        running.objectStore('drawings').getAll().onsuccess = e => {
          const { id } = e.target.result.find(d => !d.isSaved)
          store.put(new Uint8Array([1, 2, 3]), [id, 999999])
        }
        running.oncomplete = () => {
          open.result.close()
          resolve()
        }
      }
    }),
)
await goToStart()
check('it is still listed', (await recoverRows()) === 1)
await page.evaluate(() =>
  [...document.querySelectorAll('.recover li button')].find(b => b.textContent === 'Open').click(),
)
await page.waitForFunction(SETTLED, { timeout: 90000 })
await sleep(500)
check('and opens from its last whole copy', JSON.stringify((await pixelsOf()).out) === JSON.stringify(whole.out))
await goToStart()

// ----- A damaged copy -----
const alerts = []
page.removeAllListeners('dialog')
page.on('dialog', dialog => {
  alerts.push(dialog.message())
  dialog.accept()
})
await page.evaluate(
  () =>
    new Promise(resolve => {
      const open = indexedDB.open('lydia-autosave')
      open.onsuccess = () => {
        const running = open.result.transaction(['drawings', 'tiles'], 'readwrite')
        const store = running.objectStore('tiles')
        store.getAllKeys().onsuccess = e => {
          for (const key of e.target.result) store.delete(key)
        }
        running.oncomplete = () => {
          open.result.close()
          resolve()
        }
      }
    }),
)
await page.evaluate(() =>
  [...document.querySelectorAll('.recover li button')].find(b => b.textContent === 'Open').click(),
)
await sleep(800)
check(
  'a damaged copy says so',
  alerts.some(text => text.startsWith('LYD-107')),
  alerts.join(),
)
check('and stays on the start screen', (await page.$('.recover')) !== null)

// ----- Delete -----
await page.evaluate(() =>
  [...document.querySelectorAll('.recover li button')].find(b => b.textContent === 'Delete').click(),
)
await sleep(500)
check('Delete asks, and takes it away', (await recoverRows()) === 0 && alerts.length >= 2, alerts.at(-1))
await goToStart()
check('for good', (await recoverRows()) === 0)

// ----- Never more than five -----
for (let i = 0; i < 7; i++) {
  await newDrawing(400, 400)
  await drag([50, 50], [150 + i * 10, 50])
  await autosaveNow()
  await sleep(50)
  await goToStart()
}
check('only the five newest are kept', (await recoverRows()) === 5, String(await recoverRows()))

// ----- Painting never waits -----
await newDrawing()
const held = await page.evaluate(async () => {
  const { brush, engine, autosaveNow } = window.lydia
  engine.setBrush({ size: 30, color: '#00ff00', tool: 'brush', opacity: 1 })
  brush.startStroke(100, 100, 1)
  brush.continueStroke([{ x: 400, y: 100, pressure: 1 }])
  brush.endStroke()
  return autosaveNow && 'ready'
})
check('(ready)', held === 'ready')
await page.mouse.move(600, 400)
await page.mouse.down()
await page.mouse.move(700, 450, { steps: 4 })
const waiting = page.evaluate(() => window.lydia.autosaveNow().then(() => performance.now()))
await sleep(400)
const during = await stored()
await page.mouse.up()
await sleep(100)
await waiting
const after2 = await stored()
check(
  'a stroke under way puts it off',
  during.drawings.every(d => d.width !== 800),
)
check(
  'and it happens after',
  after2.drawings.some(d => d.width === 800 && d.isComplete),
)

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
