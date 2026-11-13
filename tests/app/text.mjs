// Text (decision 81): how its lines are laid out; typing on the drawing, with accents, and the keys staying in the text
// box; one step of undo; the picture coming out where the text box had it; Edit text, Esc and the tiles in RAM; the
// style, the color panel and the view while typing; the fonts that come with Lydia; a transform writing the letters
// again, sharp; the move tool; painting blocked, Convert to pixels, and a duplicate; a font that isn't here; the saved
// file, opened again and still editable, and its autosave
import fs from 'node:fs'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { CACHE_DIR, LAUNCH, OUT, PORT, ROOT, discardIfAsked } from './setup.mjs'
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
await page.setViewport({ width: 1600, height: 1000 })
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
const press = async key => {
  await page.keyboard.press(key)
  await sleep(100)
}
const snapshot = () => page.evaluate(() => window.lydia.engine.getSnapshot())
const waitIdle = async () => {
  await sleep(100)
  await page.waitForFunction(
    () => {
      const snap = window.lydia.engine.getSnapshot()
      return !snap.task && !snap.isUpdating && !window.lydia.projection.isUpdating()
    },
    { timeout: 60000, polling: 20 },
  )
  await sleep(150)
}
const pageOf = (x, y) =>
  page.evaluate(
    (x, y) => {
      const { app, world } = window.lydia
      const box = app.canvas.getBoundingClientRect()
      const p = world.toGlobal({ x, y })
      return { x: box.left + p.x, y: box.top + p.y }
    },
    x,
    y,
  )
const clickAt = async (x, y) => {
  const at = await pageOf(x, y)
  await page.mouse.click(at.x, at.y)
  await sleep(150)
}
const dragHandle = async (from, to) => {
  const a = await pageOf(...from)
  const b = await pageOf(...to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 10 })
  await page.mouse.up()
  await sleep(100)
}
const typeWords = words => page.keyboard.type(words)
const finish = async () => {
  await page.keyboard.down('Control')
  await page.keyboard.press('Enter')
  await page.keyboard.up('Control')
  await waitIdle()
}
const transformGone = async () => {
  await page.waitForFunction(() => window.lydia.engine.getSnapshot().transform === null)
  await waitIdle()
}
const startTransform = async () => {
  await page.evaluate(() => window.lydia.engine.startTransform())
  await page.waitForFunction(() => window.lydia.engine.getSnapshot().transform !== null)
  await sleep(200)
}
const active = () =>
  page.evaluate(() => {
    const { name, smart } = window.lydia.stack.active
    return { name, text: smart?.text, bounds: smart?.bounds, corners: smart?.corners }
  })
const SIDE = 1200
const pixelsOf = () =>
  page.evaluate(SIDE => {
    const { app, gpu, stack } = window.lydia
    const out = new Array(SIDE * SIDE * 4).fill(0)
    const count = Math.ceil(SIDE / 256)
    for (let row = 0; row < count; row++) {
      for (let column = 0; column < count; column++) {
        const texture = gpu.getTexture(stack.active, column, row, false)
        if (!texture) continue
        const { pixels } = app.renderer.extract.pixels(texture)
        for (let y = 0; y < 256; y++) {
          const py = row * 256 + y
          if (py >= SIDE) break
          for (let x = 0; x < 256; x++) {
            const px = column * 256 + x
            if (px >= SIDE) continue
            for (let c = 0; c < 4; c++) out[(py * SIDE + px) * 4 + c] = pixels[(y * 256 + x) * 4 + c]
          }
        }
      }
    }
    return out
  }, SIDE)
