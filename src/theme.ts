import { useSyncExternalStore } from 'react'
import { loadThemeChoice, saveThemeChoice, type ThemeChoice } from './settings'

// The interface's colors (decision 44): light, dark, or as the computer is set ("system", which follows the setting
// when it changes). The choice is remembered by the browser. The page gets the colors as data-theme="light" or "dark"
// on its root element, and App.css has a set of colors for each. The drawing itself never changes color

export type Theme = 'light' | 'dark'

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
let choice = loadThemeChoice()
let current = { choice, theme: themeOf(choice) }
const listeners = new Set<() => void>()

function themeOf(chosen: ThemeChoice): Theme {
  if (chosen !== 'system') return chosen
  return darkQuery.matches ? 'dark' : 'light'
}

function apply() {
  current = { choice, theme: themeOf(choice) }
  document.documentElement.dataset.theme = current.theme
  for (const listener of listeners) listener()
}

darkQuery.addEventListener('change', () => {
  if (choice === 'system') apply()
})
apply() // when the page starts, before anything is shown

export function setThemeChoice(next: ThemeChoice) {
  choice = next
  saveThemeChoice(next)
  apply()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// The choice, and the colors it gives now
export function useTheme() {
  return useSyncExternalStore(subscribe, () => current)
}

// A color of the interface, from App.css (a name like "--around-paper"), for what isn't styled by it: the graphics card
export function themeColor(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
