import { desktop } from './desktop'
import { MAX_TAPER, NO_TAPER, TAPER_THINS, type TaperSettings } from './engine/dabs'
import { DEFAULT_DPI, isColor, isDpi, MAX_SIZE, MAX_TRAY_COLORS, MIN_SIZE } from './engine/projectFile'
import { DEFAULT_STABILIZER, MAX_STABILIZER, STABILIZER_MODES, type StabilizerSettings } from './engine/stabilizer'

// Choices remembered by this browser between visits

// How much of the graphics card's memory Lydia may use to keep layers ready (see decision 28), in GB. Browsers don't
// tell how much memory the graphics card has, so there the user chooses. The desktop app chooses by itself, unless the
// user chooses
export const GPU_MEMORY_CHOICES = [0.5, 1, 2, 3, 4, 6, 8]
export const DEFAULT_GPU_MEMORY = 2
export const AUTOMATIC_GPU_MEMORY = 0
const GPU_MEMORY_KEY = 'lydia.gpuMemory'

// What the desktop app chooses: half of the graphics card's, as the settings tell anyone choosing by hand. A Mac's
// graphics card shares the RAM with everything else, so there it is a quarter of that
export function automaticGpuMemory() {
  const { ram, card } = desktop!.memory
  const share = desktop!.platform === 'darwin' ? ram / 4 : card === null ? null : card / 2
  if (share === null) return DEFAULT_GPU_MEMORY
  // A card sold as 8 GB says a little less
  return GPU_MEMORY_CHOICES.findLast(gigabytes => gigabytes * 1024 ** 3 <= share * 1.01) ?? GPU_MEMORY_CHOICES[0]
}

// What the setting comes to, in GB
export const gpuMemoryInUse = (choice: number) => (choice === AUTOMATIC_GPU_MEMORY ? automaticGpuMemory() : choice)

export function loadGpuMemory() {
  const usual = desktop ? AUTOMATIC_GPU_MEMORY : DEFAULT_GPU_MEMORY
  try {
    const saved = Number(localStorage.getItem(GPU_MEMORY_KEY))
    return GPU_MEMORY_CHOICES.includes(saved) ? saved : usual
  } catch {
    return usual // the browser doesn't let this page keep anything (a private window, for example)
  }
}

export function saveGpuMemory(gigabytes: number) {
  try {
    localStorage.setItem(GPU_MEMORY_KEY, String(gigabytes))
  } catch {
    // not remembered next time, but used now
  }
}

// Which of the editor's panels are open
export type OpenPanels = { tools: boolean; color: boolean; brushes: boolean; layers: boolean }
export const ALL_PANELS: OpenPanels = { tools: true, color: true, brushes: true, layers: true }
const PANELS_KEY = 'lydia.panels'

export function loadOpenPanels(): OpenPanels {
  try {
    const saved = JSON.parse(localStorage.getItem(PANELS_KEY) ?? 'null')
    const isPanel = (key: string) => typeof saved?.[key] === 'boolean'
    return Object.keys(ALL_PANELS).every(isPanel) ? saved : ALL_PANELS
  } catch {
    return ALL_PANELS
  }
}

export function saveOpenPanels(panels: OpenPanels) {
  try {
    localStorage.setItem(PANELS_KEY, JSON.stringify(panels))
  } catch {
    // not remembered next time, but used now
  }
}

// The brushes kept as favorites and the ones used last, by their id (see brushLibrary.ts)
export const MAX_RECENT_BRUSHES = 12
const FAVORITE_BRUSHES_KEY = 'lydia.favoriteBrushes'
const RECENT_BRUSHES_KEY = 'lydia.recentBrushes'

function loadIds(key: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function saveIds(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    // not remembered next time, but used now
  }
}

export const loadFavoriteBrushes = () => loadIds(FAVORITE_BRUSHES_KEY)
export const saveFavoriteBrushes = (ids: string[]) => saveIds(FAVORITE_BRUSHES_KEY, ids)
export const loadRecentBrushes = () => loadIds(RECENT_BRUSHES_KEY)
export const saveRecentBrushes = (ids: string[]) => saveIds(RECENT_BRUSHES_KEY, ids)

// How often the drawing is autosaved, in minutes (0: never, see autosave.ts)
export const AUTOSAVE_CHOICES = [1, 2, 5, 0]
export const DEFAULT_AUTOSAVE = 2
const AUTOSAVE_KEY = 'lydia.autosave'

export function loadAutosaveMinutes() {
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY)
    return saved !== null && AUTOSAVE_CHOICES.includes(Number(saved)) ? Number(saved) : DEFAULT_AUTOSAVE
  } catch {
    return DEFAULT_AUTOSAVE
  }
}

export function saveAutosaveMinutes(minutes: number) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, String(minutes))
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

