import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { Tool } from '../engine/brush'
import type { Engine, EngineSnapshot } from '../engine/engine'
import { isTyping } from '../engine/view'
import { loadPixelGrid, savePixelGrid } from '../settings'
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE } from './Toolbar'

// What the screen shows while the engine is starting
const startingSnapshot: EngineSnapshot = {
  layers: [],
  activeLayerId: 0,
  canUndo: false,
  canRedo: false,
  isModified: false,
  isUpdating: false,
}
const subscribeToNothing = () => () => {}
const getStartingSnapshot = () => startingSnapshot

// The engine's latest state; the screen updates whenever it changes
export function useEngineSnapshot(engine: Engine | null) {
  return useSyncExternalStore(engine?.subscribe ?? subscribeToNothing, engine?.getSnapshot ?? getStartingSnapshot)
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

// Shortcuts, like in Photoshop and Krita: Ctrl/Cmd + Z undoes, Ctrl/Cmd + Shift + Z or Ctrl + Y redoes; B is the
// brush, E the eraser; [ and ] change the brush size; G turns the pixel grid on and off
export function useDrawingShortcuts(
  engine: Engine | null,
  setTool: (tool: Tool) => void,
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
      if (key === 'b') setTool('brush')
      else if (key === 'e') setTool('eraser')
      else if (key === '[') setSize(s => Math.max(MIN_BRUSH_SIZE, Math.min(s - 1, Math.round(s / 1.25))))
      else if (key === ']') setSize(s => Math.min(MAX_BRUSH_SIZE, Math.max(s + 1, Math.round(s * 1.25))))
      else if (key === 'g') toggleGrid()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [engine, setTool, setSize, toggleGrid])
}
