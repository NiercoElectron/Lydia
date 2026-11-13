// The brushes panel of decision 82: the seven categories with their counts, a category narrowing the list, the search,
// favorites and the brushes used last, which stay for the next visit, and a category from a brush file
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { CACHE_DIR, LAUNCH, OUT, PORT, ROOT, discardIfAsked } from './setup.mjs'
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
const inPanel = (selector, text) =>
  page.evaluate(
    (selector, text) => [...document.querySelectorAll(selector)].find(b => b.textContent.startsWith(text)).click(),
    selector,
    text,
  )
const shown = () =>
  page.$$eval('.brushes-list li:not([hidden]) .brush-name', names => names.map(name => name.textContent))
const openDrawing = async () => {
  await click('New project…')
  await page.waitForSelector('dialog.new-project[open]')
  await page.click('button[type=submit]')
  await page.waitForFunction(
    () => window.lydia?.engine && window.lydia.app.renderer && document.querySelectorAll('button.brush').length > 0,
    { timeout: 90000 },
  )
  await sleep(500)
}

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('lydia')
  indexedDB.deleteDatabase('lydia-autosave')
})
await page.reload({ waitUntil: 'networkidle0' })
await openDrawing()

check('all the brushes show at first', (await shown()).length === 10, (await shown()).join())
const counts = await page.$$eval('.brush-categories button', buttons =>
  buttons.map(b => [b.children[0].textContent, b.children[1].textContent].join(' ')),
)
check(
  'the seven categories have their counts',
  counts.join() === 'Basic 3,Pen 2,Watercolor 0,Artistic brush 1,Texture 2,Special 2,Materials 0',
  counts.join(),
)
await inPanel('.brush-categories button', 'Texture')
await sleep(100)
check('a category narrows the list', (await shown()).join() === 'Chalk,Sponge', (await shown()).join())
await inPanel('.brush-categories button', 'Texture')
await sleep(100)
check('and pressing it again shows them all', (await shown()).length === 10)

await page.type('.brush-search input', 'PEN')
await sleep(100)
check('the search finds a brush, any case', (await shown()).join() === 'Pencil', (await shown()).join())
await page.$eval('.brush-search input', input => input.select())
await page.keyboard.press('Backspace')
await sleep(100)
check('and the keys stay in the field', (await page.$('.text-box')) === null && (await shown()).length === 10)

await page.evaluate(() => {
  const row = [...document.querySelectorAll('.brushes-list li')].find(li => li.textContent.includes('Chalk'))
  row.querySelector('.brush-favorite').click()
})
await sleep(100)
await inPanel('.brush-tabs button', 'Favorites')
await sleep(100)
check('a favorite shows in Favorites', (await shown()).join() === 'Chalk', (await shown()).join())
await inPanel('.brush-tabs button', 'All')
await sleep(100)

const choose = name =>
  page.evaluate(
    name =>
      [...document.querySelectorAll('button.brush')]
        .find(b => b.querySelector('.brush-name').textContent === name)
        .click(),
    name,
  )
await choose('Sponge')
await sleep(300)
await choose('Pixel')
await sleep(300)
await inPanel('.brush-tabs button', 'Recent')
await sleep(100)
check(
  'Recent has the last ones used, the newest first',
  (await shown()).join() === 'Pixel,Sponge,Soft round',
  (await shown()).join(),
)
await page.screenshot({ path: OUT + '/brushes-panel.png' })

page.on('dialog', d => d.accept())
await page.evaluate(() => window.lydia.engine.getSnapshot())
await click('Back')
await discardIfAsked(page)
await sleep(300)
await openDrawing()
await inPanel('.brush-tabs button', 'Favorites')
await sleep(100)
check('favorites stay for the next time', (await shown()).join() === 'Chalk', (await shown()).join())

const fromFile = await page.evaluate(async () => {
  const { parseBrushFile, serializeBrushFile } = await import('/src/engine/brushFile.ts')
  const { builtInBrush, categoryOf } = await import('/src/brushLibrary.ts')
  const { preset, file } = builtInBrush('pencil')
  const data = JSON.parse(file)
  return {
    kept: parseBrushFile(serializeBrushFile({ ...preset, category: 'watercolor' }), 'x').category,
    odd: parseBrushFile(JSON.stringify({ ...data, category: 'nothing' }), 'x').category ?? null,
    added: categoryOf({ id: 'added/1', isBuiltIn: false, preset, file }),
  }
})
check('a brush file keeps its category', fromFile.kept === 'watercolor', fromFile.kept)
check('one it can not know is left out', fromFile.odd === null)
check('and a brush added with none goes to Special', fromFile.added === 'special', fromFile.added)

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
