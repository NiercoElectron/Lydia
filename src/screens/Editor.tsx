import { useCallback, useEffect, useState } from 'react'
import { addBrushFiles, DEFAULT_BRUSH_ID, loadBrushes, removeBrush, tipOf, type LibraryBrush } from '../brushLibrary'
import { BrushesPanel } from '../components/BrushesPanel'
import { DrawSpace } from '../components/DrawSpace'
import { useDrawingShortcuts, useEngineSnapshot, usePixelGrid } from '../components/engineHooks'
import { LayersPanel } from '../components/LayersPanel'
import { ToolColumn } from '../components/ToolColumn'
import { Toolbar } from '../components/Toolbar'
import { ALL_TOOLS } from '../components/toolList'
import { brushFileName } from '../engine/brushFile'
import type { Engine, ImageType } from '../engine/engine'
import { PROJECT_EXTENSION, type ProjectData } from '../engine/projectFile'
import type { Tool } from '../engine/tools'
import { downloadBlob, timestamp } from '../files'
import { loadBrushId, saveBrushId } from '../settings'

type Props = {
  project: ProjectData
  gpuMemory: number // GB of the graphics card's memory to use (see settings.ts)
  onBack: () => void
}

export function Editor({ project, gpuMemory, onBack }: Props) {
  const [engine, setEngine] = useState<Engine | null>(null)
  const snapshot = useEngineSnapshot(engine)
  const [tool, setTool] = useState<Tool>('brush')
  const [color, setColor] = useState('#000000')
  const [size, setSize] = useState(20)
  const [opacity, setOpacity] = useState(100) // in percent
  const [busy, setBusy] = useState<string | null>(null) // what is being done right now ("Saving…"), if anything
  const [brushes, setBrushes] = useState<LibraryBrush[]>([])
  const [brushId, setBrushId] = useState(() => loadBrushId() ?? DEFAULT_BRUSH_ID)
  const [isDroppingFiles, setIsDroppingFiles] = useState(false)
  // The chosen brush. One that is no longer in the list (deleted in another tab) falls back to Soft round
  const brush = brushes.find(b => b.id === brushId) ?? brushes.find(b => b.id === DEFAULT_BRUSH_ID)

  useEffect(() => {
    engine?.setTool(tool)
  }, [engine, tool])

  useEffect(() => {
    engine?.setBrush({ color, size, opacity: opacity / 100 })
  }, [engine, color, size, opacity])

  // Colors picked with the eyedropper become the brush's color, at full opacity: the picked color is the one the screen
  // shows, and painting it at a lower opacity would come out lighter
  useEffect(
    () =>
      engine?.onColorPick(picked => {
        setColor(picked)
        setOpacity(100)
      }),
    [engine],
  )

  useEffect(() => {
    let cancelled = false
    loadBrushes().then(list => {
      if (!cancelled) setBrushes(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Give the engine the chosen brush once its tip is ready
  useEffect(() => {
    if (!engine || !brush) return
    let cancelled = false
    tipOf(brush).then(
      tip => {
        if (!cancelled) engine.setBrushTip(tip, brush.preset)
      },
      error => alert(error instanceof Error ? error.message : 'Could not use this brush.'),
    )
    return () => {
      cancelled = true
    }
  }, [engine, brush])

  function selectBrush(chosen: LibraryBrush) {
    setBrushId(chosen.id)
    saveBrushId(chosen.id)
  }

  const importBrushes = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      const { added, problems } = await addBrushFiles(files, brushes)
      if (added.length > 0) {
        setBrushes(list => [...list, ...added])
        setBrushId(added[0].id)
        saveBrushId(added[0].id)
      }
      if (problems.length > 0) {
        const title = added.length === 0 ? 'No brush was added.' : 'Some files were not added.'
        alert(`${title}\n\n${problems.join('\n')}`)
      }
    },
    [brushes],
  )

  function exportBrush(chosen: LibraryBrush) {
    downloadBlob(new Blob([chosen.file], { type: 'application/octet-stream' }), brushFileName(chosen.preset.name))
  }

  async function deleteBrush(chosen: LibraryBrush) {
    if (!window.confirm(`Delete the brush "${chosen.preset.name}" from Lydia? Its file can be imported again.`)) return
    try {
      await removeBrush(chosen)
    } catch {
      alert('Could not delete the brush.')
      return
    }
    setBrushes(list => list.filter(b => b !== chosen))
    if (chosen.id === brushId) selectBrush(brushes.find(b => b.id === DEFAULT_BRUSH_ID)!)
  }

  // Brush files dropped anywhere on the window are imported. Without this, the browser would open a dropped file in
  // place of Lydia
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
    let depth = 0 // the drag enters and leaves every element on its way, so count how deep inside the window it is
    const handleDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setIsDroppingFiles(true)
    }
    const handleDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setIsDroppingFiles(false)
    }
    const handleDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault() // allow dropping here
      e.dataTransfer!.dropEffect = 'copy'
    }
    const handleDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setIsDroppingFiles(false)
      importBrushes([...e.dataTransfer!.files])
    }
    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('drop', handleDrop)
    }
  }, [importBrushes])

  const [isGridOn, toggleGrid] = usePixelGrid(engine)
  useDrawingShortcuts(engine, ALL_TOOLS, setTool, setSize, toggleGrid)

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
          opacity={opacity}
          isGridOn={isGridOn}
          onColorChange={setColor}
          onSizeChange={setSize}
          onOpacityChange={setOpacity}
          onGridToggle={toggleGrid}
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
        <ToolColumn tool={tool} onToolChange={setTool} />
        <BrushesPanel
          brushes={brushes}
          selectedId={brush?.id ?? brushId}
          onSelect={selectBrush}
          onImport={importBrushes}
          onExport={exportBrush}
          onDelete={deleteBrush}
        />
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
      {isDroppingFiles && <div className="drop-hint">Drop brush files to add them to Lydia</div>}
    </div>
  )
}