const alphaAt = (list, x, y) => list[(y * SIDE + x) * 4 + 3]
const paintBox = list => {
  const box = { left: SIDE, right: -1, top: SIDE, bottom: -1, count: 0 }
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      if (alphaAt(list, x, y) < 128) continue
      box.count++
      box.left = Math.min(box.left, x)
      box.right = Math.max(box.right, x)
      box.top = Math.min(box.top, y)
      box.bottom = Math.max(box.bottom, y)
    }
  }
  return box
}
// How much of the letters is soft edge: pixels in between, for each pixel of full paint
const softness = list => {
  let soft = 0
  let painted = 0
  for (let i = 3; i < list.length; i += 4) {
    if (list[i] > 40 && list[i] < 215) soft++
    if (list[i] >= 215) painted++
  }
  return soft / painted
}
const near = (a, b, by = 1) => Math.abs(a - b) <= by
const shownAt = (x, y) => page.evaluate((x, y) => window.lydia.projection.colorAt(x, y), x, y)
const diff = (a, b) => {
  let count = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++
  return count
}

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('lydia')
  indexedDB.deleteDatabase('lydia-autosave')
})
await page.reload({ waitUntil: 'networkidle0' })
await click('New project…')
await page.waitForSelector('dialog.new-project[open]')
const inputs = await page.$$('dialog input[type=number]')
for (const i of [0, 1]) {
  await inputs[i].click({ clickCount: 3 })
  await inputs[i].type(String(SIDE))
}
await page.click('button[type=submit]')
await page.waitForFunction(
  () => window.lydia?.engine && window.lydia.app.renderer && document.querySelectorAll('button.brush').length > 0,
  { timeout: 90000 },
)
await sleep(800)
// So that a text box and what comes out of it can be compared
await page.addStyleTag({ content: '.text-box { outline: none !important; caret-color: transparent !important; }' })

// ----- The lines -----
const math = await page.evaluate(async () => {
  const { layoutText, stretchOf, textInProject, needsNewSource } = await import('/src/engine/text.ts')
  const { rectQuad } = await import('/src/engine/smartObject.ts')
  const style = { font: 'Inter', size: 100, color: '#000000', isBold: false, isItalic: false, align: 'left' }
  await document.fonts.load('100px "Inter"')
  const left = layoutText('Ab\nAbcd', style)
  const center = layoutText('Ab\nAbcd', { ...style, align: 'center' })
  const right = layoutText('Ab\nAbcd', { ...style, align: 'right' })
  const box = { x: -1, y: 0, width: 100, height: 50 }
  const bounds = { x: 0, y: 0, width: 100, height: 50 }
  const good = { ...style, words: 'hi', box }
  return {
    lineHeight: left.lineHeight,
    leftStarts: left.lines.map(line => line.x),
    secondLine: left.lines[1].y - left.lines[0].y,
    centered: center.lines.map(line => line.x + line.width / 2),
    rightEnds: right.lines.map(line => line.x + line.width),
    isBoxWhole: Object.values(left.box).every(Number.isInteger),
    stretch: stretchOf(box, rectQuad({ x: 10, y: 10, width: 200, height: 150 })),
    stays: needsNewSource(good, bounds, rectQuad({ x: 7, y: 9, width: 100, height: 50 })),
    grows: needsNewSource(good, bounds, rectQuad({ x: 7, y: 9, width: 200, height: 50 })),
    junk: [
      textInProject(null),
      textInProject({ ...good, size: 1 }),
      textInProject({ ...good, color: 'red' }),
      textInProject({ ...good, align: 'up' }),
      textInProject({ ...good, box: { x: 0, y: 0, width: 0, height: 5 } }),
    ],
    fine: textInProject(good) !== null,
  }
})
check('the lines go down by their height', math.lineHeight === 125 && math.secondLine === 125, `${math.secondLine}`)
check('on the left they start together', math.leftStarts.join() === '0,0', math.leftStarts.join())
check(
  'in the center their middles meet',
  math.centered.every(x => near(x, 0, 0.01)),
  math.centered.join(),
)
check(
  'on the right their ends meet',
  math.rightEnds.every(x => near(x, 0, 0.01)),
  math.rightEnds.join(),
)
check('the box is on whole pixels', math.isBoxWhole)
check('a stretch is measured each way', near(math.stretch.x, 2, 0.001) && near(math.stretch.y, 3, 0.001))
check('moving needs no new source, and growing does', !math.stays && math.grows)
check('a text that makes no sense is left out', math.junk.every(each => each === null) && math.fine)

