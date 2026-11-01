// The desktop app itself: the built pages in Electron's window, at Lydia's own address, with a drawing on the graphics card
import { execSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { PORT, ROOT } from './setup.mjs'

const electron = createRequire(import.meta.url)('electron')
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}

execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' })

const userData = mkdtempSync(path.join(tmpdir(), 'lydia-desktop-'))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.LYDIA_DEV_URL
const app = spawn(electron, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, '--lang=en-US'], {
  cwd: ROOT,
  env,
  stdio: 'ignore',
})

process.on('exit', () => app.kill()) // also when a step fails

let browser = null
for (let i = 0; i < 100 && !browser; i++) {
  await sleep(200)
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null }).catch(() => null)
}
check('the app starts', browser !== null)

let page
for (let i = 0; i < 50 && !page; i++) {
  page = (await browser.pages()).find(each => each.url().startsWith('app://'))
  if (!page) await sleep(200)
}
const problems = []
page.on('pageerror', e => problems.push('PAGE ERROR ' + e))
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warn') problems.push(m.type() + ': ' + m.text())
})
await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'New project…'))
check('at its own address', page.url() === 'app://lydia/', page.url())

const facts = await page.evaluate(async () => ({
  platform: window.lydiaDesktop?.platform,
  hasNode: typeof require !== 'undefined' || typeof process !== 'undefined',
  fontLoaded: await document.fonts.load('16px "IBM Plex Sans"').then(list => list.length > 0),
  outside: await fetch('app://lydia/..%2F..%2Fpackage.json').then(
    response => response.status,
    () => 'refused',
  ),
  opened: window.open('about:blank') === null,
}))
problems.length = 0 // the browser's own message about the file out of reach
check('it knows it is the desktop app', facts.platform === process.platform, facts.platform)
check('the page has no access to the computer', !facts.hasNode)
check('the interface font comes with it', facts.fontLoaded)
check('files outside the app are out of reach', facts.outside !== 200, String(facts.outside))
check('no other window opens', facts.opened)

await page.evaluate(() => localStorage.setItem('lydia.desktopTest', 'kept'))
await page.reload()
await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'New project…'))
const kept = await page.evaluate(() => localStorage.getItem('lydia.desktopTest'))
check('it remembers what it keeps', kept === 'kept', kept)
await page.evaluate(() => localStorage.removeItem('lydia.desktopTest'))

await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'New project…').click())
await page.waitForSelector('dialog.new-project[open]')
await page.click('button[type=submit]')
// The built app has no window.lydia (see DrawSpace.tsx): this goes by what the screen shows
await page.waitForSelector('canvas', { timeout: 60000 })
await page.waitForFunction(() => document.querySelectorAll('button.brush').length > 0, { timeout: 60000 })
await sleep(800)
const box = await page.$eval('canvas', element => {
  const { left, top, width, height } = element.getBoundingClientRect()
  return { left, top, width, height }
})
const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
const clip = { x: middle.x - 100, y: middle.y - 30, width: 200, height: 60 }
// The pixels of the screen around the stroke, once the brush's outline is away from there
await page.mouse.move(box.left + 10, box.top + 10)
await sleep(300)
const before = await page.screenshot({ clip, encoding: 'base64' })
await page.mouse.move(middle.x - 60, middle.y)
await page.mouse.down()
await page.mouse.move(middle.x + 60, middle.y, { steps: 8 })
await page.mouse.up()
await page.mouse.move(box.left + 10, box.top + 10)
await sleep(500)
const after = await page.screenshot({ clip, encoding: 'base64' })
check('it paints', before !== after)

// The interface's size, with a drawing open
await page.click('.settings-menu > button')
await page.waitForFunction(() =>
  [...document.querySelectorAll('label')].some(l => l.textContent.includes('Interface size')),
)
const sizeField = async () =>
  page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find(l => l.textContent.includes('Interface size'))
    const select = label.querySelector('select')
    return { value: select.value, ratio: window.devicePixelRatio, width: innerWidth }
  })
const wide = await sizeField()
await page.evaluate(() => {
  const label = [...document.querySelectorAll('label')].find(l => l.textContent.includes('Interface size'))
  const select = label.querySelector('select')
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '150')
  select.dispatchEvent(new Event('change', { bubbles: true }))
})
await sleep(500)
const bigger = await sizeField()
check(
  'Interface size makes it bigger',
  bigger.ratio === wide.ratio * 1.5 && bigger.width < wide.width,
  JSON.stringify(bigger),
)
const canvasPixels = await page.$eval('canvas', element => ({
  ratio: element.width / element.getBoundingClientRect().width,
}))
check('and the drawing stays sharp', Math.abs(canvasPixels.ratio - bigger.ratio) < 0.02, String(canvasPixels.ratio))
await page.reload()
await page.waitForFunction(() => document.querySelectorAll('button').length > 0)
await sleep(500)
const afterReload = await page.evaluate(() => window.devicePixelRatio)
check('and stays so', afterReload === bigger.ratio, String(afterReload))

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.disconnect()
app.kill()
await sleep(500)
try {
  rmSync(userData, { recursive: true, force: true })
} catch {
  // Windows may still hold a file for a moment; it is in the temporary folder
}
process.exit(failures ? 1 : 0)
