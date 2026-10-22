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
