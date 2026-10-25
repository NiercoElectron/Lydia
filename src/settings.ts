import { DEFAULT_DPI, isColor, isDpi, MAX_SIZE, MIN_SIZE } from './engine/projectFile'

// Choices remembered by this browser between visits

// How much of the graphics card's memory Lydia may use to keep layers ready (see decision 28), in GB. Browsers don't
// tell how much memory the graphics card has, so the user chooses
export const GPU_MEMORY_CHOICES = [0.5, 1, 2, 3, 4, 6, 8]
export const DEFAULT_GPU_MEMORY = 2
const GPU_MEMORY_KEY = 'lydia.gpuMemory'

export function loadGpuMemory() {
  try {
    const saved = Number(localStorage.getItem(GPU_MEMORY_KEY))
    return GPU_MEMORY_CHOICES.includes(saved) ? saved : DEFAULT_GPU_MEMORY
  } catch {
    return DEFAULT_GPU_MEMORY // the browser doesn't let this page keep anything (a private window, for example)
  }
}

export function saveGpuMemory(gigabytes: number) {
  try {
    localStorage.setItem(GPU_MEMORY_KEY, String(gigabytes))
  } catch {
    // not remembered next time, but used now
  }
}

// The size, background and resolution chosen last for a new drawing (see NewProjectDialog)
export type NewProjectChoice = { width: number; height: number; background: string | null; dpi: number }
const NEW_PROJECT_KEY = 'lydia.newProject'

export function loadNewProjectChoice(): NewProjectChoice | null {
  const isSize = (n: unknown) => Number.isInteger(n) && (n as number) >= MIN_SIZE && (n as number) <= MAX_SIZE
  try {
    const saved = JSON.parse(localStorage.getItem(NEW_PROJECT_KEY) ?? 'null')
    const isValid =
      isSize(saved?.width) && isSize(saved?.height) && (saved.background === null || isColor(saved.background))
    if (!isValid) return null
    // A choice remembered before resolutions could be chosen has none
    const dpi = isDpi(saved.dpi) ? saved.dpi : DEFAULT_DPI
    return { width: saved.width, height: saved.height, background: saved.background, dpi }
  } catch {
    return null // nothing remembered, or the browser doesn't let this page keep anything
  }
}

export function saveNewProjectChoice(choice: NewProjectChoice) {
  try {
    localStorage.setItem(NEW_PROJECT_KEY, JSON.stringify(choice))
  } catch {
    // not remembered next time, but used now
  }
}

// Whether the pixel grid is on (see pixelGrid.ts). It is at first
const PIXEL_GRID_KEY = 'lydia.pixelGrid'

export function loadPixelGrid() {
  try {
    return localStorage.getItem(PIXEL_GRID_KEY) !== 'off'
  } catch {
    return true
  }
}

export function savePixelGrid(on: boolean) {
  try {
    localStorage.setItem(PIXEL_GRID_KEY, on ? 'on' : 'off')
  } catch {
    // not remembered next time, but used now
  }
}

// Whether the brush shows its outline under the pointer (see view.ts). It does at first
const BRUSH_OUTLINE_KEY = 'lydia.brushOutline'

export function loadBrushOutline() {
  try {
    return localStorage.getItem(BRUSH_OUTLINE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function saveBrushOutline(on: boolean) {
  try {
    localStorage.setItem(BRUSH_OUTLINE_KEY, on ? 'on' : 'off')
  } catch {
    // not remembered next time, but used now
  }
}

// The interface's colors (see theme.ts): "system" follows the computer's setting
export type ThemeChoice = 'system' | 'light' | 'dark'
const THEME_KEY = 'lydia.theme'

export function loadThemeChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch {
    return 'system'
  }
}

export function saveThemeChoice(choice: ThemeChoice) {
  try {
    localStorage.setItem(THEME_KEY, choice)
  } catch {
    // not remembered next time, but used now
  }
}

// The brush chosen last (its id in the brush library, see brushLibrary.ts)
const BRUSH_KEY = 'lydia.brush'

export function loadBrushId() {
  try {
    return localStorage.getItem(BRUSH_KEY)
  } catch {
    return null
  }
}

export function saveBrushId(id: string) {
  try {
    localStorage.setItem(BRUSH_KEY, id)
  } catch {
    // not remembered next time, but used now
  }
}
