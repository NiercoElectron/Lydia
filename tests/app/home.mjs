// The start screen (decisions 83 and 92): three columns as in Krita, what to do first with Lydia's pages, the drawings,
// and what's new; it needs no scrolling at a screen of 2560×1440 at 150%; the New project window with its list of
// sizes; Settings has the interface, the autosave and the memory with its warning, and the Brush Designer's choices have
// a window of their own, which goes on to the Brush Designer. The Recent list is the desktop app's (see desktop.mjs)
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
const columns = await page.evaluate(() =>
  ['.home-start', '.home-files', '.whats-new'].map(each =>
    Math.round(document.querySelector(each).getBoundingClientRect().left),
  ),
)
check(
  'three columns, as in Krita: what to do first, the drawings, what is new',
  columns[0] < columns[1] && columns[1] < columns[2],
  columns.join(),
)
const links = await page.$$eval('.home-links a', list => list.map(each => `${each.textContent} ${each.href}`))
check(
  'with the guide, GitHub and the form for a bug',
  links.length === 3 &&
    links[0].includes('docs/guide.md') &&
    links[1].endsWith('github.com/NiercoElectron/Lydia') &&
    links[2].includes('issues/new?template=bug.yml'),
  links.join(' | '),
)
check('no Recent list in a browser', !(await page.$('.recent')))

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
const chooseInList = name =>
  page.evaluate(
    name =>
      [...document.querySelectorAll('.new-project-sizes button')]
        .find(each => each.firstChild.textContent === name)
        .click(),
    name,
  )
await chooseInList('A3')
await sleep(50)
sizes.push(await windowSize())
const typed = () =>
  page.$$eval('dialog.new-project input[type=number]', inputs => inputs.map(each => each.value).join())
const chosenInList = () => page.$eval('.new-project-sizes [aria-selected="true"]', each => each.firstChild.textContent)
check(
  'the list of sizes, as in Krita: A3 at the resolution typed (1 DPI)',
  (await typed()) === '12,17,1' && (await chosenInList()) === 'A3',
  await typed(),
)
await chooseInList('64×64')
await sleep(50)
check('a pixel art size', (await typed()) === '64,64,1' && (await chosenInList()) === '64×64', await typed())
await typeIn(0, '65')
await sleep(50)
check('a size typed in is Custom', (await chosenInList()) === 'Custom', await chosenInList())
check(
  'the window of a new drawing keeps its size',
  sizes.every(size => size === first),
  [first, ...sizes].join(', '),
)
const rows = await page.evaluate(() => {
  const top = element => Math.round(element.getBoundingClientRect().top)
  const [width, height, dpi] = document.querySelectorAll('dialog.new-project input[type=number]')
  const button72 = [...document.querySelectorAll('dialog.new-project button')].find(b => b.textContent === '72')
  const lefts = [width, height, dpi].map(each => Math.round(each.getBoundingClientRect().left))
  return { tops: [top(width), top(height), top(dpi)], dpiButton: top(button72), lefts }
})
check(
  'each choice on a row of its own, with the fields lined up',
  rows.tops[0] < rows.tops[1] && rows.tops[1] < rows.tops[2] && new Set(rows.lefts).size === 1,
  JSON.stringify(rows),
)
check('the resolution and its buttons share a row', Math.abs(rows.dpiButton - rows.tops[2]) <= 4, JSON.stringify(rows))
const sliders = () =>
  page.$$eval('.new-project-fields input[type=range]', list => list.map(each => `${each.ariaLabel} ${each.value}`))
