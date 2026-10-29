import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
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
let browser
try {
  await server.listen()
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000 })
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR'] })
  })
  await page.goto('http://localhost:5198')
  await page.waitForSelector('.home-actions button')
  assert.equal(await page.$eval('html', el => el.lang), 'pt-BR')
  assert.equal(await page.$eval('.home-actions button', el => el.textContent), 'Novo projeto…')
  await page.select('.theme-choice select', 'en')
  assert.equal(await page.$eval('.home-actions button', el => el.textContent), 'New project…')
  await page.reload()
  await page.waitForSelector('.home-actions button')
  assert.equal(await page.$eval('html', el => el.lang), 'en')
  await page.select('.theme-choice select', 'pt-BR')
  assert.equal(await page.$eval('.whats-new h2', el => el.textContent), 'Novidades')
  assert.ok(await page.$eval('.whats-new li', el => el.textContent.includes('opacidade aparece em tempo real')))
  await page.screenshot({ path: OUT + '/language-home-pt.png', fullPage: true })
  await page.click('.home-actions button')
  await page.waitForSelector('dialog[open]')
  assert.equal(await page.$eval('dialog h2', el => el.textContent), 'Novo projeto')
  await page.click('dialog button[type=submit]')
  await page.waitForSelector('.layers-panel')
  await page.waitForFunction(() => window.lydia?.engine)
  assert.equal(await page.$eval('.layers-panel h2', el => el.textContent), 'Camadas')
  assert.equal(await page.$eval('.brushes-panel h2', el => el.textContent), 'Pincéis')
  assert.equal(await page.$eval('button.layer-name', el => el.textContent.trim()), 'Camada 1')
  assert.equal(await page.$eval('.brush-name', el => el.textContent), 'Redondo suave')
  const engineHandle = await page.evaluateHandle(() => window.lydia.engine)
  await page.screenshot({ path: OUT + '/language-editor-pt.png' })
  assert.ok(await page.$('.tool-column button[aria-label="Borracha"]'))
  await page.select('.layer-blend select', 'multiply')
  assert.equal(await page.$eval('.layer-blend select option:checked', el => el.textContent.trim()), 'Multiplicar')
  // Layer names are document data, even when they happen to match an English UI label.
  await page.click('.layer-name', { clickCount: 2 })
  await page.waitForSelector('input.layer-name')
  await page.$eval('input.layer-name', el => {
    el.value = 'Color'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.keyboard.press('Enter')
  assert.equal(await page.$eval('button.layer-name', el => el.textContent.trim()), 'Color')
  await page.click('.tool-column button[aria-label="Bandeja"]')
  assert.equal(await page.$eval('.tray-panel h2', el => el.textContent), 'Bandeja')
  // Existing screens update when the preference changes in another tab.
  const other = await browser.newPage()
  await other.setViewport({ width: 1600, height: 1000 })
  await other.goto('http://localhost:5198')
  await other.waitForSelector('.theme-choice select')
  await other.select('.theme-choice select', 'en')
  await page.waitForFunction(() => document.querySelector('.layers-panel h2')?.textContent === 'Layers')
  assert.ok(await page.$('.tool-column button[aria-label="Eraser"]'))
  assert.equal(await page.$eval('button.layer-name', el => el.textContent.trim()), 'Color')
  assert.equal(await page.evaluate(engine => engine === window.lydia.engine, engineHandle), true)
  await engineHandle.dispose()
  await other.select('.theme-choice select', 'pt-BR')
  const alerts = []
  other.on('dialog', async dialog => {
    alerts.push(dialog.message())
    await dialog.accept()
  })
  writeFileSync(OUT + '/invalid-language.lyd', 'invalid project')
  const projectInput = await other.$('input[type=file]')
  await projectInput.uploadFile(OUT + '/invalid-language.lyd')
  await other.waitForFunction(() => !document.querySelector('.home-actions button:nth-child(2)').disabled)
  assert.equal(alerts.pop(), 'Este arquivo não é um projeto do Lydia.')
  await other.click('.designer-start > button')
  await other.waitForSelector('.designer-panel')
  await other.waitForFunction(() => window.lydia?.engine)
  assert.equal(await other.$eval('.designer-panel h2', el => el.textContent), 'Editor de pincéis')
  assert.equal(await other.$eval('.name-row input', el => el.value), 'Meu pincel')
  assert.equal(await other.$eval('.shape-controls .slider-row span', el => el.textContent), 'Espaçamento')
  assert.ok(await other.$eval('.designer-panel .hint', el => el.textContent.includes('Pinte a ponta no papel')))
  assert.equal(await other.$eval('.toolbar .button-group button', el => el.textContent.trim()), 'Suave')
  assert.ok(
    await other.$eval('.test-controls', el => el.scrollWidth <= el.clientWidth),
    'Translated test controls fit in the panel',
  )
  await other.screenshot({ path: OUT + '/language-designer-pt.png' })
  await page.evaluate(() => localStorage.setItem('lydia.language', 'en'))
  await other.waitForFunction(() => document.querySelector('.designer-panel h2')?.textContent === 'Brush Designer')
  assert.equal(await other.$eval('.name-row input', el => el.value), 'Meu pincel')
  console.log(
    'ok system language, saved override, translated editor, blend modes, user names and live language changes',
  )
  console.log('ALL PASSED')
} finally {
  await browser?.close()
  await server.close()
}
