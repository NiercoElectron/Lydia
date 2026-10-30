// The color tray (decision 66): its button, keeping the brush's color in either list, picking one, taking one out;
// the list for all drawings kept by the browser, and the drawing's own saved in its file and opened with it
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
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}

const browser = await puppeteer.launch(LAUNCH)
const page = await browser.newPage()
const problems = []
page.on('pageerror', e => problems.push('PAGE ERROR ' + e))
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warn') problems.push(m.type() + ': ' + m.text())
})
await page.setViewport({ width: 1600, height: 900 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const click = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).click(), text)
await page.goto('http://localhost:5198/', { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('lydia')
})
await page.reload({ waitUntil: 'networkidle0' })

async function newDrawing() {
  await click('New project…')
  await page.waitForSelector('dialog.new-project[open]')
  const inputs = await page.$$('dialog input[type=number]')
  for (const [i, value] of [
    [0, 300],
    [1, 200],
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
}
await newDrawing()

const snapshot = () => page.evaluate(() => window.lydia.engine.getSnapshot())
const brushColor = () => page.evaluate(() => window.lydia.brush.settings.color)
const typeHex = text =>
  page.$eval(
    'input.color-hex',
    (el, text) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, text)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    text,
  )
// The colors of a list: 0, all drawings; 1, this drawing
const listColors = index =>
  page.$$eval(
    '.color-list',
    (lists, index) => [...lists[index].querySelectorAll('.tray-color')].map(b => b.title),
    index,
  )
const add = async index => {
  await page.$$eval('.color-list', (lists, index) => lists[index].querySelector('.tray-color-add').click(), index)
  await sleep(50)
}

// ----- The button -----
check('closed at first', (await page.$('.color-tray')) === null)
await page.click('.color-tray-button')
await sleep(50)
check(
  'its button opens it',
  (await page.$('.color-tray')) !== null &&
    (await page.$eval('.color-tray-button', b => b.getAttribute('aria-pressed'))) === 'true',
)

// ----- Keeping colors, picking them, taking them out -----
await typeHex('#e63946')
await add(0)
await typeHex('#2a9d8f')
await add(0)
check(
  '+ keeps the brush color at the end of the list for all drawings',
  JSON.stringify(await listColors(0)) === '["#e63946","#2a9d8f"]',
  await listColors(0),
)
check(
  "+ can't keep a color already there",
  await page.$$eval('.color-list', lists => lists[0].querySelector('.tray-color-add').disabled),
)
check('keeping one for all drawings is no change to the drawing', !(await snapshot()).isModified)
await page.click('.tray-color[title="#e63946"]')
await sleep(50)
check('a click on one makes it the brush color', (await brushColor()) === '#e63946', await brushColor())
await typeHex('#ffb4a2')
await add(1)
check(
  "+ in This drawing keeps it in the drawing's list",
  JSON.stringify(await listColors(1)) === '["#ffb4a2"]' && (await snapshot()).isModified,
  `${await listColors(1)}, modified: ${(await snapshot()).isModified}`,
)
await typeHex('#264653')
await add(0)
await page.hover('.tray-color[title="#2a9d8f"]')
await page.$eval('.tray-color[title="#2a9d8f"] + .tray-color-remove', b => b.click())
await sleep(50)
check('× takes one out', JSON.stringify(await listColors(0)) === '["#e63946","#264653"]', await listColors(0))

// ----- The drawing's colors in its file -----
const saved = await page.evaluate(async () => {
  const blob = await window.lydia.engine.saveProject()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
})
fs.writeFileSync(OUT + '/color-tray.lyd', Buffer.from(saved, 'base64'))
page.removeAllListeners('dialog')
page.on('dialog', d => d.accept())
await click('Back')
await sleep(300)
await page.evaluate(() => delete window.lydia)
await page.reload({ waitUntil: 'networkidle0' })
await newDrawing()
await page.click('.color-tray-button')
await sleep(50)
check(
  'a new drawing: the list for all drawings is kept, its own is empty',
  JSON.stringify(await listColors(0)) === '["#e63946","#264653"]' && (await listColors(1)).length === 0,
  `${await listColors(0)} | ${await listColors(1)}`,
)
await click('Back')
await sleep(300)
await page.evaluate(() => delete window.lydia)
const [chooser] = await Promise.all([page.waitForFileChooser(), click('Open project')])
await chooser.accept([OUT + '/color-tray.lyd'])
await page.waitForFunction(() => window.lydia?.engine && document.querySelectorAll('button.brush').length > 0, {
  timeout: 60000,
})
await sleep(300)
await page.click('.color-tray-button')
await sleep(50)
check(
  'the saved drawing opens with its own colors',
  JSON.stringify(await listColors(1)) === '["#ffb4a2"]' && !(await snapshot()).isModified,
  await listColors(1),
)

check('no errors or warnings on the page', problems.length === 0, problems.slice(0, 5).join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
