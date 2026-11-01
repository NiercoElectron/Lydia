// The brush's own blend mode (decision 82): exact colors with Multiply and Screen on the paint of the layer, the same while
// painting and after; as plain paint where the layer has none; the stroke's opacity; a locked transparency; one step of
// undo; the eraser, which ignores it; and Normal, which stays as it was
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { CACHE_DIR, LAUNCH, PORT, ROOT } from './setup.mjs'
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
await page.setViewport({ width: 1920, height: 1080 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
const click = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).click(), text)
const waitIdle = async () => {
  await sleep(100)
  await page.waitForFunction(
    () => {
      const { engine, gpu, projection } = window.lydia
      const snap = engine.getSnapshot()
      return !snap.task && !snap.isUpdating && !projection.isUpdating() && !gpu.hasUnsaved()
    },
    { timeout: 30000, polling: 20 },
  )
  await sleep(150)
}
const shownAt = (x, y) => page.evaluate((x, y) => window.lydia.projection.colorAt(x, y), x, y)
const near = (color, expected, by = 2) =>
  color !== null &&
  [1, 3, 5].every(
    at => Math.abs(parseInt(color.slice(at, at + 2), 16) - parseInt(expected.slice(at, at + 2), 16)) <= by,
  )
const stroke = async (x, y, x2, y2, settings, keepOpen = false) => {
  await page.evaluate(
    ({ x, y, x2, y2, settings, keepOpen }) => {
      const { engine, brush } = window.lydia
      engine.setBrush({ opacity: 1, size: 80, blendMode: 'normal', tool: 'brush', ...settings })
      brush.settings.tool = settings.tool ?? 'brush'
      brush.startStroke(x, y, 1)
      brush.continueStroke([{ x: x2, y: y2, pressure: 1 }])
      if (!keepOpen) brush.endStroke()
    },
    { x, y, x2, y2, settings, keepOpen },
  )
  await sleep(150)
}
const chooseBrush = name =>
  page.evaluate(
    name =>
      [...document.querySelectorAll('button.brush')]
        .find(b => b.querySelector('.brush-name').textContent === name)
        .click(),
    name,
  )

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' })
await click('New project…')
await page.waitForSelector('dialog.new-project[open]')
const inputs = await page.$$('dialog input[type=number]')
for (const i of [0, 1]) {
  await inputs[i].click({ clickCount: 3 })
  await inputs[i].type('600')
}
await page.click('button[type=submit]')
await page.waitForFunction(
  () => window.lydia?.engine && window.lydia.app.renderer && document.querySelectorAll('button.brush').length > 0,
  { timeout: 90000 },
)
await sleep(800)
await chooseBrush('Hard round')
await sleep(300)

check(
  'the bar offers it with the brush',
  await page.$$eval('.toolbar label', labels => labels.some(l => l.textContent.startsWith('Brush blend'))),
)
await page.keyboard.press('e')
await sleep(150)
check(
  'not with the eraser',
  await page.$$eval('.toolbar label', labels => !labels.some(l => l.textContent.startsWith('Brush blend'))),
)
await page.keyboard.press('b')
await sleep(150)

// A band of paint to mix with: 200, 100, 50
await stroke(50, 200, 550, 200, { color: '#c86432', size: 120 })
await waitIdle()
check('the paint is there', near(await shownAt(300, 200), '#c86432'), await shownAt(300, 200))

// Multiply: 200 × 128 / 255 = 100, 100 × 128 / 255 = 50, 50 × 128 / 255 = 25
await stroke(300, 100, 300, 500, { color: '#808080', blendMode: 'multiply', size: 40 }, true)
const live = await shownAt(300, 200)
check('Multiply mixes with the paint while painting', near(live, '#643219'), live)
await page.evaluate(() => window.lydia.brush.endStroke())
await waitIdle()
const merged = await shownAt(300, 200)
check('and stays the same after', near(merged, live, 1), `${live} and ${merged}`)
check(
  'where the layer has no paint it is plain paint',
  near(await shownAt(300, 400), '#808080'),
  await shownAt(300, 400),
)
await page.evaluate(() => window.lydia.engine.undo())
await waitIdle()
check('one undo takes it away', near(await shownAt(300, 200), '#c86432'), await shownAt(300, 200))

// Screen: 255 - (255 - 200)(255 - 128) / 255 = 228, then 178 and 153
await stroke(300, 100, 300, 300, { color: '#808080', blendMode: 'screen', size: 40 })
await waitIdle()
check('Screen too', near(await shownAt(300, 200), '#e4b299'), await shownAt(300, 200))
await page.evaluate(() => window.lydia.engine.undo())
await waitIdle()

// At half the opacity, between the paint and what Multiply makes of it
await stroke(300, 100, 300, 300, { color: '#808080', blendMode: 'multiply', size: 40, opacity: 0.5 })
await waitIdle()
check('at half its opacity it mixes half as much', near(await shownAt(300, 200), '#964b26', 3), await shownAt(300, 200))
await page.evaluate(() => window.lydia.engine.undo())
await waitIdle()

// With the transparency locked, only over the paint
await page.evaluate(() => {
  const { engine, stack } = window.lydia
  engine.setLayerAlphaLock(stack.active.id, true)
})
await stroke(300, 100, 300, 500, { color: '#808080', blendMode: 'multiply', size: 40 })
await waitIdle()
check('a locked transparency keeps it on the paint', near(await shownAt(300, 200), '#643219'), await shownAt(300, 200))
check('and nowhere else', near(await shownAt(300, 400), '#ffffff'), await shownAt(300, 400))
await page.evaluate(() => {
  const { engine, stack } = window.lydia
  engine.undo()
  engine.setLayerAlphaLock(stack.active.id, false)
})
await waitIdle()

// A tile at the paper's edge is smaller than the others
await stroke(50, 590, 550, 590, { color: '#c86432', size: 60 })
await waitIdle()
await stroke(300, 560, 300, 600, { color: '#808080', blendMode: 'multiply', size: 30 })
await waitIdle()
check("at the paper's edge too", near(await shownAt(300, 585), '#643219'), await shownAt(300, 585))

await stroke(300, 100, 300, 300, { color: '#000000', tool: 'eraser', blendMode: 'multiply', size: 40 })
await waitIdle()
check('the eraser ignores it', near(await shownAt(300, 200), '#ffffff'), await shownAt(300, 200))

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
