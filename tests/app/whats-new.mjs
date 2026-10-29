// What's New? on the start screen, read from CHANGELOG.md
import fs from 'node:fs'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { CACHE_DIR, CHROME, OUT, ROOT } from './setup.mjs'
const server = await createServer({
  root: ROOT,
  configFile: ROOT + '/vite.config.ts',
  cacheDir: CACHE_DIR,
  server: { port: 5198, strictPort: true },
  logLevel: 'silent',
})
await server.listen()
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage()
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
const problems = []
page.on('pageerror', e => problems.push('PAGE ERROR ' + e))
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warn') problems.push(m.type() + ': ' + m.text())
})
let failures = 0
const check = (name, ok, extra = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
}
await page.setViewport({ width: 1600, height: 900 })
await page.goto('http://localhost:5198/', { waitUntil: 'networkidle0' })

const versions = (fs.readFileSync(ROOT + '/CHANGELOG.md', 'utf8').match(/^## \[\d+\.\d+\.\d+\]/gm) || []).length
const shown = await page.$$eval('.whats-new details', ds =>
  ds.map(d => ({
    title: d.querySelector('summary').textContent,
    open: d.open,
    sections: [...d.querySelectorAll('h3')].map(h => h.textContent),
    items: d.querySelectorAll('li').length,
    summary: d.querySelector('p')?.textContent ?? '',
  })),
)
check(
  'every released version, and not Unreleased',
  shown.length === versions && !shown.some(s => s.title.includes('Unreleased')),
  `${shown.length} of ${versions}`,
)
const current = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8')).version
check(
  `the newest first, open: ${current}, the version in package.json`,
  shown[0].title.startsWith(`Lydia ${current} `) && shown[0].open && shown.slice(1).every(s => !s.open),
  shown[0].title,
)
const v090 = shown.find(s => s.title.startsWith('Lydia 0.9.0'))
check(
  '0.9.0: Added, Changed and Fixed, with their items',
  v090.sections.join() === 'Added,Changed,Fixed' && v090.items === 7,
  `${v090.sections.join()} ${v090.items} items`,
)
const v080 = shown.find(s => s.title.startsWith('Lydia 0.8.0'))
check("a version's summary sentence", v080.summary.startsWith('The basic tools:'), v080.summary.slice(0, 40))
const first = await page.$eval('.whats-new li', li => ({
  text: li.textContent,
  link: li.querySelector('a')?.href,
  bold: li.querySelector('strong')?.textContent,
}))
check(
  'items read as text: no Markdown left',
  !first.text.includes('**') && !first.text.includes(']('),
  first.text.slice(0, 80),
)
const firstLink = await page.$eval('.whats-new li a', a => a.href)
check(
  'links open on GitHub',
  firstLink.startsWith('https://github.com/NiercoElectron/Lydia/blob/main/docs/decisions.md#'),
  firstLink,
)
const leftovers = await page.$$eval('.whats-new li, .whats-new p', els =>
  els.filter(e => /\*\*|\]\(|`/.test(e.textContent)).map(e => e.textContent.slice(0, 60)),
)
check('no Markdown left anywhere', leftovers.length === 0, leftovers.join(' | '))
const box = await page.$eval('.whats-new', a => a.getBoundingClientRect().toJSON())
check('at the right of the choices', box.left > 900, `left ${Math.round(box.left)}`)
await page.screenshot({ path: OUT + '/whats-new.png' })
await page.evaluate(() => document.querySelectorAll('.whats-new details')[1].querySelector('summary').click())
check('another version opens with a click', await page.$$eval('.whats-new details', ds => ds[1].open))
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
await new Promise(r => setTimeout(r, 100))
await page.screenshot({ path: OUT + '/whats-new-dark.png' })
await page.setViewport({ width: 800, height: 900 })
const narrow = await page.$eval('.whats-new', a => a.getBoundingClientRect().toJSON())
const choicesBottom = await page.$eval('.home-choices', c => c.getBoundingClientRect().bottom)
check(
  'in a narrow window: below the choices',
  narrow.top >= choicesBottom - 1,
  `${Math.round(narrow.top)} vs ${Math.round(choicesBottom)}`,
)
check('no errors', problems.length === 0, problems.join(' | '))
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
await browser.close()
await server.close()
