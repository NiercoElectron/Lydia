// Small screens: a laptop at 150% is 1280×720, and the window can get down to 1024×600. Nothing goes over anything else
// or off the window, and the buttons at the foot of the brushes stay reachable
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
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
await page.setViewport({ width: 1280, height: 720 })
await page.goto(`http://localhost:${PORT}/`)
await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'New project…'))
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'New project…').click())
await page.waitForSelector('dialog.new-project[open]')
await page.click('button[type=submit]')
await page.waitForFunction(() => window.lydia?.engine && document.querySelectorAll('button.brush').length > 0, {
  timeout: 60000,
})

const measure = () =>
  page.evaluate(() => {
    const box = selector => document.querySelector(selector).getBoundingClientRect()
    const size = box('.paper-size')
    return {
      categories: box('.brush-categories').bottom,
      list: box('.brushes-list').bottom,
      actions: box('.brushes-actions').top,
      actionsBottom: box('.brushes-actions').bottom,
      panel: box('.brushes-panel').bottom,
      sizeHeight: size.height,
      fontHeight: parseFloat(getComputedStyle(document.querySelector('.paper-size')).lineHeight) || 24,
      footer: box('.draw-footer').right,
      plus: Math.max(...[...document.querySelectorAll('.view-controls > *')].map(e => e.getBoundingClientRect().right)),
      space: box('.draw-space').width,
      page: document.documentElement.scrollWidth,
      width: innerWidth,
    }
  })
for (const [width, height] of [
  [1366, 768],
  [1280, 720],
  [1024, 768],
  [1024, 600],
]) {
  await page.setViewport({ width, height })
  await new Promise(resolve => setTimeout(resolve, 400))
  const at = await measure()
  const name = `${width}×${height}:`
  check(`${name} the list of brushes stops before its buttons`, at.categories <= at.actions && at.list <= at.actions)
  check(`${name} the buttons stay in their panel`, at.actionsBottom <= at.panel)
  check(`${name} the size of the paper is on one line`, at.sizeHeight <= at.fontHeight + 2, String(at.sizeHeight))
  check(`${name} the bottom bar fits`, at.plus <= at.footer + 1, `${at.plus} ${at.footer}`)
  check(`${name} nothing goes off the window`, at.page === at.width)
  check(`${name} there is room to draw`, at.space >= 200, String(at.space))
}

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
process.exit(failures ? 1 : 0)
