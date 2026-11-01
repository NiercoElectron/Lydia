// The column under the color at a screen of 2560×1440 at 150%: the brush's settings fit with no scrolling, with all the
// recent colors shown, a list's name stays on one line, and the palette's two lists are side by side
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
await page.setViewport({ width: 1707, height: 810 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  const colors = Array.from({ length: 10 }, (_, each) => `#${each}0${each}0${each}0`)
  localStorage.setItem('lydia.recentColors', JSON.stringify(colors))
})
await page.reload({ waitUntil: 'networkidle0' })
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'New project…').click())
await page.waitForSelector('dialog.new-project[open]')
await page.click('button[type=submit]')
await page.waitForFunction(
  () => window.lydia?.engine && window.lydia.app.renderer && document.querySelectorAll('button.brush').length > 0,
  { timeout: 90000 },
)
await sleep(800)

const sizes = () =>
  page.evaluate(() => {
    const side = document.querySelector('.color-side')
    return { shown: side.clientHeight, needed: side.scrollHeight }
  })
const fits = await sizes()
check('the brush settings fit', fits.needed <= fits.shown, `${fits.needed} of ${fits.shown} px`)
check('with the recent colors', (await page.$$('.recent-color')).length === 10)

const lineOf = (label, selector) =>
  page.evaluate(
    (label, selector) => {
      const row = [...document.querySelectorAll('.toolbar label')].find(each => each.textContent.startsWith(label))
      return row.getBoundingClientRect().height <= row.querySelector(selector).getBoundingClientRect().height + 2
    },
    label,
    selector,
  )
check('the name of a list stays on one line', await lineOf('Brush blend', 'select'))

await page.select('.toolbar label[title^="How a stroke"] select', 'add')
await sleep(100)
check('with the longest choice too', await lineOf('Brush blend', 'select'))

const lists = await page.$$eval('.color-list', each => each.map(list => list.getBoundingClientRect().top))
check('the lists of the palette are side by side', lists.length === 2 && lists[0] === lists[1], lists.join(', '))

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
