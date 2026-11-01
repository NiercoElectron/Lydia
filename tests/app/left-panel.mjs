// The column under the color at a screen of 2560×1440 at 150%: the brush's settings fit with no scrolling, with all the
// recent colors shown, a list's name stays on one line, and the palette's two lists are side by side. In each language, no
// name or button goes past the edge of the tools or of the column under the color, and opening a list of tools moves nothing
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

// ----- In each language, with its longer names -----
const spilling = () =>
  page.evaluate(() => {
    const found = []
    for (const selector of ['.color-side', '.tool-column']) {
      const box = document.querySelector(selector)
      const { right } = box.getBoundingClientRect()
      for (const each of box.querySelectorAll('button, span')) {
        const own = each.getBoundingClientRect()
        const isShown = own.width > 0 && getComputedStyle(each).visibility === 'visible'
        if (isShown && own.right > right + 1) found.push(each.textContent)
      }
      if (box.scrollWidth > box.clientWidth) found.push(`${selector} scrolls sideways`)
    }
    return found
  })
const widths = () =>
  page.evaluate(() =>
    ['.tool-column', '.draw-space'].map(each => document.querySelector(each).getBoundingClientRect().width).join(),
  )
for (const language of ['en', 'pt-BR', 'es']) {
  await page.evaluate(language => localStorage.setItem('lydia.language', language), language)
  await page.reload({ waitUntil: 'networkidle0' })
  await page.evaluate(async language => {
    const texts = language === 'en' ? {} : Object.values(await import(`/src/translations/${language}.ts`))[0]
    const label = texts['New project…'] ?? 'New project…'
    ;[...document.querySelectorAll('button')].find(b => b.textContent === label).click()
  }, language)
  await page.waitForSelector('dialog.new-project[open]')
  await page.click('button[type=submit]')
  await page.waitForFunction(
    () => window.lydia?.engine && window.lydia.app.renderer && document.querySelectorAll('button.brush').length > 0,
    { timeout: 90000 },
  )
  await sleep(800)
  let found = await spilling()
  check(`${language}: all the names fit`, found.length === 0, found.join(', '))

  await page.click('.advanced-menu > button')
  await sleep(150)
  found = await spilling()
  check(`${language}: Advanced stays inside its column`, found.length === 0, found.join(', '))
  await page.click('.advanced-menu > button')

  await page.keyboard.press('q')
  await sleep(200)
  found = await spilling()
  check(`${language}: so do the buttons of liquify`, found.length === 0, found.join(', '))

  const closed = await widths()
  check(`${language}: the drawing starts on a whole pixel`, Number.isInteger(Number(closed.split(',')[0])), closed)
  await page.click('.tool-group > button')
  await sleep(200)
  found = await spilling()
  check(`${language}: and the filters`, found.length === 0, found.join(', '))
  check(`${language}: opening them moves nothing`, (await widths()) === closed, `${closed} and ${await widths()}`)
  await page.click('.tool-group > button')
  await page.keyboard.press('b')
}

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