// How big the interface is in the desktop app, in percent: a browser has its own zoom for that
export const INTERFACE_SIZES = [100, 125, 150, 175, 200]
const INTERFACE_SIZE_KEY = 'lydia.interfaceSize'

export function loadInterfaceSize() {
  try {
    const size = Number(localStorage.getItem(INTERFACE_SIZE_KEY))
    return INTERFACE_SIZES.includes(size) ? size : 100
  } catch {
    return 100
  }
}

export function saveInterfaceSize(size: number) {
  try {
    localStorage.setItem(INTERFACE_SIZE_KEY, String(size))
  } catch {
    // not remembered next time, but used now
  }
}

// Whether the pixels show as sharp squares at every zoom from 100% (the Sharp button). They don't at first
const SHARP_PIXELS_KEY = 'lydia.sharpPixels'

export function loadSharpPixels() {
  try {
    return localStorage.getItem(SHARP_PIXELS_KEY) === 'on'
  } catch {
    return false
  }
}

export function saveSharpPixels(on: boolean) {
  try {
    localStorage.setItem(SHARP_PIXELS_KEY, on ? 'on' : 'off')
  } catch {
    // not remembered next time, but used now
  }
}

// Whether pixel brushes leave out the doubled corners of their lines (see dabs.ts). They don't at first
const PIXEL_PERFECT_KEY = 'lydia.pixelPerfect'

export function loadPixelPerfect() {
  try {
    return localStorage.getItem(PIXEL_PERFECT_KEY) === 'on'
  } catch {
    return false
  }
}

export function savePixelPerfect(on: boolean) {
  try {
    localStorage.setItem(PIXEL_PERFECT_KEY, on ? 'on' : 'off')
  } catch {
    // not remembered next time, but used now
  }
}

// How strokes are smoothed (see stabilizer.ts). Off at first
const STABILIZER_KEY = 'lydia.stabilizer'

export function loadStabilizer(): StabilizerSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STABILIZER_KEY) ?? 'null')
    const isValid =
      STABILIZER_MODES.includes(saved?.mode) &&
      Number.isInteger(saved.strength) &&
      saved.strength >= 0 &&
      saved.strength <= MAX_STABILIZER
    return isValid ? { mode: saved.mode, strength: saved.strength } : DEFAULT_STABILIZER
  } catch {
    return DEFAULT_STABILIZER
  }
}

export function saveStabilizer(settings: StabilizerSettings) {
  try {
    localStorage.setItem(STABILIZER_KEY, JSON.stringify(settings))
  } catch {
    // not remembered next time, but used now
  }
}

// How the strokes' ends thin out (see dabs.ts). Not at first
const TAPER_KEY = 'lydia.taper'

export function loadTaper(): TaperSettings {
  const isLength = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= MAX_TAPER
  try {
    const saved = JSON.parse(localStorage.getItem(TAPER_KEY) ?? 'null')
    const isValid = isLength(saved?.start) && isLength(saved.end) && TAPER_THINS.includes(saved.thins)
    return isValid ? { start: saved.start, end: saved.end, thins: saved.thins } : NO_TAPER
  } catch {
    return NO_TAPER
  }
}

export function saveTaper(taper: TaperSettings) {
  try {
    localStorage.setItem(TAPER_KEY, JSON.stringify(taper))
  } catch {
    // not remembered next time, but used now
  }
}

// Whether the bar's Advanced panel stays open (see AdvancedMenu). It doesn't at first
const ADVANCED_PINNED_KEY = 'lydia.advancedPinned'

export function loadAdvancedPinned() {
  try {
    return localStorage.getItem(ADVANCED_PINNED_KEY) === 'on'
  } catch {
    return false
  }
}

export function saveAdvancedPinned(pinned: boolean) {
  try {
    localStorage.setItem(ADVANCED_PINNED_KEY, pinned ? 'on' : 'off')
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

// The colors painted with lately, the newest first (see ColorPanel.tsx)
export const MAX_RECENT_COLORS = 10
const RECENT_COLORS_KEY = 'lydia.recentColors'

export function loadRecentColors(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter(isColor).slice(0, MAX_RECENT_COLORS) : []
  } catch {
    return []
  }
}

export function saveRecentColors(colors: string[]) {
  try {
    localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(colors))
  } catch {
    // not remembered next time, but used now
  }
}

// The color tray's colors for all drawings (see ColorTray.tsx); each drawing keeps its own too, in its file
const TRAY_COLORS_KEY = 'lydia.trayColors'

export function loadTrayColors(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(TRAY_COLORS_KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter(isColor).slice(0, MAX_TRAY_COLORS) : []
  } catch {
    return []
  }
}

export function saveTrayColors(colors: string[]) {
  try {
    localStorage.setItem(TRAY_COLORS_KEY, JSON.stringify(colors))
  } catch {
    // not remembered next time, but used now
  }
}
