// The Brush Designer: open it from the start screen, paint a tip with the mouse, the tip is cut to the painted part,
// the settings and the test area, saving (and saving again replaces), exporting, leaving, and painting with the new
// brush in a drawing
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
const dialogs = []
page.on('pageerror', e => problems.push('PAGE ERROR ' + e))
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warn') problems.push(m.type() + ': ' + m.text())
})
page.on('dialog', d => {
  dialogs.push(d.message())
  d.accept()
})
await page.setViewport({ width: 1400, height: 900 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
const button = text =>
  page.evaluateHandle(text => [...document.querySelectorAll('button')].find(b => b.textContent === text), text)
const click = async text => (await button(text)).click()
const isDisabled = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).disabled, text)
const setRange = (selector, value) =>
  page.$eval(
    selector,
    (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v))
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    value,
  )
const sliderIn = label => `.shape-controls label[title] ~ x` // unused
// The slider of a setting, by its label
const setSetting = (label, value) =>
  page.evaluate(
    (label, value) => {
      const row = [...document.querySelectorAll('.slider-row')].find(r => r.querySelector('span').textContent === label)
      const input = row.querySelector('input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    label,
    value,
  )
// How many pixels of the test area have paint
const testPaint = () =>
  page.$eval('.test-canvas', c => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++
    return n
  })
const hint = () => page.$eval('.designer-panel .hint', el => el.textContent)
// A stroke with the mouse, from paper point to paper point (the paper is shown with "Fit")
async function paperStroke(points) {
  const at = await page.evaluate(points => {
    const { app } = window.lydia
    const world = window.lydia.world
    const box = app.canvas.getBoundingClientRect()
    return points.map(([x, y]) => [
      box.left + world.position.x + x * world.scale.x,
      box.top + world.position.y + y * world.scale.y,
    ])
  }, points)
  await page.mouse.move(...at[0])
  await page.mouse.down()
  for (const p of at.slice(1)) await page.mouse.move(...p, { steps: 4 })
  await page.mouse.up()
}
const waitForTip = () =>
  page.waitForFunction(() => document.querySelector('.designer-panel .hint').textContent.startsWith('Tip:'), {
    timeout: 10000,
  })

await page.goto('http://localhost:5198/', { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('lydia')
})
await page.reload({ waitUntil: 'networkidle0' })

// ----- Opening it -----
check(
  'the start screen offers the Brush Designer, with a 512×512 paper by default',
  (await page.$eval('.designer-start .tip-paper', s => s.value)) === '512',
)
await page.select('.designer-start .tip-paper', '256')
await click('Open Brush Designer')
await page.waitForFunction(() => window.lydia?.engine && window.lydia.app.renderer, { timeout: 60000 })
await sleep(500)
check('the paper is 256×256', await page.evaluate(() => window.lydia.projection.tiles.size === 1))
check('nothing to save yet', (await isDisabled('Save to my brushes')) && (await isDisabled('Export file')))
check(
  'the test area asks for a tip first',
  (await page.$eval('.test-area', el => el.textContent)).includes('Paint the tip'),
)

// ----- Painting the tip -----
await page.evaluate(() => {
  const s = document.querySelector('.editor-bar label[title^="Brush size"] input')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(s, '20')
  s.dispatchEvent(new Event('input', { bubbles: true }))
})
await paperStroke([
  [60, 128],
  [196, 128],
]) // a horizontal bar, 136 + 20 wide and 20 tall
await waitForTip()
let text = await hint()
const [tipW, tipH] = text
  .match(/(\d+)×(\d+)/)
  .slice(1)
  .map(Number)
check(
  'the tip is cut to the painted part (a bar about 156×20, plus a small margin)',
  tipW > 150 && tipW < 170 && tipH > 18 && tipH < 30,
  text,
)
check(
  'now it can be saved and exported',
  !(await isDisabled('Save to my brushes')) && !(await isDisabled('Export file')),
)
const sample = await testPaint()
check('the test area shows the sample stroke with the new tip', sample > 1000, `${sample} px`)

// ----- Settings -----
await setSetting('Spacing', 200)
await sleep(100)
const spaced = await testPaint()
check('spacing 200%: the sample stroke breaks into separate bars', spaced < sample * 0.8, `${sample} → ${spaced} px`)
await page.click('.check-row input') // turn with the stroke
await sleep(100)
const turned = await testPaint()
check('turning with the stroke changes the sample', turned !== spaced, `${spaced} → ${turned} px`)

// ----- Scribbling in the test area, and the scribbles follow the changes -----
const area = await page.$eval('.test-canvas', c => {
  c.scrollIntoView() // the panel scrolls, on a short window
  const b = c.getBoundingClientRect()
  return { x: b.left, y: b.top, w: b.width, h: b.height }
})
await page.mouse.move(area.x + 20, area.y + 20)
await page.mouse.down()
await page.mouse.move(area.x + area.w - 20, area.y + 20, { steps: 20 })
await page.mouse.up()
const scribbled = await testPaint()
check('a stroke drawn in the test area is painted', scribbled > turned, `${turned} → ${scribbled} px`)
await setSetting('Spacing', 10)
await sleep(100)
const dense = await testPaint()
check(
  'changing a setting paints the scribble again too (spacing 10%: more paint)',
  dense > scribbled * 1.5,
  `${scribbled} → ${dense} px`,
)
await page.evaluate(() =>
  [...document.querySelectorAll('.test-controls button')].find(b => b.textContent === 'Clear').click(),
)
await sleep(100)
check(
  'Clear empties the test area (and leaves the tip)',
  (await testPaint()) === 0 && (await hint()).startsWith('Tip:'),
)

// ----- Clearing the paper, and undo -----
await click('Clear paper')
await page.waitForFunction(() => !document.querySelector('.designer-panel .hint').textContent.startsWith('Tip:'), {
  timeout: 10000,
})
check('Clear paper removes the tip', await isDisabled('Save to my brushes'))
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await waitForTip()
check('undoing Clear paper brings the tip back', !(await isDisabled('Save to my brushes')))

// ----- Undo goes back to no tip -----
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await page.waitForFunction(() => !document.querySelector('.designer-panel .hint').textContent.startsWith('Tip:'), {
  timeout: 10000,
})
check('undoing the only stroke leaves no tip to save', await isDisabled('Save to my brushes'))
await page.keyboard.down('Control')
await page.keyboard.down('Shift')
await page.keyboard.press('z')
await page.keyboard.up('Shift')
await page.keyboard.up('Control')
await waitForTip()

// ----- Name, saving, saving again -----
await page.click('.name-row input', { clickCount: 3 })
await page.keyboard.type('Bar test')
check(
  'typing the name doesn\'t trigger shortcuts (the B in "Bar")',
  (await page.$eval('button[title="Eraser (E)"]', b => b.getAttribute('aria-pressed'))) === 'false' &&
    (await page.$eval('.name-row input', i => i.value)) === 'Bar test',
)
// Painting right after typing the name: Ctrl+Z must undo the stroke, not the typing
await paperStroke([
  [60, 60],
  [196, 60],
])
await page.waitForFunction(() => window.lydia.engine.getSnapshot().canUndo, { timeout: 5000 })
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await sleep(300)
check(
  'after typing the name and painting, Ctrl+Z undoes the stroke',
  (await page.evaluate(() => window.lydia.engine.getSnapshot().canRedo)) &&
    (await page.$eval('.name-row input', i => i.value)) === 'Bar test',
)
await waitForTip()
await click('Save to my brushes')
await page.waitForFunction(
  () => document.querySelector('.designer-panel').textContent.includes('Saved to your brushes'),
  { timeout: 5000 },
)
const stored = () =>
  page.evaluate(
    () =>
      new Promise(resolve => {
        const r = indexedDB.open('lydia')
        r.onsuccess = () => {
          const g = r.result.transaction('brushes').objectStore('brushes').getAll()
          g.onsuccess = () => {
            resolve(g.result.map(b => JSON.parse(b.file)))
            r.result.close()
          }
        }
      }),
  )
let kept = await stroke_count()
async function stroke_count() {
  return (await stored()).length
}
check('saving keeps the brush in the browser', kept === 1)
check('…and Save is off until something changes', await isDisabled('Save to my brushes'))
await setSetting('Flow', 50)
check('a change turns Save on again', !(await isDisabled('Save to my brushes')))
await click('Save to my brushes')
await sleep(300)
const all = await stored()
check(
  'saving again changes the same brush instead of adding one',
  all.length === 1 &&
    all[0].flow === 0.5 &&
    all[0].name === 'Bar test' &&
    all[0].followStroke === true &&
    all[0].spacing === 0.1,
)

// ----- Exporting -----
await page.evaluate(() => {
  window.downloads = []
  HTMLAnchorElement.prototype.click = function () {
    window.downloads.push({ href: this.href, name: this.download })
  }
})
await click('Export file')
const exported = await page.evaluate(async () => {
  const d = window.downloads.at(-1)
  return { name: d.name, text: await (await fetch(d.href)).text() }
})
const parsed = JSON.parse(exported.text)
check(
  'exporting gives the same file that was saved',
  exported.name === 'bar-test.lydbrush' &&
    parsed.format === 'lydia-brush' &&
    parsed.flow === 0.5 &&
    parsed.tip === all[0].tip,
  exported.name,
)

// ----- Leaving with changes asks first -----
await setSetting('Angle', 90)
dialogs.length = 0
await page.evaluate(() => {
  window.confirm = message => {
    window.lastConfirm = message
    return false
  }
})
await click('Back')
await sleep(200)
check(
  'leaving with unsaved changes asks first (and staying keeps the Designer)',
  (await page.evaluate(() => window.lastConfirm || '')).includes('not saved') && !!(await page.$('.designer-panel')),
)
await click('Save to my brushes')
await sleep(300)
await page.evaluate(() => {
  window.lastConfirm = null
})
await click('Back')
await sleep(300)
check(
  "leaving after saving doesn't ask",
  (await page.evaluate(() => window.lastConfirm)) === null && !!(await page.$('.designer-start')),
)

// ----- The new brush in a drawing of the default size, and Ctrl+Z there (Enrico's case) -----
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'New project…').click())
await page.waitForSelector('dialog.new-project[open]')
await page.click('button[type=submit]')
await page.waitForFunction(() => window.lydia?.engine && document.querySelectorAll('button.brush').length > 6, {
  timeout: 60000,
})
await sleep(500)
check(
  'the new brush is in the list and chosen',
  (await page.$eval('button.brush[aria-pressed=true] .brush-name', e => e.textContent)) === 'Bar test',
)
const inkNow = () =>
  page.evaluate(() => {
    const { stack, gpu, app } = window.lydia
    let n = 0
    for (const key of gpu.tilesWithPaint(stack.active)) {
      const [c, r] = key.split(',').map(Number)
      const p = app.renderer.extract.pixels(gpu.getTexture(stack.active, c, r, false)).pixels
      for (let i = 3; i < p.length; i += 4) if (p[i] > 8) n++
    }
    return n
  })
