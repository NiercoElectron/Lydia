// The start screen (decision 83): what to do first is all there is to see, it needs no scrolling at a screen of 2560×1440 at
// 150%, Settings has the interface, the autosave and the memory with its warning, and the Brush Designer's choices have a
// window of their own, which goes on to the Brush Designer
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
const isShown = selector =>
  page.$eval(selector, element => {
    const { width, height } = element.getBoundingClientRect()
    return width > 0 && height > 0
  })
const isOpen = selector => page.$eval(selector, dialog => dialog.open)
const pressAction = at => page.click(`.home-actions button:nth-child(${at})`)
const pressSettings = () => page.click('.home-bar .top-icon')

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('lydia.language', 'en')
})
await page.reload({ waitUntil: 'networkidle0' })

const actions = await page.$$eval('.home-actions button', buttons => buttons.map(each => each.textContent))
check('the three things to do first', actions.join() === 'New project…,Open project,Brush Designer', actions.join())
check("what's new shows the newest version open", await isShown('.whats-new details[open] li'))
check('the warning about the memory stays out of the way', !(await isShown('.danger')))
check('and so do the settings', !(await isShown('.theme-choice')))
check('and the choices of the Brush Designer', !(await isShown('.start-brush')))
const page_ = await page.evaluate(() => [document.documentElement.scrollHeight, document.documentElement.clientHeight])
check('the page needs no scrolling', page_[0] <= page_[1], page_.join(' of '))

// ----- A new drawing -----
await pressAction(1)
await page.waitForSelector('dialog.new-project[open]')
const windowSize = () =>
  page.$eval('dialog.new-project', box => {
    const { width, height } = box.getBoundingClientRect()
    return `${width}×${height}`
  })
const typeIn = async (at, value) => {
  const inputs = await page.$$('dialog.new-project input[type=number]')
  await inputs[at].click({ clickCount: 3 })
  await inputs[at].type(value)
}
const first = await windowSize()
const sizes = []
for (const dpi of ['72', '150', '600', '300']) {
  await page.evaluate(
    dpi => [...document.querySelectorAll('dialog.new-project button')].find(b => b.textContent === dpi).click(),
    dpi,
  )
  await sleep(50)
  sizes.push(await windowSize())
}
await typeIn(0, '10000')
await typeIn(1, '10000')
await typeIn(2, '1')
await sleep(50)
sizes.push(await windowSize())
const looks = await page.evaluate(() => {
  const field = document.querySelector('dialog.new-project input[type=number]')
  field.focus()
  const line = getComputedStyle(document.querySelector('.size-on-paper'))
  const hint = getComputedStyle(document.querySelector('dialog.new-project .hint'))
  return {
    isCut: field.scrollWidth > field.clientWidth,
    isHintLook: line.fontSize === hint.fontSize && line.marginLeft === hint.marginLeft,
  }
})
check('the biggest size fits in its field', !looks.isCut)
check('the size on paper looks like the line above it', looks.isHintLook)
await typeIn(0, '')
await sleep(50)
sizes.push(await windowSize())
await page.select('dialog.new-project select', 'A3')
await sleep(50)
sizes.push(await windowSize())
check(
  'the window of a new drawing keeps its size',
  sizes.every(size => size === first),
  [first, ...sizes].join(', '),
)
await page.keyboard.press('Escape')
await sleep(100)

// ----- Settings -----
await pressSettings()
await sleep(100)
check('the gear opens Settings', await isOpen('.settings-window'))
check('with the warning next to the memory', await isShown('.gpu-memory .danger'))
const fits = await page.$eval('.settings-window', box => box.getBoundingClientRect().height <= window.innerHeight)
check('all of it fits on the screen', fits)
const labels = await page.$$eval('.settings-window .theme-choice', list =>
  list.map(each => each.textContent.slice(0, 8)),
)
check('with the interface, the language and the autosave', labels.length === 3, labels.join())

await page.evaluate(() =>
  [...document.querySelectorAll('.settings-window .theme-choice button')].find(b => b.textContent === 'Light').click(),
)
await sleep(100)
check('the colors change at once', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light')
await page.select('.settings-window label.theme-choice select', 'es')
await sleep(100)
check('and the language', await isOpen('.settings-window'))
check(
  'behind it too',
  (await page.$eval('.home-actions button', b => b.textContent)) === 'Nuevo proyecto…',
  await page.$eval('.home-actions button', b => b.textContent),
)
await page.select('.settings-window label.theme-choice select', 'en')
await sleep(100)
const memory = await page.evaluate(() => {
  const select = [...document.querySelectorAll('.gpu-memory select')][0]
  const other = [...select.options].find(each => each.value !== select.value).value
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
  set.call(select, other)
  select.dispatchEvent(new Event('change', { bubbles: true }))
  return other
})
await sleep(100)
await page.click('.settings-window .window-title button')
await sleep(100)
check('the X closes it', !(await isOpen('.settings-window')))
await pressSettings()
await sleep(100)
check('and the choices are still there', (await page.$eval('.gpu-memory select', s => s.value)) === memory, memory)
await page.keyboard.press('Escape')
await sleep(100)
check('Esc closes it too', !(await isOpen('.settings-window')))
await pressSettings()
await sleep(100)
await page.keyboard.press('Escape')
await sleep(100)
check('and it opens again', !(await isOpen('.settings-window')))

// ----- The Brush Designer -----
await pressAction(3)
await sleep(100)
check('Brush Designer opens its window', await isOpen('.designer-start'))
check('and not the Brush Designer yet', (await page.$('.designer-panel')) === null)
await page.waitForFunction(() => document.querySelectorAll('.start-brush option').length > 1)
await page.select('.start-brush', await page.$eval('.start-brush option:nth-child(2)', option => option.value))
await sleep(100)
check('a brush to start from has no paper to choose', (await page.$('.tip-paper')) === null)
await page.select('.start-brush', '')
await sleep(100)
check('a new brush has', await isShown('.tip-paper'))
await page.evaluate(() =>
  [...document.querySelectorAll('.designer-start .dialog-actions button')]
    .find(b => b.textContent === 'Cancel')
    .click(),
)
await sleep(100)
check('Cancel closes it', !(await isOpen('.designer-start')))
await pressAction(3)
await sleep(100)
await page.evaluate(() =>
  [...document.querySelectorAll('.designer-start button')].find(b => b.textContent === 'Pixel').click(),
)
await sleep(100)
await page.select('.tip-paper', '32')
await page.click('.designer-start .dialog-actions button:last-child')
await page.waitForSelector('.designer-panel', { timeout: 30000 })
await page.waitForFunction(() => window.lydia?.engine, { timeout: 90000 })
check('it goes on to the Brush Designer', true)

// ----- The font -----
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' })
await page.evaluate(() => document.fonts.ready)
const fonts = await page.evaluate(async () => {
  const field = document.body.appendChild(document.createElement('input'))
  const { INCLUDED_FONTS } = await import('/src/engine/fonts.ts')
  const found = {
    isHere: [...document.fonts].some(font => font.family.includes('IBM Plex Sans') && font.status === 'loaded'),
    button: getComputedStyle(document.querySelector('.home-actions button')).fontFamily,
    field: getComputedStyle(field).fontFamily,
    isForText: INCLUDED_FONTS.includes('IBM Plex Sans'),
  }
  field.remove()
  return found
})
check('the interface has its own font', fonts.isHere, fonts.button)
check('on buttons', fonts.button.includes('IBM Plex Sans'))
check('and in fields', fonts.field.includes('IBM Plex Sans'), fonts.field)
check('without being one of the fonts of text', !fonts.isForText)

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
