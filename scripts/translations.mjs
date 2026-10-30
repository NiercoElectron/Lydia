// What is left to translate (decision 63), for each language: the interface's texts missing from its dictionary in
// src/translations, and the released versions missing from its translated history of versions. Run it from the
// project folder with "npm run translations". It looks at the texts the code gives to t() or translate() as they are
// written, the names of the tasks (runTask) and of the tools (src/components/toolList.ts); a text the code puts
// together some other way isn't seen. A text or a version not translated yet shows in English, so this is kept apart
// from the tests: it ends with an error while something is left, for whoever translates
import { readdirSync, readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const LANGUAGES = [
  { name: 'pt-BR', dictionary: 'pt-BR.ts', history: 'changelog.pt-BR.md' },
  { name: 'es', dictionary: 'es.ts', history: 'changelog.es.md' },
]
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// ----- The texts the code shows: text -> the files it is in -----

const texts = new Map()
const found = (text, file) => {
  if (!text) return
  if (!texts.has(text)) texts.set(text, new Set())
  texts.get(text).add(file)
}
function scan(directory) {
  for (const entry of readdirSync(new URL(`../${directory}`, import.meta.url), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) {
      if (entry.name !== 'translations') scan(path)
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    const kind = entry.name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const ast = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, kind)
    const visit = node => {
      if (ts.isCallExpression(node) && ['t', 'translate', 'runTask'].includes(node.expression.getText(ast))) {
        const [text] = node.arguments
        if (text && ts.isStringLiteral(text)) found(text.text, entry.name)
      }
      // The tools' names and the other ways to use them, translated where the tool column shows them
      if (
        entry.name === 'toolList.ts' &&
        ts.isPropertyAssignment(node) &&
        ['name', 'also'].includes(node.name.getText(ast)) &&
        ts.isStringLiteral(node.initializer)
      )
        found(node.initializer.text, entry.name)
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
}
scan('src')

// ----- The versions released -----

const versionsOf = text => [...text.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map(match => match[1])
const released = versionsOf(read('CHANGELOG.md'))

// ----- What each language is missing -----

let left = 0
for (const language of LANGUAGES) {
  const module = { exports: {} }
  vm.runInNewContext(
    ts.transpileModule(read(`src/translations/${language.dictionary}`), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    module,
  )
  const dictionary = Object.values(module.exports)[0]
  const missingTexts = [...texts].filter(([text]) => !Object.hasOwn(dictionary, text))
  const translatedVersions = versionsOf(read(`src/translations/${language.history}`))
  const missingVersions = released.filter(version => !translatedVersions.includes(version))
  left += missingTexts.length + missingVersions.length
  if (missingTexts.length + missingVersions.length === 0) {
    console.log(`${language.name}: all translated`)
    continue
  }
  console.log(`${language.name}: ${missingTexts.length} texts and ${missingVersions.length} versions left`)
  for (const [text, files] of missingTexts) console.log(`  "${text}" (${[...files].join(', ')})`)
  if (missingVersions.length > 0) {
    console.log(`  versions missing from src/translations/${language.history}: ${missingVersions.join(', ')}`)
  }
}
process.exitCode = left > 0 ? 1 : 0
