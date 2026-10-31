// New layers and folders (decision 74): named one number after the biggest one, so a deleted one's number comes back
// only when it was the last; renamed ones don't count, and undo brings no twin
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { CACHE_DIR, LAUNCH, ROOT } from './setup.mjs'
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
page.on('pageerror', e => problems.push('PAGE ERROR ' + e))
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warn') problems.push(m.type() + ': ' + m.text())
})
await page.setViewport({ width: 1200, height: 800 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
const click = text =>
  page.evaluate(text => [...document.querySelectorAll('button')].find(b => b.textContent === text).click(), text)
const names = () =>
  page.evaluate(() =>
    window.lydia.engine
      .getSnapshot()
      .layers.map(layer => layer.name)
      .join(),
  )
const run = async (command, ...values) => {
  await page.evaluate((command, values) => window.lydia.engine[command](...values), command, values)
  await sleep(150)
}
const add = () => run('addLayer')
// Delete the layer or folder with this name
const remove = async name => {
  const id = await page.evaluate(
    name => window.lydia.engine.getSnapshot().layers.find(layer => layer.name === name).id,
    name,
  )
  await run('selectLayer', id)
  await run('deleteLayer')
}

await page.goto('http://localhost:5198/', { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  localStorage.clear()
  indexedDB.deleteDatabase('lydia')
})
await page.reload({ waitUntil: 'networkidle0' })
await click('New project…')
await page.waitForSelector('dialog.new-project[open]')
await page.click('button[type=submit]')
await page.waitForFunction(() => window.lydia?.engine && window.lydia.app.renderer, { timeout: 90000 })
await sleep(500)

const has = async (...list) => {
  const now = (await names()).split(',')
  return list.every(name => now.includes(name)) && now.length === list.length
}
await add()
await add()
check('they count up', await has('Layer 1', 'Layer 2', 'Layer 3'), await names())

await remove('Layer 3')
await add()
check('the last one deleted, its number comes back', await has('Layer 1', 'Layer 2', 'Layer 3'), await names())

await remove('Layer 2')
await add()
check(
  'one in the middle deleted, it goes on after the biggest',
  await has('Layer 1', 'Layer 3', 'Layer 4'),
  await names(),
)

await remove('Layer 4')
await remove('Layer 3')
await add()
check('two deleted, it goes back as far', await has('Layer 1', 'Layer 2'), await names())

// Renamed ones
const secondId = await page.evaluate(() => window.lydia.engine.getSnapshot().layers.at(-1).id)
await run('renameLayer', secondId, 'Sky')
await add()
check('a renamed layer gives its number back', await has('Layer 1', 'Sky', 'Layer 2'), await names())
await run('renameLayer', secondId, 'Layer 9')
await add()
check('one renamed to a number counts', await has('Layer 1', 'Layer 9', 'Layer 2', 'Layer 10'), await names())
await remove('Layer 10')
await run('renameLayer', secondId, 'Layer 9b')
await add()
check(
  'and a name that only starts like it does not',
  await has('Layer 1', 'Layer 9b', 'Layer 2', 'Layer 3'),
  await names(),
)

// Undo brings no twin
await remove('Layer 3')
await add()
await click('Undo')
await sleep(200)
await click('Undo')
await sleep(200)
check('undo puts the deleted one back, alone', await has('Layer 1', 'Layer 9b', 'Layer 2', 'Layer 3'), await names())
await add()
check('and the next goes on after it', await has('Layer 1', 'Layer 9b', 'Layer 2', 'Layer 3', 'Layer 4'), await names())

// Folders count by themselves
await run('addFolder')
await run('addFolder')
check(
  'folders have their own numbers',
  (await names()).includes('Folder 1') && (await names()).includes('Folder 2'),
  await names(),
)
await remove('Folder 2')
await run('addFolder')
check('and work the same', (await names()).split(',').filter(name => name.startsWith('Folder')).length === 2)
await add()
check('layers inside them count', (await names()).includes('Layer 5'), await names())

check('no errors or warnings on the page', problems.length === 0, problems.join(' | '))
await browser.close()
await server.close()
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
