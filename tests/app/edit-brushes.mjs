// Changing brushes in the Brush Designer (decision 70): the list on the start screen; a brush that comes with Lydia
// opens as a copy, with its tip and settings; the user's own is saved over or as a copy; nothing to save until
// something changes; an image on the paper, undone and inverted; a tip across the whole of the biggest paper
import { writeFileSync } from 'node:fs'
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
const alerts = []
page.on('pageerror', e => problems.push('PAGE ERROR ' + e))
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warn') problems.push(m.type() + ': ' + m.text())
})
page.on('dialog', async dialog => {
  alerts.push(dialog.message())
  await dialog.accept()
})
await page.setViewport({ width: 1500, height: 1000 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
const click = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).click(), text)
const hasButton = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].some(b => b.textContent === text), text)
const isDisabled = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).disabled, text)
const hint = () => page.$eval('.designer-panel .hint', el => el.textContent)
const waitForTip = () =>
  page.waitForFunction(() => document.querySelector('.designer-panel .hint').textContent.startsWith('Tip:'), {
    timeout: 10000,
  })
const tipSize = async () =>
  (await hint())
    .match(/(\d+)×(\d+)/)
    .slice(1)
    .map(Number)
const nameValue = () => page.$eval('.name-row input', i => i.value)
const slider = label =>
  page.evaluate(label => {
    const row = [...document.querySelectorAll('.slider-row')].find(r => r.querySelector('span').textContent === label)
    return Number(row.querySelector('input').value)
  }, label)
const setSlider = (label, value) =>
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
const stored = () =>
  page.evaluate(
    () =>
      new Promise(resolve => {
        const r = indexedDB.open('lydia')
        r.onsuccess = () => {
          const g = r.result.transaction('brushes').objectStore('brushes').getAll()
          g.onsuccess = () => resolve(g.result.map(b => JSON.parse(b.file)))
        }
      }),
  )
const waitForSaved = () =>
  page.waitForFunction(() => document.querySelector('.designer-panel').textContent.includes('Saved to your brushes'), {
    timeout: 5000,
  })
const startOptions = () => page.$$eval('.start-brush option', options => options.map(o => o.textContent))
// Open the Brush Designer from the start screen on the brush with this name
async function open(name) {
  await page.waitForFunction(
    name => [...document.querySelectorAll('.start-brush option')].some(o => o.textContent === name),
    {},
    name,
  )
  await page.evaluate(name => {
    const select = document.querySelector('.start-brush')
    const option = [...select.options].find(o => o.textContent === name)
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, option.value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }, name)
  await sleep(100)
  await click('Open Brush Designer')
  await page.waitForFunction(() => window.lydia?.engine && document.querySelector('.designer-panel'), {
    timeout: 60000,
  })
  await waitForTip()
  await sleep(300)
}
async function back() {
  await click('Back')
  await page.waitForSelector('.designer-start')
  await sleep(300)
}
// Choose an image with the "Use image…" button's input
async function useImage(path) {
  const input = await page.$('.designer-panel .designer-actions input[type=file]')
  await input.uploadFile(path)
  await sleep(800)
}
// How much the paper shows painted: the share of its pixels that aren't white
const painted = () =>
  page.evaluate(async () => {
    const { engine } = window.lydia
    const bitmap = await createImageBitmap(await engine.exportImage('png'))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0)
    const d = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
    let count = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] < 250) count++
    return count / (d.length / 4)
  })

await page.goto('http://localhost:5198/', { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('lydia')
})
await page.reload({ waitUntil: 'networkidle0' })

// ----- The list on the start screen -----
await page.waitForFunction(() => document.querySelectorAll('.start-brush option').length > 1)
const options = await startOptions()
check('the list starts with a new brush', options[0] === 'A new brush', options.join(', '))
check(
  'it has the brushes, without the Pixel brush, whose tip has no picture',
  options.includes('Chalk') && options.includes('Pencil') && !options.includes('Pixel'),
)
check('the paper is chosen for a new brush', !!(await page.$('.tip-paper')))