// ----- Typing -----
let snap = await snapshot()
const layersAtFirst = snap.layers.length
await press('t')
check('T chooses it', await hasButton('Edit text'))
check('and with no text on the layer, Edit text waits', await isDisabled('Edit text'))
await page.evaluate(() => {
  window.lydia.engine.setBrush({ color: '#ff0000' })
  window.lydia.engine.setTextStyle({ size: 80 })
})
await clickAt(100, 200)
await page.waitForSelector('.text-box')
check(
  'it is typed on the drawing, in the box',
  await page.evaluate(() => document.activeElement === document.querySelector('.text-box')),
)
check('the bar has Done and Cancel', (await hasButton('Done')) && (await hasButton('Cancel')))
await typeWords('Olá, ação bvm')
await press('Enter')
await typeWords('segunda')
snap = await snapshot()
check('keys go to the words', snap.typing.words === 'Olá, ação bvm\nsegunda', JSON.stringify(snap.typing.words))
check('and no shortcut goes off', (await page.$('.text-box')) !== null)
check('no layer until it is done', snap.layers.length === layersAtFirst)
check('it takes the color chosen', snap.typing.style.color === '#ff0000', snap.typing.style.color)
const blocked = await page.evaluate(() => {
  const { engine } = window.lydia
  const before = engine.getSnapshot().layers.length
  engine.addLayer()
  engine.startTransform()
  return engine.getSnapshot().layers.length === before && !engine.getSnapshot().transform
})
check('nothing else starts meanwhile', blocked)

const box = await page.evaluate(() => {
  const rect = document.querySelector('.text-box').getBoundingClientRect()
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
})
const inkOf = async () => {
  const shot = await page.screenshot({ encoding: 'base64', clip: box })
  return page.evaluate(
    async (shot, width, height) => {
      const image = new Image()
      image.src = 'data:image/png;base64,' + shot
      await image.decode()
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0, width, height)
      const { data } = context.getImageData(0, 0, width, height)
      let [left, right, top, bottom] = [width, -1, height, -1]
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4 + 1] > 128) continue // red on white: its green tells
          left = Math.min(left, x)
          right = Math.max(right, x)
          top = Math.min(top, y)
          bottom = Math.max(bottom, y)
        }
      }
      return { left, right, top, bottom }
    },
    shot,
    Math.ceil(box.width),
    Math.ceil(box.height),
  )
}
const typed = await inkOf()
await page.screenshot({ path: OUT + '/text-typing.png' })
await finish()
await page.screenshot({ path: OUT + '/text-done.png' })
const written = await inkOf()
check(
  'the letters come out where the box had them',
  near(typed.left, written.left, 2) &&
    near(typed.right, written.right, 2) &&
    near(typed.top, written.top, 2) &&
    near(typed.bottom, written.bottom, 2),
  `${JSON.stringify(typed)} and ${JSON.stringify(written)}`,
)
snap = await snapshot()
let now = await active()
check('it is a new layer', snap.layers.length === layersAtFirst + 1 && snap.isTextLayer)
check('named after its first line', now.name === 'Olá, ação bvm', now.name)
check('its source is as big as its box', now.bounds.width === now.text.box.width, JSON.stringify(now.bounds))
check('its layer shows the icon of a text', (await page.$('.smart-icon[aria-label="Text"]')) !== null)
let list = await pixelsOf()
const first = paintBox(list)
check('with its letters', first.count > 2000 && first.left >= 100 && first.top > 150, JSON.stringify(first))
await click('Undo')
await waitIdle()
snap = await snapshot()
check('one undo takes it all away', snap.layers.length === layersAtFirst)
await click('Redo')
await waitIdle()
check('and redo brings it back', (await snapshot()).isTextLayer && diff(await pixelsOf(), list) === 0)
await clickAt(600, 600)
await page.waitForSelector('.text-box')
await press('Escape')
check('Esc leaves nothing', (await snapshot()).layers.length === layersAtFirst + 1 && !(await page.$('.text-box')))
await clickAt(600, 600)
await page.waitForSelector('.text-box')
await clickAt(700, 900)
await waitIdle()
check(
  'nor does a text with no words',
  (await snapshot()).layers.length === layersAtFirst + 1 && !(await page.$('.text-box')),
)
await clickAt(600, 600)
await page.waitForSelector('.text-box')
await typeWords('fora')
await clickAt(700, 900)
await waitIdle()
check('a click outside ends it', (await active()).text?.words === 'fora' && !(await page.$('.text-box')))
await click('Undo')
await waitIdle()
await clickAt(600, 600)
await page.waitForSelector('.text-box')
await typeWords('outra')
await page.evaluate(() => window.lydia.engine.setTool('move'))
await waitIdle()
check('so does choosing another tool', (await active()).text?.words === 'outra' && !(await page.$('.text-box')))
await click('Undo')
await waitIdle()
await page.evaluate(() => window.lydia.engine.setTool('text'))

