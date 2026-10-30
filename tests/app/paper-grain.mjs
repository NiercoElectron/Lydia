// The paper's grain (decision 67): the Pencil brush paints only the paper's higher places with light pressure and
// fills more of them pressing harder, going over a place again in the same stroke doesn't fill the grooves, the grain
// is fixed to the paper (two strokes crossing leave the same grooves empty), brushes without a grain have no holes,
// the brush file keeps the grain, and the Brush Designer's grain controls (screenshots to look at)
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
async function choose(name) {
  await page.evaluate(
    name =>
      [...document.querySelectorAll('button.brush')]
        .find(b => b.querySelector('.brush-name').textContent === name)
        .click(),
    name,
  )
  await sleep(300)
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
  [0, 1024],
  [1, 768],
]) {
  await inputs[i].click({ clickCount: 3 })
  await inputs[i].type(String(value))
}
await page.click('button[type=submit]')
await page.waitForFunction(
  () => window.lydia?.engine && window.lydia.app.renderer && document.querySelectorAll('button.brush').length > 0,
  { timeout: 90000 },
)
await sleep(1500) // the previews are painted

const names = await page.$$eval('button.brush .brush-name', els => els.map(e => e.textContent))
check(
  'Pencil comes with Lydia, after Airbrush',
  names.indexOf('Pencil') === names.indexOf('Airbrush') + 1,
  names.join(),
)
const pencilPreview = await page.$$eval('button.brush', buttons => {
  const button = buttons.find(b => b.querySelector('.brush-name').textContent === 'Pencil')
  const c = button.querySelector('canvas')
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let painted = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) painted++
  return painted
})
check("Pencil's sample stroke shows", pencilPreview > 40, String(pencilPreview))

// A stroke through these points [x, y, pressure], on a layer of its own
const stroke = (points, size, tool = 'brush') =>
  page.evaluate(
    (points, size, tool) => {
      const { brush, engine } = window.lydia
      engine.setBrush({ size, color: '#000000', tool, opacity: 1 })
      brush.startStroke(points[0][0], points[0][1], points[0][2])
      for (const [x, y, p] of points.slice(1)) brush.continueStroke([{ x, y, pressure: p }])
      brush.endStroke()
    },
    points,
    size,
    tool,
  )
const line = (x0, y0, x1, y1, pressure, n = 60) =>
  Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, pressure])
const newLayer = () => page.evaluate(() => window.lydia.engine.addLayer())
// The alpha of the active layer's pixels in a box of the paper, read from its tiles
const alphas = (x, y, width, height) =>
  page.evaluate(
    (x, y, width, height) => {
      const { app, gpu, stack } = window.lydia
      // Whole tiles at once: one read for each tile the box touches
      const cache = new Map()
      return Array.from({ length: width * height }, (_, i) => {
        const px = x + (i % width)
        const py = y + Math.floor(i / width)
        const key = Math.floor(px / 256) + ',' + Math.floor(py / 256)
        if (!cache.has(key)) {
          const texture = gpu.getTexture(stack.active, Math.floor(px / 256), Math.floor(py / 256), false)
          cache.set(key, texture ? { pixels: app.renderer.extract.pixels(texture).pixels, w: texture.width } : null)
        }
        const tile = cache.get(key)
        return tile ? tile.pixels[((py % 256) * tile.w + (px % 256)) * 4 + 3] : 0
      })
    },
    x,
    y,
    width,
    height,
  )
const share = (values, test) => values.filter(test).length / values.length
const EMPTY = a => a < 40

// ----- Pencil: light pressure leaves the grooves out, more pressure fills them -----
await choose('Pencil')
await stroke(line(100, 100, 900, 100, 0.25), 40)
const light = await alphas(200, 95, 600, 10)
await newLayer()
await stroke(line(100, 200, 900, 200, 1), 40)
const hard = await alphas(200, 195, 600, 10)
const lightEmpty = share(light, EMPTY)
const hardEmpty = share(hard, EMPTY)
check('light pressure leaves much of the paper out', lightEmpty > 0.3, (lightEmpty * 100).toFixed(1) + '% empty')
check(
  'full pressure leaves less out, and still some',
  hardEmpty < lightEmpty - 0.15 && hardEmpty > 0.02,
  (hardEmpty * 100).toFixed(1) + '% empty',
)