check(
  'the width and the height have a slider each',
  (await sliders()).join() === 'Width 65,Height 64',
  (await sliders()).join(),
)
await page.evaluate(() => {
  const slider = document.querySelector('.new-project-fields input[type=range]')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '5008')
  slider.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(50)
check(
  'the slider sets the field, a pixel at a time, from 16 to 10000',
  (await typed()).startsWith('5008,64,') &&
    (await page.$eval('.new-project-fields input[type=range]', s => `${s.min} ${s.max} ${s.step}`)) === '16 10000 1',
  await typed(),
)
check('and makes the size Custom', (await chosenInList()) === 'Custom', await chosenInList())

// ----- Presets of one's own -----
const clickText = text =>
  page.evaluate(
    text => [...document.querySelectorAll('dialog.new-project button')].find(b => b.textContent === text).click(),
    text,
  )
const presetNames = () => page.$$eval('.size-preset .size-name', list => list.map(each => each.textContent))
const groups = () => page.$$eval('.new-project-sizes h3', list => list.map(each => each.textContent))
check('no presets of my own at first', (await presetNames()).length === 0 && !(await groups()).includes('My presets'))
await typeIn(0, '2000')
await typeIn(1, '3000')
await clickText('600')
await clickText('Transparent')
const beforeName = await windowSize()
await clickText('Save as preset…')
await sleep(50)
const nameField = '.save-preset input[type=text]'
check(
  'Save as preset asks for a name, with the size to start from',
  (await page.$eval(nameField, field => [field.value, document.activeElement === field].join())) === '2000×3000,true',
)
check('the window keeps its size while the name is typed', (await windowSize()) === beforeName, await windowSize())
await page.keyboard.press('Escape')
await sleep(100)
check('Escape in the name leaves the name, not the window', await isOpen('dialog.new-project'))
check('and no preset is saved', !(await page.$(nameField)) && (await presetNames()).length === 0)
await clickText('Save as preset…')
await sleep(50)
await page.keyboard.type('Comic page')
await page.keyboard.press('Enter')
await sleep(100)
check('Enter saves the preset without making the drawing', await isOpen('dialog.new-project'))
check(
  'in a group of its own, under Custom',
  (await presetNames()).join() === 'Comic page' && (await groups())[0] === 'My presets',
  (await groups()).join(),
)
check('the preset saved is the one chosen', (await chosenInList()) === 'Comic page', await chosenInList())
const forgetLook = () => page.$eval('.preset-forget', button => getComputedStyle(button).opacity)
await page.mouse.move(5, 5)
await sleep(300)
const hidden = await forgetLook()
await page.hover('.size-preset')
await sleep(300)
check('its × shows under the pointer only', hidden === '0' && (await forgetLook()) === '1', hidden)
await chooseInList('64×64')
await sleep(50)
await clickText('Transparent')
await chooseInList('Comic page')
await sleep(50)
const transparent = () =>
  page.evaluate(
    () =>
      [...document.querySelectorAll('dialog.new-project button')]
        .find(b => b.textContent === 'Transparent')
        .getAttribute('aria-pressed') === 'true',
  )
check(
  'choosing it brings back its size, resolution and background',
  (await typed()) === '2000,3000,600' && (await transparent()),
  await typed(),
)
await typeIn(1, '3100')
await sleep(50)
check('a size changed leaves the preset', (await chosenInList()) === 'Custom', await chosenInList())
await clickText('Save as preset…')
await sleep(50)
await page.keyboard.type('Comic page')
await page.keyboard.press('Enter')
await sleep(100)
await chooseInList('64×64')
await chooseInList('Comic page')
await sleep(50)
check(
  'a preset saved with the same name takes its place',
  (await presetNames()).length === 1 && (await typed()) === '2000,3100,600',
  (await presetNames()).join() + ' ' + (await typed()),
)
await page.keyboard.press('Escape')
await sleep(100)
await pressAction(1)
await page.waitForSelector('dialog.new-project[open]')
check('the presets are still there the next time', (await presetNames()).join() === 'Comic page')
const asked = []
const answerWith = isYes => dialog => {
  asked.push(dialog.message())
  return isYes ? dialog.accept() : dialog.dismiss()
}
const no = answerWith(false)
page.once('dialog', no)
await page.click('.preset-forget')
await sleep(100)
check(
  '× asks first, and Cancel keeps it',
  asked[0] === 'Delete the preset "Comic page"? It cannot be undone.' &&
    (await presetNames()).join() === 'Comic page' &&
    (await isOpen('dialog.new-project')),
  asked.join(),
)
page.once('dialog', answerWith(true))
await page.click('.preset-forget')
await sleep(100)
check(
  '× deletes it, and its group goes with it',
  (await presetNames()).length === 0 && !(await groups()).includes('My presets'),
)
await page.keyboard.press('Escape')
await sleep(100)
await pressAction(1)
await page.waitForSelector('dialog.new-project[open]')
check('for good', (await presetNames()).length === 0)
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
