// Zoomed in, the drawing's pixels are smoothed (decision 68), as one picture so the tiles' edges don't show, and shown
// as sharp squares only for pixel art: with a pixel brush, or where the pixel grid shows. Zoomed out, they are always
// blended (screenshots to look at)
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
await page.setViewport({ width: 1400, height: 900 })
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
  [0, 800],
  [1, 600],
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

// A thin curve crossing the edge between two tiles (x = 256)
await choose('Hard round')
await page.evaluate(() => {
  const { brush, engine } = window.lydia
  engine.setBrush({ size: 3, color: '#000000', tool: 'brush', opacity: 1 })
  brush.startStroke(200, 200, 1)
  for (let i = 1; i <= 40; i++) brush.continueStroke([{ x: 200 + i * 3, y: 200 + (i * i) / 20, pressure: 1 }])
  brush.endStroke()
})
// Zoom to "zoom" around the point (256, 250) of the paper, in the middle of the drawing area
const zoomTo = zoom =>
  page.evaluate(zoom => {
    const { app, world, projection } = window.lydia
    world.scale.set(zoom)
    projection.setZoom(zoom)
    world.position.set(app.screen.width / 2 - 256 * zoom, app.screen.height / 2 - 250 * zoom)
  }, zoom)
const modes = () =>
  page.evaluate(() => [...new Set([...window.lydia.projection.tiles.values()].map(t => t.source.scaleMode))].join())

// Whether, in the next frame, the screen shows the drawing's tiles as one picture (see smoothZoom.ts): looked at
// just before the frame is drawn, and whether all is as before once it is
const asOnePicture = () =>
  page.evaluate(
    () =>
      new Promise(resolve => {
        const { app, projection } = window.lydia
        const look = () => {
          app.ticker.remove(look)
          const during = !projection.container.visible
          requestAnimationFrame(() => resolve({ during, after: projection.container.visible }))
        }
        app.ticker.add(look, undefined, -24.5) // after the drawing changes (-24), before it is drawn (-25)
      }),
  )

await zoomTo(6.44)
await sleep(300)
check('zoomed in to 644%, the pixels are smoothed', (await modes()) === 'linear', await modes())
const onePicture = await asOnePicture()
check(
  'and shown as one picture, the tiles drawn as before after the frame',
  onePicture.during && onePicture.after,
  JSON.stringify(onePicture),
)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/smooth-zoom-644.png' })
await zoomTo(16)
await page.evaluate(() => window.lydia.engine.setPixelGrid(false))
await sleep(300)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/smooth-zoom-tile-edge.png' })
await page.evaluate(() => window.lydia.engine.setPixelGrid(true))

await zoomTo(0.5)
check('zoomed out, they are blended', (await modes()) === 'linear', await modes())
check('as the tiles themselves', !(await asOnePicture()).during)

await zoomTo(10)
await sleep(300)
check(
  'where the pixel grid shows (800% and more), they are sharp squares',
  (await modes()) === 'nearest',
  await modes(),
)
await page.evaluate(() => window.lydia.engine.setPixelGrid(false))
check('with the grid off, they are smoothed again', (await modes()) === 'linear', await modes())
await page.evaluate(() => window.lydia.engine.setPixelGrid(true))

await zoomTo(6.44)
await choose('Pixel')
check('with a pixel brush, they are sharp squares', (await modes()) === 'nearest', await modes())
check('as the tiles themselves', !(await asOnePicture()).during)
await (await page.$('.draw-space canvas')).screenshot({ path: OUT + '/smooth-zoom-pixel.png' })
await zoomTo(0.5)
check('a pixel brush zoomed out: blended', (await modes()) === 'linear', await modes())
await zoomTo(6.44)
await choose('Soft round')
check('another brush: smoothed again', (await modes()) === 'linear', await modes())

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