await paperStroke([
  [100, 300],
  [700, 300],
])
await sleep(300)
const ink = await inkNow()
check('painting with it works', ink > 2000, `${ink} px`)
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await sleep(300)
check(
  'Ctrl+Z undoes the stroke',
  (await inkNow()) === 0 && (await page.evaluate(() => window.lydia.engine.getSnapshot().canRedo)),
)
await page.screenshot({ path: OUT + '/designer-drawing.png' })

// A picture of the Designer for the eye
await page.evaluate(() => {
  window.confirm = () => true
})
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Back').click())
await sleep(300)
await click('Open Brush Designer')
await page.waitForFunction(() => window.lydia?.engine && window.lydia.app.renderer, { timeout: 60000 })
await sleep(500)
await click('Soft')
await sleep(200)
await page.evaluate(() => {
  const s = document.querySelector('.editor-bar label[title^="Brush size"] input')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(s, '90')
  s.dispatchEvent(new Event('input', { bubbles: true }))
})
await paperStroke([
  [150, 200],
  [256, 320],
  [360, 200],
])
await setRange('.editor-bar label[title^="How much"] input', 40)
await paperStroke([
  [180, 330],
  [330, 330],
])
await waitForTip()
await setSetting('Random angle', 100)
await setSetting('Spacing', 40)
await sleep(300)
await page.screenshot({ path: OUT + '/designer.png' })

console.log(problems.length ? 'problems:\n' + problems.slice(0, 8).join('\n') : 'no errors or warnings in the console')
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
