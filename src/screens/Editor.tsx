import { useEffect, useState, useSyncExternalStore } from 'react'
import { DrawSpace } from '../components/DrawSpace'
import { LayersPanel } from '../components/LayersPanel'
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE, Toolbar } from '../components/Toolbar'
import type { Tool } from '../engine/brush'
import type { Engine, EngineSnapshot, ImageType } from '../engine/engine'
import { PROJECT_EXTENSION, type ProjectData } from '../engine/projectFile'
import { isTyping } from '../engine/view'
import { downloadBlob, timestamp } from '../files'

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

type Props = {
  project: ProjectData
  gpuMemory: number // GB of the graphics card's memory to use (see settings.ts)
  onBack: () => void
}

export function Editor({ project, gpuMemory, onBack }: Props) {
  const [engine, setEngine] = useState<Engine | null>(null)
  // Show the engine's latest state, and update the screen whenever it changes
  const snapshot = useSyncExternalStore(
    engine?.subscribe ?? subscribeToNothing,
    engine?.getSnapshot ?? getStartingSnapshot,
  )
  const [tool, setTool] = useState<Tool>('brush')
  const [color, setColor] = useState('#000000')
  const [size, setSize] = useState(20)
  const [busy, setBusy] = useState<string | null>(null) // what is being done right now ("Saving…"), if anything

  useEffect(() => {
    engine?.setBrush({ tool, color, size })
  }, [engine, tool, color, size])

  // Shortcuts, like in Photoshop and Krita: Ctrl/Cmd + Z undoes, Ctrl/Cmd + Shift + Z or Ctrl + Y redoes; B is the
  // brush, E the eraser; [ and ] change the brush size
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
      else if (key === '[') setSize(s => Math.max(MIN_BRUSH_SIZE, Math.round(s / 1.25)))
      else if (key === ']') setSize(s => Math.min(MAX_BRUSH_SIZE, Math.max(s + 1, Math.round(s * 1.25))))
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [engine])

  // Ask before closing the tab with changes that aren't saved
  useEffect(() => {
    if (!snapshot.isModified) return
    const handleBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [snapshot.isModified])

  // Run a slow task (saving, exporting), showing what is being done meanwhile
  async function runTask(label: string, task: () => Promise<void>) {
    setBusy(label)
    try {
      await task()
    } catch (error) {
      alert(error instanceof Error ? error.message : `${label} failed.`)
    } finally {
      setBusy(null)
    }
  }

  function handleExport(type: ImageType) {
    if (!engine) return
    const extension = type === 'jpeg' ? 'jpg' : 'png' // ".jpg" is the name most programs use for JPEG files
    runTask('Exporting…', async () => downloadBlob(await engine.exportImage(type), `lydia-${timestamp()}.${extension}`))
  }

  function handleSave() {
    if (!engine) return
    runTask('Saving…', async () => downloadBlob(await engine.saveProject(), `lydia-${timestamp()}${PROJECT_EXTENSION}`))
  }

  function handleBack() {
    if (
      snapshot.isModified &&
      !window.confirm('Discard the changes to this drawing and go back to the start screen?')
    ) {
      return
    }
    onBack()
  }

  return (
    <div className="editor">
      <header className="editor-bar">
        <Toolbar
          tool={tool}
          color={color}
          size={size}
          onToolChange={setTool}
          onColorChange={setColor}
          onSizeChange={setSize}
        />
        <div className="actions">
          <button onClick={() => engine?.undo()} disabled={!snapshot.canUndo} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button onClick={() => engine?.redo()} disabled={!snapshot.canRedo} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
          <button onClick={() => engine?.clearLayer()} disabled={!engine}>
            Clear layer
          </button>
          <button onClick={() => engine?.fitToScreen()} disabled={!engine} title="Show the whole drawing (Ctrl+0)">
            Fit
          </button>
          <button onClick={() => handleExport('png')} disabled={!engine || busy !== null}>
            Export PNG
          </button>
          <button onClick={() => handleExport('jpeg')} disabled={!engine || busy !== null}>
            Export JPEG
          </button>
          <button onClick={handleSave} disabled={!engine || busy !== null}>
            Save
          </button>
          <button onClick={handleBack}>Back</button>
          {(busy || snapshot.isUpdating) && <span className="busy">{busy ?? 'Updating…'}</span>}
        </div>
      </header>
      <div className="editor-main">
        <DrawSpace project={project} gpuMemory={gpuMemory} onEngineChange={setEngine} />
        <LayersPanel
          layers={snapshot.layers}
          activeLayerId={snapshot.activeLayerId}
          onAdd={() => engine?.addLayer()}
          onDelete={() => engine?.deleteLayer()}
          onSelect={id => engine?.selectLayer(id)}
          onMove={(id, index) => engine?.moveLayer(id, index)}
          onRename={(id, name) => engine?.renameLayer(id, name)}
          onVisibleChange={(id, visible) => engine?.setLayerVisible(id, visible)}
          onOpacityChange={(id, opacity) => engine?.setLayerOpacity(id, opacity)}
          onOpacityChangeEnd={() => engine?.finishLayerOpacity()}
        />
      </div>
    </div>
  )
}
