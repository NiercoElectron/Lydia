import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { TaperSettings } from '../engine/dabs'
import type { Engine, EngineSnapshot } from '../engine/engine'
import type { StabilizerSettings } from '../engine/stabilizer'
import type { Tool } from '../engine/tools'
import { isTyping, type ViewState } from '../engine/view'
import {
  loadBrushOutline,
  loadPixelGrid,
  loadPixelPerfect,
  loadStabilizer,
  loadTaper,
  saveBrushOutline,
  savePixelGrid,
  savePixelPerfect,
  saveStabilizer,
  saveTaper,
} from '../settings'
import { themeColor, useTheme } from '../theme'
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from './Toolbar'
import { TOOLS } from './toolList'

// What the screen shows while the engine is starting
const startingSnapshot: EngineSnapshot = {
  layers: [],
  activeLayerId: 0,
  canUndo: false,
  canRedo: false,
  isModified: false,
  isUpdating: false,
  task: null,
  hasSelection: false,
  transform: null,
  canMergeDown: false,
  exportScale: 1,
  exportScales: [1],
}
const startingView: ViewState = { zoom: 1, rotation: 0, flipped: false }
const subscribeToNothing = () => () => {}
const getStartingSnapshot = () => startingSnapshot
const getStartingView = () => startingView

// The engine's latest state; the screen updates whenever it changes
export function useEngineSnapshot(engine: Engine | null) {
  return useSyncExternalStore(engine?.subscribe ?? subscribeToNothing, engine?.getSnapshot ?? getStartingSnapshot)
}

// The view's zoom, rotation and flip. Kept apart from the snapshot because the zoom changes many times a second while
// zooming, and only what shows it needs to update then
export function useViewState(engine: Engine | null) {
  return useSyncExternalStore(engine?.subscribeView ?? subscribeToNothing, engine?.getView ?? getStartingView)
}

// The color around the paper, as the interface's colors say (see theme.ts)
export function useBackdrop(engine: Engine | null) {
  const { theme } = useTheme()
  useEffect(() => {
    engine?.setBackdrop(themeColor('--around-paper'))
  }, [engine, theme])
}

// The pixel grid, on or off as chosen last time. The engine shows it when the view is zoomed in enough
export function usePixelGrid(engine: Engine | null) {
  const [isOn, setIsOn] = useState(loadPixelGrid)
  useEffect(() => {
    engine?.setPixelGrid(isOn)
  }, [engine, isOn])
  const toggle = useCallback(() => {
    savePixelGrid(!isOn)
    setIsOn(!isOn)
  }, [isOn])
  return [isOn, toggle] as const
}

// The brush's outline under the pointer, on or off as chosen last time
export function useBrushOutline(engine: Engine | null) {
  const [isOn, setIsOn] = useState(loadBrushOutline)
  useEffect(() => {
    engine?.setBrushOutline(isOn)
  }, [engine, isOn])
  const toggle = useCallback(() => {
    saveBrushOutline(!isOn)
    setIsOn(!isOn)
  }, [isOn])
  return [isOn, toggle] as const
}

// Whether pixel brushes leave out the doubled corners of their lines, as chosen last time
export function usePixelPerfect(engine: Engine | null) {
  const [isOn, setIsOn] = useState(loadPixelPerfect)
  useEffect(() => {
    engine?.setBrush({ pixelPerfect: isOn })
  }, [engine, isOn])
  const toggle = useCallback(() => {
    savePixelPerfect(!isOn)
    setIsOn(!isOn)
  }, [isOn])
  return [isOn, toggle] as const
}

// The stabilizer's settings, as chosen last time
export function useStabilizer(engine: Engine | null) {
  const [settings, setSettings] = useState(loadStabilizer)
  useEffect(() => {
    engine?.setStabilizer(settings)
  }, [engine, settings])
  const change = useCallback((change: Partial<StabilizerSettings>) => {
    setSettings(current => {
      const next = { ...current, ...change }
      saveStabilizer(next)
      return next
    })
  }, [])
  return [settings, change] as const
}

