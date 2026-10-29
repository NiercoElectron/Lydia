// Runs the tests of the app (see README.md here), one after the other: all of them, or the ones named after
// "npm run test:app --" (like "npm run test:app -- folders blend-modes"). Each prints a line for each thing it
// checks, "ok" or "FAIL"; this prints the failed lines, a line for each test, and ends with an error when any failed
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
for (const name of asked.length > 0 ? asked : all) {
  const started = Date.now()
  const run = spawnSync(process.execPath, [join(here, `${name}.mjs`)], { encoding: 'utf8', timeout: 10 * 60 * 1000 })
  const lines = `${run.stdout}${run.stderr}`.trim().split('\n')
  const passed = run.status === 0 && run.stdout.trim().split('\n').at(-1) === 'ALL PASSED'
  const seconds = Math.round((Date.now() - started) / 1000)
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${name} (${seconds} s)`)
  if (!passed) {
    failed.push(name)
    const shown = lines.filter(line => !line.startsWith('ok '))
    for (const line of shown.slice(-20)) console.log(`       ${line}`)
  }
}
console.log(failed.length > 0 ? `\n${failed.length} failed: ${failed.join(', ')}` : '\nAll passed')
process.exitCode = failed.length > 0 ? 1 : 0