// ----- A brush that comes with Lydia -----
await open('Pencil')
check('it opens as a copy', (await nameValue()) === 'Pencil copy', await nameValue())
const [pencilWidth] = await tipSize()
check('with its tip, cut as it was', pencilWidth >= 60 && pencilWidth <= 68, String(pencilWidth))
check('with its settings', (await slider('Spacing')) === 5 && (await slider('Depth')) === 75)
check(
  'and its grain',
  await page.$$eval('.grain-pictures button', bs =>
    bs.some(b => b.textContent === 'Custom' && b.ariaPressed === 'true'),
  ),
)
check('the start is not a step of undo', !(await page.evaluate(() => window.lydia.engine.getSnapshot().canUndo)))
check('with nothing changed, nothing to save', await isDisabled('Save to my brushes'))
check('no copy button yet: saving makes the copy', !(await hasButton('Save copy')))
await (await page.$('.designer-panel')).screenshot({ path: OUT + '/edit-brushes.png' })

await setSlider('Flow', 40)
await sleep(300)
check('a change can be saved', !(await isDisabled('Save to my brushes')))
await click('Save to my brushes')
await waitForSaved()
let brushes = await stored()
check(
  'saved as a new brush, with the grain',
  brushes.length === 1 && brushes[0].name === 'Pencil copy' && brushes[0].flow === 0.4 && !!brushes[0].grain,
  JSON.stringify(brushes.map(b => [b.name, b.flow])),
)
await back()
check('Pencil is still in the list', (await startOptions()).includes('Pencil'))

// ----- The user's own brush -----
await open('Pencil copy')
check('it keeps its name', (await nameValue()) === 'Pencil copy')
check('its flow is the saved one', (await slider('Flow')) === 40)
check('nothing to save yet', await isDisabled('Save changes'))
await setSlider('Flow', 60)
await sleep(300)
await click('Save changes')
await waitForSaved()
brushes = await stored()
check('saving changes it', brushes.length === 1 && brushes[0].flow === 0.6, JSON.stringify(brushes.map(b => b.flow)))
await setSlider('Flow', 70)
await sleep(300)
await click('Save copy')
await page.waitForFunction(() => document.querySelector('.name-row input').value === 'Pencil copy copy')
await sleep(300)
brushes = await stored()
check(
  'Save copy leaves it as it was, and keeps another',
  brushes.length === 2 && brushes[0].flow === 0.6 && brushes[1].flow === 0.7 && brushes[1].name === 'Pencil copy copy',
  JSON.stringify(brushes.map(b => [b.name, b.flow])),
)
await setSlider('Flow', 80)
await sleep(300)
await click('Save changes')
await sleep(500)
brushes = await stored()
check(
  'from then on, saving changes the copy',
  brushes.length === 2 && brushes[0].flow === 0.6 && brushes[1].flow === 0.8,
)
await back()

// ----- An image on the paper -----
// A dark square on the left half of a white image, and an image bigger than the biggest paper, all black
const png = await page.evaluate(() => {
  const make = (size, draw) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    draw(ctx)
    return canvas.toDataURL('image/png').split(',')[1]
  }
  return {
    half: make(100, ctx => {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, 100, 100)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, 50, 100)
    }),
    black: make(2048, ctx => ctx.fillRect(0, 0, 2048, 2048)),
  }
})
writeFileSync(OUT + '/half.png', Buffer.from(png.half, 'base64'))
writeFileSync(OUT + '/black.png', Buffer.from(png.black, 'base64'))
writeFileSync(OUT + '/not-an-image.png', 'not an image')

await page.select('.designer-start .tip-paper', '256')
await click('Open Brush Designer')
await page.waitForFunction(() => window.lydia?.engine && document.querySelector('.designer-panel'), { timeout: 60000 })
await sleep(500)
check('Invert waits for a tip', await isDisabled('Invert'))
await useImage(OUT + '/half.png')
await waitForTip()
check('dark places of the image paint', near(await tipSize(), [54, 104]), (await tipSize()).join('×'))
const share = await painted()
check('at its own size, in the middle of the paper', Math.abs(share - (50 * 100) / 256 ** 2) < 0.005, share.toFixed(4))
await click('Undo')
await page.waitForFunction(() => !document.querySelector('.designer-panel .hint').textContent.startsWith('Tip:'), {
  timeout: 5000,
})
check('it can be undone', (await painted()) === 0)
await click('Redo')
await waitForTip()
await click('Invert')
await sleep(800)
const inverted = await painted()
check('Invert paints what did not', Math.abs(inverted - (1 - share)) < 0.005, inverted.toFixed(4))
await click('Undo')
await sleep(500)
check('that can be undone too', Math.abs((await painted()) - share) < 0.005)

