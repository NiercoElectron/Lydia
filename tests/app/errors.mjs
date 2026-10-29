// Lydia's errors (src/errors.ts, decision 63): each code in its place and in docs/errors.md with the same message, used
// in the code, never translated, and how a message is made. Runs without a browser
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const load = path => {
  // The same Error as here, as a page has only one
  const context = { exports: {}, Error, console: { error: error => logged.push(error) } }
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    context,
  )
  return context.exports
}
const logged = []
const { ERRORS, LydiaError, errorMessage } = load('../../src/errors.ts')
const codes = Object.keys(ERRORS)

// Codes: LYD- and three digits, the first one an area from 0 to 4
for (const code of codes) assert.match(code, /^LYD-[0-4]\d\d$/, code)
console.log(`ok ${codes.length} codes, each LYD- and three digits`)

// The list for people has every code, with the same message
const docs = readFileSync(new URL('../../docs/errors.md', import.meta.url), 'utf8')
for (const [code, message] of Object.entries(ERRORS)) {
  const row = docs.split('\n').find(line => line.startsWith(`| ${code} `))
  assert.ok(row, `${code} is not in docs/errors.md`)
  assert.equal(row.split('|')[2].trim(), message, `${code}'s message in docs/errors.md`)
}
console.log('ok every code is in docs/errors.md with its message')

// Every code is used somewhere in the code (a code no longer used is taken out of the list, and stays retired)
const sources = []
const readSources = directory => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) readSources(new URL(entry.name + '/', directory))
    else if (/\.tsx?$/.test(entry.name) && entry.name !== 'errors.ts')
      sources.push(readFileSync(new URL(entry.name, directory), 'utf8'))
  }
}
readSources(new URL('../../src/', import.meta.url))
const code = sources.join('\n')
for (const each of codes) assert.ok(code.includes(`'${each}'`), `${each} is not used`)
console.log('ok every code is used')

// Errors are never translated
for (const file of ['pt-BR', 'es']) {
  const dictionary = Object.values(load(`../../src/translations/${file}.ts`))[0]
  for (const message of Object.values(ERRORS))
    assert.ok(!Object.hasOwn(dictionary, message), `"${message}" is translated in ${file}.ts`)
}
console.log('ok no error message is in the dictionaries')

// A message: the code, then the text with its values in their places
assert.equal(new LydiaError('LYD-101').message, 'LYD-101: This file is not a Lydia project.')
assert.equal(
  new LydiaError('LYD-204', { width: 2048, height: 1024, max: 1024 }).message,
  'LYD-204: The tip of this brush is too big (2048×1024 pixels). The biggest is 1024×1024.',
)
assert.equal(
  new LydiaError('LYD-214', { name: '$& {name}' }).message,
  'LYD-214: Lydia has no brush called "$& {name}".',
)
assert.equal(new LydiaError('LYD-214').message, 'LYD-214: Lydia has no brush called "{name}".')
assert.equal(new LydiaError('LYD-104').code, 'LYD-104')
console.log('ok a message is the code and the text, with its values')

// Telling an error: Lydia's as it is; any other under the code given, with its own message, and in the console
assert.equal(errorMessage(new LydiaError('LYD-104'), 'LYD-105'), 'LYD-104: This project file is damaged.')
assert.equal(logged.length, 0)
const unexpected = new Error('QuotaExceededError')
assert.equal(errorMessage(unexpected, 'LYD-106'), 'LYD-106: Could not save the project. (QuotaExceededError)')
assert.equal(errorMessage('no space', 'LYD-212'), 'LYD-212: Could not save the brush in this browser. (no space)')
assert.deepEqual(logged, [unexpected, 'no space'])
console.log('ok an unexpected error is told under its code, with its own message, and goes to the console')
console.log('ALL PASSED')