// ----- Following the view -----
await clickAt(600, 600)
await page.waitForSelector('.text-box')
await typeWords('zoom')
await sleep(100)
const widthOf = () => page.evaluate(() => document.querySelector('.text-box').getBoundingClientRect().width)
const before = await widthOf()
const over = await page.evaluate(() => {
  const rect = document.querySelector('.text-box').getBoundingClientRect()
  return { x: rect.left + 10, y: rect.top + 10 }
})
await page.mouse.move(over.x, over.y)
await page.keyboard.down('Control')
await page.mouse.wheel({ deltaY: -300 })
await page.keyboard.up('Control')
await sleep(300)
const after = await widthOf()
const pageZoom = await page.evaluate(() => window.visualViewport.scale)
check(
  'the box zooms with the drawing, under the wheel too, and not the page',
  after > before * 1.1 && pageZoom === 1,
  `${before} to ${after}`,
)
const leftBefore = await page.evaluate(() => document.querySelector('.text-box').getBoundingClientRect().left)
await page.mouse.wheel({ deltaX: 40 })
await sleep(300)
const leftAfter = await page.evaluate(() => document.querySelector('.text-box').getBoundingClientRect().left)
check('and moves with it', near(leftAfter, leftBefore - 40, 2), `${leftBefore} to ${leftAfter}`)
await page.evaluate(() => window.lydia.engine.turnView(30))
await sleep(200)
const turned = await page.evaluate(() => document.querySelector('.text-box').style.transform)
check('and turns with it', turned.startsWith('matrix(') && !turned.includes(', 0, 0,'), turned)
await press('Escape')
await page.evaluate(() => {
  window.lydia.engine.turnView(0)
  window.lydia.engine.fitToScreen()
})
await sleep(200)

// ----- Edit text -----
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#0000ff' }))
list = await pixelsOf()
check('Edit text can be used', !(await isDisabled('Edit text')))
await click('Edit text')
await page.waitForSelector('.text-box')
await waitIdle()
snap = await snapshot()
check('it opens with its words and style', snap.typing.words.startsWith('Olá') && snap.typing.style.color === '#ff0000')
const hidden = await page.evaluate(({ left, right, top, bottom }) => {
  const { projection } = window.lydia
  const seen = new Set()
  for (let x = left; x <= right; x += 3) {
    for (let y = top; y <= bottom; y += 3) seen.add(projection.colorAt(x, y))
  }
  return [...seen]
}, first)
check('the picture stops showing it', hidden.length === 1, hidden.join())
const whileTyping = await page.evaluate(async () => {
  const blob = await window.lydia.engine.saveProject()
  const { stack, memory } = window.lydia
  const painted = [...stack.active.tiles.values()].filter(tile => tile).length
  return { size: blob.size, painted, hasMemory: memory !== undefined }
})
check('and what is in RAM stays, for a save meanwhile', whileTyping.painted > 0, JSON.stringify(whileTyping))
await press('Escape')
await waitIdle()
check('Esc shows it as it was', diff(await pixelsOf(), list) === 0)
await click('Edit text')
await page.waitForSelector('.text-box')
await page.keyboard.down('Control')
await press('a')
await page.keyboard.up('Control')
await typeWords('Novo')
await page.evaluate(() => window.lydia.engine.setBrush({ color: '#00ff00' }))
await sleep(100)
await page.select('.text-font', 'Lora')
await page.evaluate(() => window.lydia.engine.setTextStyle({ size: 100, isBold: true }))
await sleep(200)
check(
  'the keyboard stays in the box',
  await page.evaluate(() => document.activeElement === document.querySelector('.text-box')),
)
await typeWords('!')
await finish()
now = await active()
check('the words change', now.text.words === 'Novo!', now.text.words)
check(
  'and the font, the size and the color',
  now.text.font === 'Lora' && now.text.size === 100 && now.text.color === '#00ff00' && now.text.isBold,
)
check('the layer follows its name', now.name === 'Novo!', now.name)
await click('Undo')
await waitIdle()
now = await active()
check(
  'one undo goes back',
  now.text.words.startsWith('Olá') && now.name.startsWith('Olá') && diff(await pixelsOf(), list) === 0,
)