// How the strokes' ends thin out, as chosen last time
export function useTaper(engine: Engine | null) {
  const [taper, setTaper] = useState(loadTaper)
  useEffect(() => {
    engine?.setBrush({ taper })
  }, [engine, taper])
  const change = useCallback((change: Partial<TaperSettings>) => {
    setTaper(current => {
      const next = { ...current, ...change }
      saveTaper(next)
      return next
    })
  }, [])
  return [taper, change] as const
}

// The selection's shortcuts, as in Photoshop: Ctrl/Cmd + A selects everything, Ctrl/Cmd + D nothing, and
// Ctrl/Cmd + Shift + I what isn't selected; Delete (or Backspace) takes the paint out of what is selected
export function useSelectionShortcuts(engine: Engine | null) {
  useEffect(() => {
    if (!engine) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const key = e.key.toLowerCase()
      if (e.ctrlKey || e.metaKey) {
        if (key === 'a' && !e.shiftKey) engine.selectAll()
        else if (key === 'd' && !e.shiftKey) engine.deselect()
        else if (key === 'i' && e.shiftKey) engine.invertSelection()
        else return
        e.preventDefault() // stop the browser from using the shortcut itself (selecting the page, a bookmark…)
        return
      }
      if (key === 'delete' || key === 'backspace') {
        e.preventDefault()
        engine.deleteSelected()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [engine])
}

// Transforms, as in Photoshop: Ctrl/Cmd + T starts one, Enter applies it, and Escape leaves everything as it was.
// Browsers keep Ctrl+T for a new tab, so there the bar's Transform button starts one (the desktop app will have the
// key)
export function useTransformShortcuts(engine: Engine | null) {
  useEffect(() => {
    if (!engine) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
        e.preventDefault()
        engine.startTransform()
      } else if (e.key === 'Enter' && engine.getSnapshot().transform) {
        e.preventDefault() // a focused button would be pressed too
        engine.applyTransform()
      } else if (e.key === 'Escape') {
        engine.cancelTransform()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [engine])
}

// The layers' shortcuts, as in Photoshop: Ctrl/Cmd + J duplicates the active layer, Ctrl/Cmd + E merges it down
export function useLayerShortcuts(engine: Engine | null) {
  useEffect(() => {
    if (!engine) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'j') engine.duplicateLayer()
      else if (key === 'e') engine.mergeDown()
      else return
      e.preventDefault() // stop the browser from using the shortcut itself (downloads, the search box)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [engine])
}

// Shortcuts, like in Photoshop and Krita: Ctrl/Cmd + Z undoes, Ctrl/Cmd + Shift + Z or Ctrl + Y redoes; a letter
// chooses each of the screen's "tools" (B is the brush, E the eraser, I the eyedropper: see ToolColumn); [ and ]
// change the brush size; G turns the pixel grid on and off
export function useDrawingShortcuts<T extends Tool>(
  engine: Engine | null,
  tools: readonly T[],
  setTool: (tool: T) => void,
  setSize: (change: (size: number) => number) => void,
  toggleGrid: () => void,
) {
  useEffect(() => {
    if (!engine) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const key = e.key.toLowerCase()
      if (e.ctrlKey || e.metaKey) {
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault() // stop the browser from using the shortcut itself
          engine.undo()
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault()
          engine.redo()
        }
        return
      }
      const chosen = tools.find(tool => TOOLS[tool].key === key)
      if (chosen) setTool(chosen)
      else if (key === '[') setSize(s => Math.max(MIN_BRUSH_SIZE, Math.min(s - 1, Math.round(s / 1.25))))
      else if (key === ']') setSize(s => Math.min(MAX_BRUSH_SIZE, Math.max(s + 1, Math.round(s * 1.25))))
      else if (key === 'g') toggleGrid()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [engine, tools, setTool, setSize, toggleGrid])
}