// It can be painted over: the tip is made from the paper as it is
const box = await (await page.$('.draw-space canvas')).boundingBox()
await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2 + 200)
await page.mouse.down()
await page.mouse.move(box.x + box.width / 2 + 210, box.y + box.height / 2 + 210, { steps: 3 })
await page.mouse.up()
await sleep(800)
const [retouched] = await tipSize()
check('it can be retouched with the brush', retouched > 104, String(retouched))

await useImage(OUT + '/not-an-image.png')
check(
  'a file that is not an image: LYD-301',
  alerts.at(-1) === 'LYD-301: Not an image Lydia can open.',
  String(alerts.at(-1)),
)
await page.evaluate(() => {
  window.confirm = () => true
})
await back()

// ----- A tip across the whole of the biggest paper -----
await page.select('.designer-start .tip-paper', '1024')
await click('Open Brush Designer')
await page.waitForFunction(() => window.lydia?.engine && document.querySelector('.designer-panel'), { timeout: 60000 })
await sleep(500)
await useImage(OUT + '/black.png')
await waitForTip()
await sleep(500)
check('the whole of the paper fits in a tip', (await tipSize()).join() === '1024,1024', (await tipSize()).join('×'))
await click('Save to my brushes')
await waitForSaved()
const opensAgain = await page.evaluate(async () => {
  const { parseBrushFile, serializeBrushFile } = await import('/src/engine/brushFile.ts')
  const records = await new Promise(resolve => {
    const r = indexedDB.open('lydia')
    r.onsuccess = () => {
      const g = r.result.transaction('brushes').objectStore('brushes').getAll()
      g.onsuccess = () => resolve(g.result)
    }
  })
  return serializeBrushFile(parseBrushFile(records.at(-1).file, 'x')).length > 0
})
check('and its file opens again', opensAgain)
await back()

// ----- A pixel brush: the image's pixels paint fully or not at all -----
await page.evaluate(() =>
  [...document.querySelectorAll('.designer-start button')].find(b => b.textContent === 'Pixel').click(),
)
await sleep(100)
await page.select('.designer-start .tip-paper', '32')
await click('Open Brush Designer')
await page.waitForFunction(() => window.lydia?.engine && document.querySelector('.designer-panel'), { timeout: 60000 })
await sleep(500)
await useImage(OUT + '/half.png')
await waitForTip()
check('a pixel brush takes an image too', near(await tipSize(), [16, 32], 1), (await tipSize()).join('×'))

await back()

// ----- A soft tip through the paper and back: its paint stays as it was -----
await open('Airbrush')
await setSlider('Flow', 20)
await sleep(300)
await click('Save to my brushes')
await waitForSaved()
const soft = await page.evaluate(async () => {
  const { parseBrushFile } = await import('/src/engine/brushFile.ts')
  const { decodeTip } = await import('/src/engine/brushTip.ts')
  const { default: original } = await import('/src/brushes/airbrush.lydbrush?raw')
  const records = await new Promise(resolve => {
    const r = indexedDB.open('lydia')
    r.onsuccess = () => {
      const g = r.result.transaction('brushes').objectStore('brushes').getAll()
      g.onsuccess = () => resolve(g.result)
    }
  })
  const paintOf = async file => {
    const { image } = await decodeTip(parseBrushFile(file, 'x').tip)
    const d = image.getContext('2d').getImageData(0, 0, image.width, image.height).data
    let sum = 0
    for (let i = 3; i < d.length; i += 4) sum += d[i]
    return sum
  }
  return { before: await paintOf(original), after: await paintOf(records.at(-1).file) }
})
check(
  'a soft tip keeps its paint through the paper',
  Math.abs(soft.after / soft.before - 1) < 0.01,
  `${soft.before} → ${soft.after}`,
)

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)

function near(values, expected, within = 2) {
  return values.every((value, i) => Math.abs(value - expected[i]) <= within)
}