// ----- The fonts -----
const fonts = await page.evaluate(async () => {
  const { INCLUDED_FONTS, isFontHere, canListFonts } = await import('/src/engine/fonts.ts')
  const context = new OffscreenCanvas(1, 1).getContext('2d')
  const widths = {}
  for (const font of INCLUDED_FONTS) {
    await document.fonts.load(`40px "${font}"`, 'ação ñ ç ß')
    context.font = `40px "${font}", sans-serif`
    widths[font] = context.measureText('Ação Ñandú').width
  }
  return {
    widths,
    here: INCLUDED_FONTS.every(isFontHere),
    missing: isFontHere('No Such Font At All'),
    system: isFontHere('Arial'),
    canList: canListFonts(),
  }
})
check(
  'all nine fonts come with Lydia',
  Object.keys(fonts.widths).length === 9 && fonts.here,
  JSON.stringify(fonts.widths),
)
check('each with its own letters', new Set(Object.values(fonts.widths)).size === 9)
check('a font that is not here is told apart', !fonts.missing && fonts.system)
check('the browser can list the fonts of the computer', fonts.canList && (await hasButton('Computer fonts')))

// ----- A transform -----
await click('Undo')
await waitIdle()
await page.evaluate(() => {
  const { engine } = window.lydia
  engine.setBrush({ color: '#000000' })
  engine.setTextStyle({ size: 40, isBold: false, font: 'Inter', align: 'left' })
})
await clickAt(200, 300)
await page.waitForSelector('.text-box')
await typeWords('Illi')
await finish()
const small = await active()
const smallSoft = softness(await pixelsOf())
await startTransform()
const [a, , c] = small.corners
const growth = 5
await dragHandle([c.x, c.y], [a.x + (c.x - a.x) * growth, a.y + (c.y - a.y) * growth])
await page.keyboard.press('Enter')
await transformGone()
const big = await active()
check(
  'a transform writes it again, as big as it shows',
  near(big.bounds.width / small.bounds.width, growth, 0.15) && big.text.words === 'Illi',
  `${small.bounds.width} to ${big.bounds.width}`,
)
const bigList = await pixelsOf()
const bigSoft = softness(bigList)
check(
  'so it keeps its sharp edges',
  bigSoft < smallSoft / 3,
  `${smallSoft.toFixed(3)} of soft pixels at 40, ${bigSoft.toFixed(3)} at 200`,
)
await click('Undo')
await waitIdle()
check('one undo goes back', (await active()).bounds.width === small.bounds.width)
await click('Redo')
await waitIdle()
await page.evaluate(() => window.lydia.engine.setTextStyle({ size: 200 }))
await clickAt(200, 700)
await page.waitForSelector('.text-box')
await typeWords('Illi')
await finish()
const direct = paintBox(await pixelsOf())
await click('Undo')
await waitIdle()
check(
  'and it looks like a text written that big',
  near(direct.count, paintBox(bigList).count, direct.count * 0.04),
  `${direct.count} and ${paintBox(bigList).count} pixels`,
)
await page.evaluate(() => window.lydia.engine.setTool('move'))
await dragHandle([big.corners[0].x + 30, big.corners[0].y + 30], [big.corners[0].x + 130, big.corners[0].y + 80])
await sleep(300)
await transformGone()
now = await active()
check(
  'the move tool moves it, with the same source',
  now.bounds.width === big.bounds.width && near(now.corners[0].x, big.corners[0].x + 100, 3),
  JSON.stringify(now.corners[0]),
)
await page.evaluate(() => window.lydia.engine.setTool('text'))
await click('Edit text')
await page.waitForSelector('.text-box')
await press('End')
await typeWords('i')
await finish()
const longer = await active()
const ratio = (longer.corners[1].x - longer.corners[0].x) / longer.text.box.width
check(
  'editing it keeps it where the transform took it, and as big',
  near(longer.corners[0].y, now.corners[0].y, 8) &&
    near(ratio, growth, 0.15) &&
    near(longer.bounds.width / longer.text.box.width, growth, 0.15),
  `${ratio.toFixed(2)} times`,
)

