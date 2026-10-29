import { useSyncExternalStore } from 'react'
import { interpolate, LocalizedError } from './localizedError'
import { ptBR } from './translations/pt-BR'

export type LanguageChoice = 'system' | 'en' | 'pt-BR'
export type Locale = 'en' | 'pt-BR'
const STORAGE_KEY = 'lydia.language'

function loadChoice(): LanguageChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved === 'en' || saved === 'pt-BR' ? saved : 'system'
  } catch {
    return 'system'
  }
}

export function resolveLocale(choice: LanguageChoice, languages: readonly string[]): Locale {
  if (choice !== 'system') return choice
  // The first preferred language determines the UI; English is the fallback for unsupported languages.
  return /^pt(?:-|$)/i.test(languages[0] ?? '') ? 'pt-BR' : 'en'
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
      const translated = locale === 'pt-BR' ? (ptBR[key] ?? ptBR[source] ?? source) : source
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

// Resolve at the time the error is shown, so asynchronous work uses the latest language choice.
export function translateError(error: unknown, fallback: string) {
  if (error instanceof LocalizedError) return current.t(error.source, error.values)
  return current.t(fallback)
}

// For new default names stored in the drawing, without recreating the engine when the language changes.
export function translate(source: string, values: Record<string, string | number> = {}) {
  return current.t(source, values)
}
