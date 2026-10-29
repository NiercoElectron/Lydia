// Language preferences run without WebGL or a browser window.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const errors = { exports: {} }
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL('../../src/localizedError.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  errors,
)
const translations = { exports: {} }
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL('../../src/translations/pt-BR.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  translations,
)

vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL('../../src/translations/es.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  translations,
)

function setup(saved = null, languages = ['pt-BR'], blocked = false) {
  const events = {}
  const storage = new Map(saved === null ? [] : [['lydia.language', saved]])
  const context = {
    exports: {},
    require: name =>
      name === 'react'
        ? { useSyncExternalStore: (_subscribe, get) => get() }
        : name === './localizedError'
          ? errors.exports
          : translations.exports,
    navigator: { languages, language: languages[0] },
    document: { documentElement: {} },
    window: {
      addEventListener: (name, fn) => {
        events[name] = fn
      },
    },
    localStorage: {
      getItem: key => {
        if (blocked) throw Error('blocked')
        return storage.get(key) ?? null
      },
      setItem: (key, value) => {
        if (blocked) throw Error('blocked')
        storage.set(key, value)
      },
    },
  }
  const source = readFileSync(new URL('../../src/i18n.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(compiled, context)
  return { api: context.exports, context, events, storage }
}

const { api, context, events, storage } = setup()
assert.equal(api.useLanguage().locale, 'pt-BR')
assert.equal(context.document.documentElement.lang, 'pt-BR')
assert.equal(api.useLanguage().t('Language'), 'Idioma')
assert.equal(api.useLanguage().t('Missing'), 'Missing')
assert.equal(
  api.translateError(new errors.exports.LocalizedError('This file is not a Lydia project.'), 'Failed'),
  'Este arquivo não é um projeto do Lydia.',
)
assert.equal(
  api.translateError(new Error('Internal browser detail'), 'Could not complete the operation.'),
  'Não foi possível concluir a operação.',
)
const oversized = new errors.exports.LocalizedError(
  'The tip of this brush is too big ({width}×{height} pixels). The biggest is {max}×{max}.',
  { width: 2048, height: 1024, max: 1024 },
)
assert.equal(oversized.message, 'The tip of this brush is too big (2048×1024 pixels). The biggest is 1024×1024.')
assert.ok(
  api.translateError(oversized, 'Failed').startsWith('A ponta deste pincel é grande demais (2048×1024 pixels).'),
)
assert.equal(api.useLanguage().t('Screen'), 'Tela')
assert.equal(api.useLanguage().t('Screen', {}, 'blend'), 'Divisão')
assert.equal(api.useLanguage().t('Show {name}', { name: 'Color' }), 'Mostrar Color')
assert.equal(api.useLanguage().t('Show {name}', { name: '$& {width}' }), 'Mostrar $& {width}')
assert.equal(api.useLanguage().t('Show {name}'), 'Mostrar {name}')
assert.equal(api.useLanguage().t('Missing {count}', { count: 0 }), 'Missing 0')
for (const language of ['pt', 'pt-PT', 'PT-br']) assert.equal(api.resolveLocale('system', [language]), 'pt-BR')
for (const language of ['en-US', 'fr', '']) assert.equal(api.resolveLocale('system', [language]), 'en')
assert.equal(api.resolveLocale('system', ['fr', 'pt-BR']), 'en')
for (const language of ['es', 'es-ES', 'es-MX', 'es-AR', 'ES-cl'])
  assert.equal(api.resolveLocale('system', [language]), 'es')
assert.equal(api.resolveLocale('system', ['fr', 'es']), 'en')
const spanish = setup(null, ['es-MX'])
assert.equal(spanish.context.document.documentElement.lang, 'es')
assert.equal(spanish.api.useLanguage().t('New project'), 'Nuevo proyecto')
assert.equal(spanish.api.useLanguage().t('Screen'), 'Pantalla')
assert.equal(spanish.api.useLanguage().t('Screen', {}, 'blend'), 'Trama')
assert.equal(spanish.api.useLanguage().t('Show {name}', { name: '$& {width}' }), 'Mostrar $& {width}')
assert.equal(spanish.api.useLanguage().t('Missing'), 'Missing')
assert.equal(
  spanish.api.translateError(new errors.exports.LocalizedError('This file is not a Lydia project.'), 'Failed'),
  'Este archivo no es un proyecto de Lydia.',
)
spanish.api.setLanguageChoice('es')
spanish.context.navigator.languages = ['pt-BR']
spanish.events.languagechange()
assert.equal(spanish.api.useLanguage().locale, 'es')
assert.equal(spanish.storage.get('lydia.language'), 'es')
assert.equal(setup('es', ['en-US']).api.useLanguage().locale, 'es')
spanish.api.setLanguageChoice('system')
assert.equal(spanish.api.useLanguage().locale, 'pt-BR')
spanish.context.navigator.languages = ['es-AR']
spanish.events.languagechange()
assert.equal(spanish.api.useLanguage().locale, 'es')
api.setLanguageChoice('en')
assert.equal(storage.get('lydia.language'), 'en')
assert.equal(api.useLanguage().t('Language'), 'Language')
assert.equal(api.useLanguage().t('Show {name}', { name: 'Cor' }), 'Show Cor')
context.navigator.languages = ['pt-BR']
events.languagechange()
assert.equal(api.useLanguage().locale, 'en')
api.setLanguageChoice('system')
assert.equal(api.useLanguage().locale, 'pt-BR')
context.navigator.languages = ['en-US']
events.languagechange()
assert.equal(api.useLanguage().locale, 'en')
storage.set('lydia.language', 'pt-BR')
events.storage({ key: 'lydia.language' })
assert.equal(api.useLanguage().locale, 'pt-BR')
assert.equal(setup('en').api.useLanguage().locale, 'en')
assert.equal(setup('invalid').api.useLanguage().choice, 'system')
const unavailable = setup(null, ['en-US'], true)
unavailable.api.setLanguageChoice('pt-BR')
assert.equal(unavailable.api.useLanguage().locale, 'pt-BR')
console.log('ok language detection, override, persistence, system changes, fallback and unavailable storage')

const dictionaries = [translations.exports.ptBR, translations.exports.es]
assert.deepEqual(
  Object.keys(dictionaries[0]).sort(),
  Object.keys(dictionaries[1]).sort(),
  'All languages cover the same keys',
)
for (const dictionary of dictionaries) {
  const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
  for (const [source, translated] of Object.entries(dictionary)) {
    assert.deepEqual(placeholders(source), placeholders(translated), `Placeholders: ${source}`)
  }
  function checkSources(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = new URL(entry.name, directory)
      if (entry.isDirectory()) {
        checkSources(new URL(entry.name + '/', directory))
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      const source = readFileSync(path, 'utf8')
      const ast = ts.createSourceFile(
        path.pathname,
        source,
        ts.ScriptTarget.Latest,
        true,
        entry.name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      )
      function visit(node) {
        const isTranslation =
          ts.isCallExpression(node) && ['t', 'translate', 'translateError'].includes(node.expression.getText(ast))
        const isError = ts.isNewExpression(node) && node.expression.getText(ast) === 'LocalizedError'
        const argument =
          isTranslation && node.expression.getText(ast) === 'translateError'
            ? node.arguments[1]
            : isTranslation || isError
              ? node.arguments?.[0]
              : null
        if (argument && ts.isStringLiteral(argument) && argument.text)
          assert.ok(Object.hasOwn(dictionary, argument.text), `Missing translation in ${entry.name}: ${argument.text}`)
        ts.forEachChild(node, visit)
      }
      visit(ast)
    }
  }
  checkSources(new URL('../../src/', import.meta.url))
}

const news = {
  exports: {},
  require: name => ({
    __esModule: true,
    default: readFileSync(
      new URL(
        name === '../CHANGELOG.md?raw'
          ? '../../CHANGELOG.md'
          : '../../src/' + name.replace(/^\.\//, '').replace(/\?raw$/, ''),
        import.meta.url,
      ),
      'utf8',
    ),
  }),
}
vm.runInNewContext(
  ts.transpileModule(readFileSync(new URL('../../src/whatsNew.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  news,
)
const english = news.exports.releasesFor('en')
for (const locale of ['pt-BR', 'es']) {
  const portuguese = news.exports.releasesFor(locale)
  assert.equal(portuguese.length, english.length)
  for (let i = 0; i < english.length; i++) {
    const original = english[i],
      translated = portuguese[i]
    assert.notEqual(original, translated, `Missing release translation: ${original.version}`)
    assert.equal(translated.version, original.version)
    assert.equal(translated.date, original.date)
    assert.equal(translated.sections.length, original.sections.length)
    assert.equal(Boolean(translated.summary), Boolean(original.summary))
    const links = text =>
      [...text.matchAll(/\]\(([^)]+)\)/g)]
        .map(match => match[1])
        .sort()
        .join()
    assert.equal(links(translated.summary), links(original.summary))
    for (let j = 0; j < original.sections.length; j++) {
      assert.equal(translated.sections[j].title, original.sections[j].title)
      assert.equal(translated.sections[j].items.length, original.sections[j].items.length)
      for (let k = 0; k < original.sections[j].items.length; k++)
        assert.equal(links(translated.sections[j].items[k]), links(original.sections[j].items[k]))
    }
  }
}
console.log('ok translation keys, placeholders, every released version and original documentation links')
console.log('ALL PASSED')