// ----- Going over the same place again in one stroke doesn't fill the grooves -----
await newLayer()
const backAndForth = [
  ...line(100, 300, 900, 300, 0.25),
  ...line(900, 300, 100, 300, 0.25),
  ...line(100, 300, 900, 300, 0.25),
  ...line(900, 300, 100, 300, 0.25),
]
await stroke(backAndForth, 40)
const again = await alphas(200, 295, 600, 10)
const againEmpty = share(again, EMPTY)
check(
  'four times over the same place, as much is left out as once',
  Math.abs(againEmpty - lightEmpty) < 0.05,
  (againEmpty * 100).toFixed(1) + '% empty, once ' + (lightEmpty * 100).toFixed(1) + '%',
)

// ----- Fixed to the paper: strokes crossing on two layers leave the same places out -----
// (Pencil gets thinner with less pressure: at a quarter of it, these strokes are 40 pixels wide)
await newLayer()
await stroke(line(300, 400, 700, 400, 0.25), 160)
const across = await alphas(488, 388, 24, 24)
await newLayer()
await stroke(line(500, 300, 500, 600, 0.25), 160)
const down = await alphas(488, 388, 24, 24)
const agree = across.filter((a, i) => EMPTY(a) === EMPTY(down[i])).length / across.length
check('the same places of the paper are left out by both', agree > 0.9, (agree * 100).toFixed(1) + '% agree')

// ----- A brush without a grain leaves no holes -----
await choose('Hard round')
await newLayer()
await stroke(line(100, 700, 900, 700, 0.25), 40)
const plain = await alphas(200, 698, 600, 4)
check('Hard round has no grain', share(plain, EMPTY) === 0, (share(plain, EMPTY) * 100).toFixed(1) + '% empty')

await page.evaluate(() => {
  const { world, projection } = window.lydia
  world.scale.set(1)
  projection.setZoom(1)
  world.position.set(10, 10)
})
await sleep(500)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/paper-grain.png' })

// ----- The brush file keeps the grain -----
const file = await page.evaluate(async () => {
  const { parseBrushFile, serializeBrushFile } = await import('/src/engine/brushFile.ts')
  const { LydiaError } = await import('/src/errors.ts')
  const { default: pencilFile } = await import('/src/brushes/pencil.lydbrush?raw')
  const pencil = parseBrushFile(pencilFile, 'x')
  const again = parseBrushFile(serializeBrushFile(pencil), 'x')
  const withoutGrain = parseBrushFile(serializeBrushFile({ ...pencil, grain: undefined }), 'x')
  const broken = JSON.parse(serializeBrushFile(pencil))
  const problem = text => {
    try {
      parseBrushFile(text, 'x')
      return 'none'
    } catch (error) {
      return error instanceof LydiaError ? error.code : String(error)
    }
  }
  return {
    grainBytes: pencil.grain?.length ?? 0,
    depth: pencil.grainDepth,
    sameGrain: again.grain?.length === pencil.grain.length && again.grain.every((b, i) => b === pencil.grain[i]),
    withoutGrain:
      withoutGrain.grain === undefined && !serializeBrushFile({ ...pencil, grain: undefined }).includes('"grain"'),
    notPng: problem(JSON.stringify({ ...broken, grain: 'data:image/png;base64,AAAA' })),
    notText: problem(JSON.stringify({ ...broken, grain: 12 })),
    depthLimited: parseBrushFile(JSON.stringify({ ...broken, grainDepth: 7, grainScale: 0 }), 'x'),
  }
})
check('Pencil has a grain and some depth', file.grainBytes > 1000 && file.depth > 0, `${file.grainBytes} bytes`)
check('the grain is saved and read again as it was', file.sameGrain)
check('a brush without a grain saves none', file.withoutGrain)
check('a grain that is not a PNG: LYD-215', file.notPng === 'LYD-215' && file.notText === 'LYD-215', file.notPng)
check(
  'depth and scale are kept within their limits',
  file.depthLimited.grainDepth === 1 && file.depthLimited.grainScale === 0.1,
)