// ----- What it can't do -----
check('filters ask for pixels first', !(await snapshot()).canFilter)
await press('b')
await sleep(150)
check(
  'painting is blocked, and the bar says why',
  await page.evaluate(() => document.querySelector('.toolbar').textContent.includes('This layer is a text')),
)
const copyWords = await page.evaluate(() => {
  const { engine, stack } = window.lydia
  engine.duplicateLayer()
  return stack.active.smart?.text?.words
})
await waitIdle()
check('a copy is a text too', copyWords === 'Illii', copyWords)
await click('Convert to pixels')
await waitIdle()
check('Convert to pixels frees it', !(await snapshot()).isTextLayer && (await active()).text === undefined)
await click('Undo')
await waitIdle()
check('and can be undone', (await snapshot()).isTextLayer)
await click('Undo')
await waitIdle()

// ----- A font that isn't here -----
await page.evaluate(() => {
  const { smart } = window.lydia.stack.active
  smart.text = { ...smart.text, font: 'No Such Font At All' }
})
const lost = await active()
await startTransform()
const corner = lost.corners[2]
await dragHandle([corner.x, corner.y], [corner.x - 200, corner.y - 50])
await page.keyboard.press('Enter')
await transformGone()
const lostAfter = await active()
check(
  'without its font a transform keeps its source',
  lostAfter.bounds.width === lost.bounds.width && lostAfter.text.font === 'No Such Font At All',
  `${lost.bounds.width} and ${lostAfter.bounds.width}`,
)
await press('t')
await click('Edit text')
await page.waitForSelector('.text-box')
await sleep(100)
check(
  'and Edit text says so',
  await page.evaluate(() => document.querySelector('.toolbar').textContent.includes("isn't on this computer")),
)
await press('Escape')
await page.evaluate(() => {
  const { smart } = window.lydia.stack.active
  smart.text = { ...smart.text, font: 'Inter' }
})

// ----- A text wider than the paper, the file, and the autosave -----
await page.evaluate(() => window.lydia.engine.setTextStyle({ size: 400 }))
await clickAt(900, 100)
await page.waitForSelector('.text-box')
await typeWords('muito longe')
await finish()
const saved = await page.evaluate(async () => {
  const blob = await window.lydia.engine.saveProject()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(s)
})
const bytes = Buffer.from(saved, 'base64')
fs.writeFileSync(OUT + '/text.lyd', bytes)
const header = JSON.parse(bytes.subarray(12, 12 + bytes.readUInt32LE(8)).toString())
const inFile = header.layers.filter(layer => layer.smart?.text)
check('the file keeps its words', inFile.at(-1)?.smart.text.words === 'muito longe', `${inFile.length} texts`)
await page.evaluate(() => window.lydia.autosaveNow())
await sleep(500)
const recovered = await page.evaluate(async () => {
  const { listAutosaved, loadAutosaved } = await import('/src/autosave.ts')
  const [drawing] = await listAutosaved()
  const project = await loadAutosaved(drawing.id)
  return project.layers.map(layer => layer.smart?.text?.words ?? null)
})
check('and so does its autosave', recovered.includes('muito longe'), JSON.stringify(recovered))
const picture = await pixelsOf()
page.on('dialog', d => d.accept())
await click('Back')
await discardIfAsked(page)
await sleep(300)
const [chooser] = await Promise.all([page.waitForFileChooser(), click('Open project')])
await chooser.accept([OUT + '/text.lyd'])
await page.waitForFunction(() => window.lydia?.engine && document.querySelectorAll('button.brush').length > 0, {
  timeout: 60000,
})
await sleep(800)
snap = await snapshot()
check('opened again, it is a text', snap.isTextLayer, JSON.stringify(snap.layers.map(l => [l.name, l.isText])))
check('with its picture', diff(await pixelsOf(), picture) === 0)
await press('t')
await click('Edit text')
await page.waitForSelector('.text-box')
await press('End')
await typeWords('!')
await finish()
check('and it can still change', (await active()).text.words === 'muito longe!', (await active()).text.words)

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
