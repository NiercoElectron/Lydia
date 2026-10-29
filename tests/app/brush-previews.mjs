// The brush previews' renderer keeps working after a drawing or the Brush Designer is closed: its engine used to
// release PixiJS's global resources, which broke the next preview (the Designer's test area fell on its first stroke)
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
page.on('pageerror', e => problems.push(e.message))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
await page.setViewport({ width: 1400, height: 900 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
await page.goto('http://localhost:5198/', { waitUntil: 'networkidle0' })
const tryPreview = label =>
  page.evaluate(async label => {
    const { createPreviewSurface, sampleWave } = await import('/src/engine/previewSurface.ts')
    const { builtInBrush, tipOf } = await import('/src/brushLibrary.ts')
    const brush = builtInBrush('hard-round')
    const tip = await tipOf(brush)
    const canvas = document.createElement('canvas')
    canvas.width = 280
    canvas.height = 200
    const surface = await createPreviewSurface()
    try {
      surface.setSize(280, 200)
      surface.paintStroke(tip, brush.preset, 40, sampleWave(280, 200, 30), 1)
      surface.copyTo(canvas)
      return `${label}: a new preview works`
    } catch (e) {
      return `${label}: a new preview fails: ${e.message}`
    } finally {
      surface.destroy()
    }
  }, label)
const open = async () => {
  await page.evaluate(() => delete window.lydia)
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Open Brush Designer').click(),
  )
  await page.waitForFunction(() => window.lydia?.engine && document.querySelector('.designer-panel'), {
    timeout: 60000,
  })
  await sleep(800)
}
const stroke = async () => {
  const at = await page.evaluate(() => {
    const { app, world: w } = window.lydia
    const b = app.canvas.getBoundingClientRect()
    return [
      [b.left + w.position.x + 100 * w.scale.x, b.top + w.position.y + 200 * w.scale.y],
      [b.left + w.position.x + 400 * w.scale.x, b.top + w.position.y + 260 * w.scale.y],
    ]
  })
  await page.mouse.move(...at[0])
  await page.mouse.down()
  await page.mouse.move(...at[1], { steps: 10 })
  await page.mouse.up()
  await sleep(500)
}
const back = async () => {
  await page.evaluate(() => {
    window.confirm = () => true
    ;[...document.querySelectorAll('button')].find(b => b.textContent === 'Back').click()
  })
  await sleep(500)
}
check('a preview, at the start', (await tryPreview('start')).endsWith('works'))
await open()
await stroke()
check(
  'the Designer, after a preview was made and freed: its test area keeps working',
  problems.length === 0,
  problems.join(' | '),
)
await back()
check('after leaving it, a new preview works', (await tryPreview('after')).endsWith('works'))
await open()
await stroke()
check(
  'the Designer opened again: a stroke, and its test area keeps working',
  problems.length === 0 && (await page.$('.designer-panel')) !== null,
  problems.join(' | '),
)
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