// ----- The Brush Designer -----
await page.evaluate(() => {
  window.confirm = () => true
})
await click('Back')
await sleep(300)
await page.select('.designer-start .tip-paper', '256')
await click('Open Brush Designer')
await page.waitForFunction(() => window.lydia?.engine && document.querySelector('.designer-panel'), { timeout: 90000 })
await sleep(800)
// A tip: a short line in the middle of the paper
const paper = await (await page.$('.draw-space canvas')).boundingBox()
await page.mouse.move(paper.x + paper.width / 2 - 10, paper.y + paper.height / 2)
await page.mouse.down()
await page.mouse.move(paper.x + paper.width / 2 + 10, paper.y + paper.height / 2, { steps: 4 })
await page.mouse.up()
await page.waitForFunction(() => document.querySelector('.designer-panel .hint').textContent.startsWith('Tip:'), {
  timeout: 10000,
})
const depthSlider = () =>
  page.evaluate(() => {
    const row = [...document.querySelectorAll('.slider-row')].find(r => r.textContent.startsWith('Depth'))
    const input = row.querySelector('input[type=range]')
    return { value: Number(input.value), disabled: input.disabled }
  })
const before = await depthSlider()
check('without a grain picture, Depth is 0 and off', before.value === 0 && before.disabled, JSON.stringify(before))
await click('Rough')
await page.waitForFunction(() =>
  [...document.querySelectorAll('.grain-pictures button')].some(
    b => b.textContent === 'Rough' && b.ariaPressed === 'true',
  ),
)
await sleep(800)
const after = await depthSlider()
check('choosing a grain gives it 50% depth', after.value === 50 && !after.disabled, JSON.stringify(after))

// The test area paints with the grain: a stroke there leaves holes
const testArea = await page.$('.test-canvas')
const box = await testArea.boundingBox()
await page.mouse.move(box.x + 20, box.y + box.height / 2)
await page.mouse.down()
for (let i = 1; i <= 30; i++) await page.mouse.move(box.x + 20 + ((box.width - 40) * i) / 30, box.y + box.height / 2)
await page.mouse.up()
await sleep(500)
const testHoles = await page.$eval('.test-canvas', c => {
  const d = c.getContext('2d').getImageData(c.width * 0.25, c.height / 2 - 2, c.width / 2, 4).data
  let empty = 0
  for (let i = 3; i < d.length; i += 4) if (d[i] < 40) empty++
  return empty / (d.length / 4)
})
check('the test area paints with the grain', testHoles > 0.05, (testHoles * 100).toFixed(1) + '% empty')

// An image of one's own as the grain
const fileInput = await page.$('.grain-pictures input[type=file]')
await fileInput.uploadFile(ROOT + '/src/grains/canvas.png')
await page.waitForFunction(() =>
  [...document.querySelectorAll('.grain-pictures button')].some(
    b => b.textContent === 'Custom' && b.ariaPressed === 'true',
  ),
)
check('an imported image becomes the grain', true)
await (await page.$('.designer-panel')).screenshot({ path: OUT + '/paper-grain-designer.png' })

// Saved, the brush keeps its grain
await click('Save to my brushes')
await sleep(800)
const saved = await page.evaluate(
  () =>
    new Promise(resolve => {
      const request = indexedDB.open('lydia', 1)
      request.onsuccess = () => {
        const all = request.result.transaction('brushes').objectStore('brushes').getAll()
        all.onsuccess = () => resolve(all.result.map(record => JSON.parse(record.file)))
      }
    }),
)
check(
  'the saved brush has its grain, depth and scale',
  saved.length === 1 && saved[0].grain?.startsWith('data:image/png;base64,') && saved[0].grainDepth === 0.5,
  JSON.stringify(saved.map(b => ({ depth: b.grainDepth, scale: b.grainScale, grain: b.grain?.length }))),
)

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
