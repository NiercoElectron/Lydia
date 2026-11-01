// Dragging layers by their dots: the same distance up and down, wherever they are grabbed; the end of a folder, in or out
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
await page.setViewport({ width: 1600, height: 900 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
await page.goto(`http://localhost:${PORT}/`)
await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'New project…'))
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'New project…').click())
await page.waitForSelector('dialog.new-project[open]')
await page.click('button[type=submit]')
await page.waitForFunction(() => window.lydia?.engine && document.querySelector('.layers-list li'), { timeout: 60000 })
await sleep(500)

const clickLabel = async label => {
  await page.evaluate(label => document.querySelector(`[aria-label="${label}"]`).click(), label)
  await sleep(80)
}
const layers = () => page.evaluate(() => window.lydia.engine.getSnapshot().layers)
const idOf = async name => (await layers()).find(layer => layer.name === name).id
const shownNames = () =>
  page.$$eval('.layers-list button.layer-name', list => list.map(button => button.textContent.trim()).join(','))
const parentOf = async name => (await layers()).find(layer => layer.name === name).parentId
const nextFrame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())))
const gripOf = name =>
  page.evaluate(name => {
    const row = [...document.querySelectorAll('.layers-list li')].find(li =>
      li.querySelector('.layer-name')?.textContent.includes(name),
    )
    const { left, width } = row.querySelector('.layer-grip').getBoundingClientRect()
    const { top, height } = row.getBoundingClientRect()
    return { x: left + width / 2, y: top + height / 2, height }
  }, name)

for (let i = 0; i < 3; i++) await clickLabel('New layer')
check('four layers', (await shownNames()) === 'Layer 4,Layer 3,Layer 2,Layer 1', await shownNames())

// ----- The same up and down -----
// How far the row must go before another steps aside. It stays in hand, and goes back afterwards
const distanceTo = async (name, grab, direction) => {
  const grip = await gripOf(name)
  const start = grip.y + grab
  await page.mouse.move(grip.x, start)
  await page.mouse.down()
  let distance = null
  for (let moved = 2; moved <= grip.height * 2 && distance === null; moved += 2) {
    await page.mouse.move(grip.x, start + direction * moved)
    await nextFrame()
    const hasStepped = await page.$$eval('.layers-list li:not(.dragging)', list =>
      list.some(li => li.style.transform !== ''),
    )
    if (hasStepped) distance = moved
  }
  await page.mouse.move(grip.x, start)
  await page.mouse.up()
  await sleep(250)
  return distance
}
const { height } = await gripOf('Layer 3')
const seen = []
for (const grab of [0, -14, 14]) {
  const down = await distanceTo('Layer 3', grab, 1)
  const up = await distanceTo('Layer 3', grab, -1)
  seen.push(`grabbed at ${grab}: ${down} down, ${up} up`)
  check(`the same up and down, grabbed at ${grab}`, Math.abs(down - up) <= 2, `${down} ${up}`)
  check(`half a row, grabbed at ${grab}`, Math.abs(down - height / 2) <= 4, `${down} of a row of ${height}`)
}
console.log(seen.join('; '))
check('nothing moved', (await shownNames()) === 'Layer 4,Layer 3,Layer 2,Layer 1', await shownNames())

// ----- The end of a folder -----
// From the top: Layer 4, Folder 1 (Layer 3, Layer 2), Layer 1
await clickLabel('New folder')
const folder = (await layers()).find(layer => layer.isFolder)
const [layer1, layer2, layer3] = await Promise.all(['Layer 1', 'Layer 2', 'Layer 3'].map(idOf))
await page.evaluate(
  ({ folder, layer1, layer2, layer3 }) => {
    const { engine } = window.lydia
    engine.moveLayer(folder, null, layer1)
    engine.moveLayer(layer2, folder, null)
    engine.moveLayer(layer3, folder, layer2)
  },
  { folder: folder.id, layer1, layer2, layer3 },
)
await sleep(200)
const order = `Layer 4,${folder.name},Layer 3,Layer 2,Layer 1`
check('the folder is ready', (await shownNames()) === order, await shownNames())

const drag = async (name, dx, dy) => {
  const { x, y } = await gripOf(name)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 8 })
  await nextFrame()
  const preview = await page.$eval('.layers-list li.dragging', li => new DOMMatrix(getComputedStyle(li).transform).m41)
  await page.mouse.up()
  await sleep(200)
  return preview
}

await drag('Layer 3', 0, height * 0.6)
check(
  'dragged straight to the end of its folder, it stays in',
  (await shownNames()) === `Layer 4,${folder.name},Layer 2,Layer 3,Layer 1` &&
    (await parentOf('Layer 3')) === folder.id,
  `${await shownNames()} ${await parentOf('Layer 3')}`,
)

let sideways = await drag('Layer 3', -16, 0)
check(
  'a little to the left takes it out, without changing its place',
  (await shownNames()) === `Layer 4,${folder.name},Layer 2,Layer 3,Layer 1` && (await parentOf('Layer 3')) === null,
  `${await shownNames()} ${await parentOf('Layer 3')}`,
)
check('and it shows that on the way', sideways < 0, String(sideways))

sideways = await drag('Layer 3', 16, 0)
check('a little to the right puts it back at the end', (await parentOf('Layer 3')) === folder.id)
check('and it shows that too', sideways > 0, String(sideways))

const layer4 = await idOf('Layer 4')
await page.evaluate((layer4, layer1) => window.lydia.engine.moveLayer(layer4, null, layer1), layer4, layer1)
await sleep(200)
await drag('Layer 1', 0, -height * 0.6)
check(
  'a layer from outside stays outside, under the folder',
  (await shownNames()) === `${folder.name},Layer 2,Layer 3,Layer 1,Layer 4` && (await parentOf('Layer 1')) === null,
  `${await shownNames()} ${await parentOf('Layer 1')}`,
)

check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
process.exit(failures ? 1 : 0)
