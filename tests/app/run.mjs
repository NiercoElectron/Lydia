// Runs the tests of the app (see README.md here), a few at a time: all of them, or the ones named after
// "npm run test:app --" (like "npm run test:app -- folders blend-modes"). Each prints a line for each thing it
// checks, "ok" or "FAIL"; this prints the failed lines, a line for each test, and ends with an error when any failed
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIDE_BY_SIDE = 4 // the tests running at a time, each with its own server, browser and Vite cache
const FIRST_PORT = 5198
const TIME_LIMIT = 10 * 60 * 1000
// They measure how long things take, so they run alone at the end: the others would slow them down
const ALONE = ['advanced-menu', 'fill', 'move-tool', 'pixel-grid', 'selections', 'tool-column', 'tray']
// A busy computer can make them miss a limit by a little, so they fail only when every try does
const TRIES_ALONE = 3

const here = dirname(fileURLToPath(import.meta.url))
const NOT_TESTS = ['setup.mjs', 'run.mjs']
const all = readdirSync(here)
  .filter(name => name.endsWith('.mjs') && !NOT_TESTS.includes(name))
  .map(name => name.slice(0, -'.mjs'.length))
const asked = process.argv.slice(2)
const unknown = asked.filter(name => !all.includes(name))
if (unknown.length > 0) {
  console.error(`No such test: ${unknown.join(', ')}. The tests: ${all.join(', ')}`)
  process.exit(1)
}

const failed = []

function runTest(name, place, tries = 1) {
  return new Promise(resolve => {
    const started = Date.now()
    const child = spawn(process.execPath, [join(here, `${name}.mjs`)], {
      timeout: TIME_LIMIT,
      env: {
        ...process.env,
        LYDIA_TEST_PORT: String(FIRST_PORT + place),
        LYDIA_TEST_CACHE: place === 0 ? '' : `-${place}`,
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', text => (stdout += text))
    child.stderr.setEncoding('utf8').on('data', text => (stderr += text))
    child.on('close', status => {
      const passed = status === 0 && stdout.trim().split('\n').at(-1) === 'ALL PASSED'
      const seconds = Math.round((Date.now() - started) / 1000)
      const isLastTry = !ALONE.includes(name) || tries === TRIES_ALONE
      console.log(`${passed ? 'ok  ' : isLastTry ? 'FAIL' : 'miss'} ${name} (${seconds} s)`)
      if (!passed) {
        if (isLastTry) failed.push(name)
        const shown = `${stdout}${stderr}`
          .trim()
          .split('\n')
          .filter(line => !line.startsWith('ok '))
        for (const line of shown.slice(-20)) console.log(`       ${line}`)
      }
      resolve(passed || isLastTry ? undefined : runTest(name, place, tries + 1))
    })
  })
}

const names = asked.length > 0 ? asked : all
const queue = names.filter(name => !ALONE.includes(name))
await Promise.all(
  Array.from({ length: SIDE_BY_SIDE }, async (_, place) => {
    while (queue.length > 0) await runTest(queue.shift(), place)
  }),
)
for (const name of names.filter(name => ALONE.includes(name))) await runTest(name, 0)
console.log(failed.length > 0 ? `\n${failed.length} failed: ${failed.join(', ')}` : '\nAll passed')
process.exitCode = failed.length > 0 ? 1 : 0
