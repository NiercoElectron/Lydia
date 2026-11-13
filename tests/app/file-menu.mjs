// File > New and Open in the editor, with Ctrl+N and Ctrl+O, and the question before a drawing with changes gives way:
// Save, Discard or Cancel (see UnsavedDialog.tsx), for Back too
import fs from 'node:fs'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { CACHE_DIR, LAUNCH, OUT, PORT, ROOT } from './setup.mjs'
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
page.on('dialog', d => {
  problems.push('a question of the browser: ' + d.message())
  d.dismiss()
})
await page.setViewport({ width: 1600, height: 900 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
// A button or a menu item, by the start of its text (a menu item ends with its keys)
const click = text =>
  page.evaluate(
    text => [...document.querySelectorAll('button')].find(b => b.textContent.startsWith(text)).click(),
    text,
  )
const press = async key => {
  await page.keyboard.down('Control')
  await page.keyboard.press(key)
  await page.keyboard.up('Control')
}
const ready = () =>
  page.waitForFunction(
    () => window.lydia?.engine && window.lydia.app.renderer && document.querySelectorAll('button.brush').length > 0,
    { timeout: 90000 },
  )
const size = () => page.$eval('.paper-size', element => element.textContent.trim())
const isModified = () => page.evaluate(() => window.lydia.engine.getSnapshot().isModified)
const question = () => page.$('dialog.unsaved')
const answer = async text => {
  await page.evaluate(
    text => [...document.querySelectorAll('dialog.unsaved button')].find(b => b.textContent === text).click(),
    text,
  )
  await sleep(100)
}
// The window for a new drawing, filled in and confirmed
async function create(width, height) {
  await page.waitForSelector('dialog.new-project[open]')
  const inputs = await page.$$('dialog.new-project input[type=number]')
  for (const [i, value] of [
    [0, width],
    [1, height],
  ]) {
    await inputs[i].click({ clickCount: 3 })
    await inputs[i].type(String(value))
  }
  await page.click('dialog.new-project button[type=submit]')
  await sleep(150)
}
async function paint() {
  const box = await page.$eval('.draw-space canvas', element => element.getBoundingClientRect().toJSON())
  const y = box.top + box.height / 2
  await page.mouse.move(box.left + box.width / 2 - 60, y)
  await page.mouse.down()
  await page.mouse.move(box.left + box.width / 2 + 60, y, { steps: 6 })
  await page.mouse.up()
  await sleep(200)
}
// Waiting for the next drawing's engine: the old one goes first
const forget = () => page.evaluate(() => delete window.lydia)

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('lydia')
})
await page.reload({ waitUntil: 'networkidle0' })
// Saving in a browser downloads the file: here its name is only noted
const downloads = []
await page.exposeFunction('__downloaded', name => downloads.push(name))
await page.evaluate(() => {
  const click = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) window.__downloaded(this.download)
    else click.call(this)
  }
})

await click('New project…')
await create(1000, 800)
await ready()
// A copy of this drawing as a file, to open later
const saved = await page.evaluate(async () => {
  const bytes = new Uint8Array(await (await window.lydia.engine.saveProject()).arrayBuffer())
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
})
fs.writeFileSync(OUT + '/file-menu.lyd', Buffer.from(saved, 'base64'))
await paint()
check('a drawing with changes', (await size()) === '1000 × 800 px' && (await isModified()), await size())

// ----- New -----
await press('n')
await create(640, 480)
check(
  'Ctrl+N, then Create: it asks before the drawing gives way',
  (await question()) !== null &&
    (await page.$eval('dialog.unsaved', d => d.textContent)).includes('Save the changes to this drawing?'),
)
await answer('Cancel')
check(
  'Cancel: the drawing stays, with its changes',
  (await question()) === null && (await size()) === '1000 × 800 px' && (await isModified()),
)
await forget()
await click('New project…')
await create(640, 480)
await answer('Discard')
await ready()
check('File > New project… and Discard: the new drawing', (await size()) === '640 × 480 px' && !(await isModified()))
await forget()
await press('n')
await create(500, 500)
check('without changes it asks nothing', (await question()) === null)
await ready()
check('…and the new drawing opens', (await size()) === '500 × 500 px', await size())

// ----- Open -----
await paint()
const [chooser] = await Promise.all([page.waitForFileChooser(), press('o')])
await chooser.accept([OUT + '/file-menu.lyd'])
await sleep(300)
check('Ctrl+O: the file is chosen first, then it asks', (await question()) !== null)
await forget()
await answer('Save')
await ready()
check(
  'Save: the drawing is saved first (downloaded here)',
  downloads.length === 1 && downloads[0].endsWith('.lyd'),
  downloads.join(),
)
check('…then the one chosen opens', (await size()) === '1000 × 800 px' && !(await isModified()), await size())

// ----- Back -----
await paint()
await click('Back')
await sleep(100)
check('Back asks too', (await question()) !== null)
await page.keyboard.press('Escape')
await sleep(100)
check('Esc is Cancel', (await question()) === null && (await size()) === '1000 × 800 px')
await click('Back')
await sleep(100)
await answer('Discard')
await page.waitForSelector('.home', { timeout: 10000 })
check('Discard: the start screen', (await page.$('.home')) !== null)

check('no errors', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL PASSED')
