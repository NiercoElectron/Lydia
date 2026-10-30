// Folders: New folder, a layer into an open folder, Pass Through and a folder's own mode, opacity, hiding, no painting,
// Ctrl+G, moving in and out (and dragging onto a folder), clipping to and of folders, live opacity in a folder,
// duplicating, merging, the move tool, deleting, saved
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
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}

// ----- In the app -----
const browser = await puppeteer.launch(LAUNCH)
const page = await browser.newPage()
const problems = []
page.on('pageerror', e => problems.push('PAGE ERROR ' + e))
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warn') problems.push(m.type() + ': ' + m.text())
})
await page.setViewport({ width: 1600, height: 900 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const click = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).click(), text)
await page.goto('http://localhost:5198/', { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('lydia')
})
await page.reload({ waitUntil: 'networkidle0' })

async function newDrawing(width, height) {
  await click('New project…')
  await page.waitForSelector('dialog.new-project[open]')
  const inputs = await page.$$('dialog input[type=number]')
  for (const [i, value] of [
    [0, width],
    [1, height],
  ]) {
    await inputs[i].click({ clickCount: 3 })
    await inputs[i].type(String(value))
  }
  await page.click('button[type=submit]')
  await page.waitForFunction(
    () => window.lydia?.engine && window.lydia.app.renderer && document.querySelectorAll('button.brush').length > 0,
    { timeout: 90000 },
  )
  await sleep(400)
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
const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
const setSize = size =>
  page.evaluate(size => {
    const input = document.querySelector('label[title^="Brush size"] input[type=range]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(size))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, size)
const colorAt = (x, y) => page.evaluate((x, y) => window.lydia.projection.colorAt(x, y), x, y)
const waitIdle = () =>
  page.waitForFunction(
    () => {
      const s = window.lydia.engine.getSnapshot()
      return !s.task && !s.isUpdating
    },
    { timeout: 30000 },
  )
const setColor = color =>
  page.evaluate(color => {
    const input = document.querySelector('input.color-hex')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, color)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, color)
const drag = async (x0, y0, x1, y1, during) => {
  const a = await pageOf(x0, y0),
    b = await pageOf(x1, y1)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 })
  await page.mouse.move(b.x, b.y, { steps: 4 })
  await frames()
  if (during) await during()
  await page.mouse.up()
  await sleep(150)
}
const activeId = () => page.evaluate(() => window.lydia.engine.getSnapshot().activeLayerId)
const setMode = async (id, mode) => {
  await page.evaluate((id, mode) => window.lydia.engine.setLayerBlendMode(id, mode), id, mode)
  await waitIdle()
}
const undo = async () => {
  await page.keyboard.down('Control')
  await page.keyboard.press('z')
  await page.keyboard.up('Control')
  await waitIdle()
}
const snap = () => page.evaluate(() => window.lydia.engine.getSnapshot())
const rows = async () =>
  (await snap()).layers.map(l => `${l.name}${l.isFolder ? '/' : ''}@${l.parentId === null ? '-' : l.parentId}`)
const idOf = async name => (await snap()).layers.find(l => l.name === name).id
const BLUE = '#0000ff',
  RED = '#ff0000',
  WHITE = '#ffffff',
  GREEN = '#00ff00'
const selectLayer = async id => {
  await page.evaluate(id => window.lydia.engine.selectLayer(id), id)
  await sleep(100)
}
const engine = (name, ...args) =>
  page.evaluate((name, args) => window.lydia.engine[name](...args), name, args).then(waitIdle)
const shown = (x, y) =>
  page.evaluate(
    (x, y) => {
      const { app, projection } = window.lydia
      const Rectangle = projection.container.getBounds().rectangle.constructor
      const p = app.renderer.extract.pixels({ target: projection.container, frame: new Rectangle(x, y, 1, 1) }).pixels
      return (
        '#' +
        [0, 1, 2]
          .map(i =>
            Math.round((p[i] * 255) / (p[3] || 1))
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')
      )
    },
    x,
    y,
  )
const near = (hex, want) =>
  hex !== null &&
  [1, 3, 5].every(i => Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(want.slice(i, i + 2), 16)) <= 2)

await newDrawing(300, 200)
await page.evaluate(() =>
  [...document.querySelectorAll('button.brush')].find(b => b.textContent.trim().startsWith('Hard round')).click(),
)
await sleep(300)
await setSize(20)
await setColor(RED)
await sleep(80)
await drag(20, 30, 280, 30) // Layer 1: a red stripe
await click('New folder')
await sleep(200)
const folder1 = await idOf('Folder 1')
check(
  'New folder adds an open folder above, active',
  (await snap()).activeLayerId === folder1 && (await snap()).layers.at(-1).isOpen,
)
await click('New layer')
await sleep(200)
check(
  'a new layer with an open folder active goes into it',
  (await rows()).join() === `Layer 1@-,Layer 2@${folder1},Folder 1/@-`,
  (await rows()).join(),
)
await setColor(BLUE)
await sleep(80)
await drag(150, 5, 150, 190) // Layer 2: a blue stripe across
const layer2 = await idOf('Layer 2')
check(
  'the picture: blue over red, and over the paper',
  (await colorAt(150, 30)) === BLUE && (await colorAt(150, 100)) === BLUE && (await colorAt(60, 30)) === RED,
)
check(
  'the row is moved in under its folder',
  await page.evaluate(() => {
    const li = [...document.querySelectorAll('.layers-list li')].find(row => row.textContent.includes('Layer 2'))
    return parseFloat(li.style.paddingLeft) > 0
  }),
)

// Pass Through: a Multiply layer in the folder mixes with what is outside it
await engine('setLayerBlendMode', layer2, 'multiply')
check(
  'Pass Through: Multiply in the folder darkens the red outside it',
  (await colorAt(150, 30)) === '#000000',
  await colorAt(150, 30),
)
await engine('setLayerBlendMode', folder1, 'normal')
check(
  'a folder with its own mode: Multiply only mixes inside it',
  (await colorAt(150, 30)) === BLUE,
  await colorAt(150, 30),
)
await engine('setLayerBlendMode', folder1, 'pass-through')
await engine('setLayerOpacity', folder1, 0.5)
await engine('finishLayerOpacity')
check(
  'Pass Through at 50%: half way between before and after',
  near(await colorAt(150, 100), '#8080ff') && near(await colorAt(150, 30), '#800000'),
  `${await colorAt(150, 100)} ${await colorAt(150, 30)}`,
)
await undo()
await engine('setLayerBlendMode', layer2, 'normal')
check(
  "the folder's Blend list offers Pass Through",
  (await page.evaluate(id => {
    window.lydia.engine.selectLayer(id)
    return true
  }, folder1)) &&
    (await sleep(150),
    await page.$eval(
      '.layer-blend select',
      s => [...s.options].some(o => o.value === 'pass-through') && s.value === 'pass-through',
    )),
)

// Hiding a folder hides what is in it
await engine('setLayerVisible', folder1, false)
check('a hidden folder hides its layers', (await colorAt(150, 100)) === WHITE && (await colorAt(150, 30)) === RED)
await engine('setLayerVisible', folder1, true)

// A folder can't be painted on
await selectLayer(folder1)
await page.keyboard.press('b')
await sleep(100)
await setColor(GREEN)
await sleep(80)
await drag(40, 160, 100, 160)
const notice = await page.evaluate(() => [...document.querySelectorAll('.notice')].map(n => n.textContent).join())
check(
  'painting on a folder: a notice, and nothing painted',
  notice.includes('folder') && (await colorAt(70, 160)) === WHITE,
  notice,
)

// Ctrl+G puts the active layer into a new folder
const layer1 = await idOf('Layer 1')
await selectLayer(layer1)
await page.keyboard.down('Control')
await page.keyboard.press('g')
await page.keyboard.up('Control')
await waitIdle()
const folder2 = await idOf('Folder 2')
check(
  'Ctrl+G: Layer 1 in a new folder, which is active',
  (await rows()).join() === `Layer 1@${folder2},Folder 2/@-,Layer 2@${folder1},Folder 1/@-` &&
    (await snap()).activeLayerId === folder2,
  (await rows()).join(),
)
check('…and the picture is the same', (await colorAt(150, 30)) === BLUE && (await colorAt(60, 30)) === RED)
check(
  'New layer outside is offered for a folder, not for a layer outside folders',
  await page.evaluate(
    () => ![...document.querySelectorAll('button')].find(b => b.textContent === 'New layer outside').disabled,
  ),
)
await click('New layer outside')
await sleep(200)
const afterOutside = await snap()
const outside = afterOutside.layers.find(l => l.id === afterOutside.activeLayerId)
check(
  '…it adds a layer above the folder, out of it',
  (await rows()).join() === `Layer 1@${folder2},Folder 2/@-,${outside.name}@-,Layer 2@${folder1},Folder 1/@-` &&
    outside.parentId === null,
  (await rows()).join(),
)
check(
  "…and isn't offered for that layer",
  await page.evaluate(
    () => [...document.querySelectorAll('button')].find(b => b.textContent === 'New layer outside').disabled,
  ),
)
await undo()
await selectLayer(layer2)
await click('New layer outside')
await sleep(200)
const fromInside = await snap()
check(
  'from a layer in a folder, above that folder',
  (await rows()).join() ===
    `Layer 1@${folder2},Folder 2/@-,Layer 2@${folder1},Folder 1/@-,${fromInside.layers.at(-1).name}@-` &&
    fromInside.activeLayerId === fromInside.layers.at(-1).id,
  (await rows()).join(),
)
await undo()

// Moving layers and folders in and out
await engine('moveLayer', layer2, null, folder1)
check(
  'a layer moved out of its folder, above it',
  (await rows()).join() === `Layer 1@${folder2},Folder 2/@-,Folder 1/@-,Layer 2@-`,
  (await rows()).join(),
)
await undo()
check(
  'undo puts it back in the folder',
  (await rows()).join() === `Layer 1@${folder2},Folder 2/@-,Layer 2@${folder1},Folder 1/@-`,
  (await rows()).join(),
)
await engine('moveLayer', folder2, folder1, null)
check(
  'a folder moved into another, with what is in it',
  (await rows()).join() === `Layer 1@${folder2},Folder 2/@${folder1},Layer 2@${folder1},Folder 1/@-`,
  (await rows()).join(),
)
check('…the picture the same', (await colorAt(150, 30)) === BLUE && (await colorAt(60, 30)) === RED)
await engine('moveLayer', folder1, folder2, null)
check(
  "a folder can't go into a folder in it",
  (await rows()).join() === `Layer 1@${folder2},Folder 2/@${folder1},Layer 2@${folder1},Folder 1/@-`,
)
await undo()

// Dragging a layer onto a folder's row puts it in (a new layer in Folder 2, out of Folder 1)
await selectLayer(folder2)
await click('New layer')
await sleep(200)
const layer3 = (await snap()).activeLayerId
const layer3Name = (await snap()).layers.find(l => l.id === layer3).name
const rowBox = name =>
  page.evaluate(name => {
    const li = [...document.querySelectorAll('.layers-list li')].find(
      row => row.querySelector('.layer-name')?.textContent.trim() === name,
    )
    const box = li.querySelector('.layer-name').getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  }, name)
const from = await rowBox(layer3Name),
  to = await rowBox('Folder 1')
await page.mouse.move(from.x, from.y)
await page.mouse.down()
await page.mouse.move(from.x, (from.y + to.y) / 2, { steps: 4 })
await page.mouse.move(to.x, to.y, { steps: 4 })
const lit = await page.evaluate(() => !!document.querySelector('.layers-list li.drop-into'))
await page.mouse.up()
await waitIdle()
const inFolder = (await snap()).layers.find(l => l.id === layer3).parentId
check(
  'dragging a layer onto a folder lights it, and puts the layer in it',
  lit && inFolder === folder1,
  `${lit} ${inFolder}`,
)
await undo()
await engine('deleteLayer')

// A folder as a clip base, and a clipped folder
await engine('setFolderOpen', folder1, false)
await selectLayer(folder1)
await click('New layer')
await sleep(200)
check('a new layer with a closed folder active goes above it', (await snap()).layers.at(-1).parentId === null)
const green = (await snap()).activeLayerId
await page.keyboard.press('b')
await setColor(GREEN)
await sleep(80)
await drag(20, 100, 280, 100)
await engine('setLayerClipped', green, true)
check(
  "clipped to a folder: it shows only where the folder's layers have paint",
  (await colorAt(150, 100)) === GREEN && (await colorAt(60, 100)) === WHITE,
  `${await colorAt(150, 100)} ${await colorAt(60, 100)}`,
)
await page.keyboard.down('Control')
await page.keyboard.press('g')
await page.keyboard.up('Control')
await waitIdle()
check(
  'put in a folder, the folder is clipped instead, and the picture stays',
  (await snap()).layers.at(-1).clipped && (await colorAt(150, 100)) === GREEN && (await colorAt(60, 100)) === WHITE,
)
await undo()
await undo()
await undo()
await undo() // the green layer, its stroke, its clipping and its folder

// The opacity of a layer in a folder, live
await selectLayer(layer2)
await page.evaluate(id => window.lydia.engine.setLayerOpacity(id, 0.5), layer2)
await waitIdle()
const live = await shown(150, 160)
check('a layer in a folder at 50% while the slider moves', near(live, '#8080ff'), live)
await engine('finishLayerOpacity')
check('…and once let go', near(await colorAt(150, 160), '#8080ff'), await colorAt(150, 160))
await undo()

// Duplicating and merging a folder
await selectLayer(folder1)
await engine('duplicateLayer')
const copied = await snap()
const copy = copied.layers.find(l => l.name === 'Folder 1 copy')
check(
  "a folder's copy has copies of what is in it",
  !!copy && copied.layers.filter(l => l.parentId === copy.id).length === 1 && copied.activeLayerId === copy.id,
  (await rows()).join(),
)
await undo()
await selectLayer(folder1)
const before = [await colorAt(150, 30), await colorAt(150, 100), await colorAt(60, 30)]
check(
  'Merge folder is offered',
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].some(b => b.textContent === 'Merge folder' && !b.disabled),
  ),
)
await engine('mergeDown')
const merged = await snap()
check(
  'a folder merged into one layer, in its place, with the same picture',
  merged.layers.length === 3 &&
    !merged.layers.at(-1).isFolder &&
    merged.layers.at(-1).name === 'Folder 1' &&
    [await colorAt(150, 30), await colorAt(150, 100), await colorAt(60, 30)].join() === before.join(),
  (await rows()).join(),
)
await undo()
check(
  'undo brings the folder back',
  (await rows()).join() === `Layer 1@${folder2},Folder 2/@-,Layer 2@${folder1},Folder 1/@-`,
  (await rows()).join(),
)

