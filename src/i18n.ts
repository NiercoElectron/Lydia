import { useSyncExternalStore } from 'react'
import { ptBR } from './translations/pt-BR'
import { es } from './translations/es'

// The interface's texts in the language chosen (decision 63). Errors are not translated: see errors.ts

export type LanguageChoice = 'system' | 'en' | 'pt-BR' | 'es'
export type Locale = Exclude<LanguageChoice, 'system'>
const dictionaries: Record<Exclude<Locale, 'en'>, Record<string, string>> = { 'pt-BR': ptBR, es }
const STORAGE_KEY = 'lydia.language'

function loadChoice(): LanguageChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved === 'en' || saved === 'pt-BR' || saved === 'es' ? saved : 'system'
  } catch {
    return 'system'
  }
}

export function resolveLocale(choice: LanguageChoice, languages: readonly string[]): Locale {
  if (choice !== 'system') return choice
  // The first preferred language determines the UI; English is the fallback for unsupported languages.
  const preferred = languages[0] ?? ''
  if (/^pt(?:-|$)/i.test(preferred)) return 'pt-BR'
  if (/^es(?:-|$)/i.test(preferred)) return 'es'
  return 'en'
}

// Put the values in the places like {name}, leaving a place with no value as it is
function interpolate(source: string, values: Record<string, string | number>) {
  return source.replace(/\{(\w+)\}/g, (place, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : place,
  )
}

let choice = loadChoice()
const listeners = new Set<() => void>()
function snapshot() {
  const locale = resolveLocale(choice, navigator.languages?.length ? navigator.languages : [navigator.language])
  return {
    choice,
    locale,
    t: (source: string, values: Record<string, string | number> = {}, context?: string) => {
      const key = context ? `${context}.${source}` : source
      const dictionary = locale === 'en' ? undefined : dictionaries[locale]
      const translated = dictionary?.[key] ?? dictionary?.[source] ?? source
      return interpolate(translated, values)
    },
    setChoice: setLanguageChoice,
  }
}
let current = snapshot()

function apply() {
  current = snapshot()
  document.documentElement.lang = current.locale
  for (const listener of listeners) listener()
}

export function setLanguageChoice(next: LanguageChoice) {
  choice = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Apply for this visit even when storage is unavailable.
  }
  apply()
}

window.addEventListener('languagechange', () => {
  if (choice === 'system') apply()
})
window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY || event.key === null) {
    choice = loadChoice()
    apply()
  }
})
apply()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useLanguage() {
  return useSyncExternalStore(subscribe, () => current)
}

// For new default names stored in the drawing, without recreating the engine when the language changes.
export function translate(source: string, values: Record<string, string | number> = {}) {
  return current.t(source, values)
}