// The move tool moves all of a folder
await selectLayer(folder1)
await page.keyboard.press('v')
await sleep(100)
const during = {}
await drag(150, 100, 180, 100, async () => {
  during.at = await shown(180, 100)
})
await waitIdle()
check('moving a folder: shown moving', during.at === BLUE, during.at)
check(
  '…and its layers moved',
  (await colorAt(180, 100)) === BLUE && (await colorAt(150, 100)) === WHITE,
  `${await colorAt(180, 100)} ${await colorAt(150, 100)}`,
)
await undo()
check('undo moves them back', (await colorAt(150, 100)) === BLUE && (await colorAt(180, 100)) === WHITE)

// Deleting a folder deletes what is in it
await selectLayer(folder1)
await page.keyboard.press('b')
check(
  'Delete folder is offered',
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].some(b => b.textContent === 'Delete folder' && !b.disabled),
  ),
)
await engine('deleteLayer')
check(
  'a folder deleted with what is in it',
  (await rows()).join() === `Layer 1@${folder2},Folder 2/@-` && (await colorAt(150, 100)) === WHITE,
  (await rows()).join(),
)
await undo()
check('undo brings them back', (await colorAt(150, 100)) === BLUE && (await rows()).length === 4)

// Saved with the drawing
const saved = await page.evaluate(async () => {
  const { parseProject } = await import('/src/engine/projectFile.ts')
  return parseProject(await (await window.lydia.engine.saveProject()).arrayBuffer()).layers.map(
    l => `${l.name}:${l.folder ? 'f' : ''}:${l.parent ?? '-'}:${l.blendMode}`,
  )
})
check(
  'saved with the drawing',
  saved.join() === 'Layer 1::1:normal,Folder 2:f:-:pass-through,Layer 2::3:normal,Folder 1:f:-:pass-through',
  saved.join(),
)

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
