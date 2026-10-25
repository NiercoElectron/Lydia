import { useCallback, useEffect, useState } from 'react'
import { addBrushFiles, DEFAULT_BRUSH_ID, loadBrushes, removeBrush, tipOf, type LibraryBrush } from '../brushLibrary'
import { BrushesPanel } from '../components/BrushesPanel'
import { DrawSpace } from '../components/DrawSpace'
import {
  useBackdrop,
  useDrawingShortcuts,
  useEngineSnapshot,
  useBrushOutline,
  usePixelGrid,
  useStabilizer,
  useTaper,
  useSelectionShortcuts,
  useTransformShortcuts,
} from '../components/engineHooks'
import { LayersPanel } from '../components/LayersPanel'
import { ToolColumn } from '../components/ToolColumn'
import { Toolbar } from '../components/Toolbar'
import { TrayPanel } from '../components/TrayPanel'
import { ALL_TOOLS } from '../components/toolList'
import { ViewControls } from '../components/ViewControls'
import { brushFileName } from '../engine/brushFile'
import type { Engine, ImageType } from '../engine/engine'
import { DEFAULT_FILL, type FillSettings } from '../engine/fill'
import { PROJECT_EXTENSION, type ProjectData } from '../engine/projectFile'
import type { Point } from '../engine/selection'
import type { Tool } from '../engine/tools'
import { downloadBlob, timestamp } from '../files'
import { loadBrushId, saveBrushId } from '../settings'
import { freeTrayImage, isImageFile, makeTrayImages, TRAY_DRAG_TYPE, type TrayImage } from '../tray'

type Props = {
  project: ProjectData
  gpuMemory: number // GB of the graphics card's memory to use (see settings.ts)
  tray: TrayImage[] // see tray.ts
  onTrayChange: (change: (tray: TrayImage[]) => TrayImage[]) => void
  onBack: () => void
}

export function Editor({ project, gpuMemory, tray, onTrayChange, onBack }: Props) {
  const [engine, setEngine] = useState<Engine | null>(null)
  const snapshot = useEngineSnapshot(engine)
  const [tool, setTool] = useState<Tool>('brush')
  const [color, setColor] = useState('#000000')
  const [size, setSize] = useState(20)
  const [opacity, setOpacity] = useState(100) // in percent
  const [fill, setFill] = useState<FillSettings>(DEFAULT_FILL)
  const [hardSelectionEdges, setHardSelectionEdges] = useState(false)
  const [busy, setBusy] = useState<string | null>(null) // what is being done right now ("Saving…"), if anything
  const [brushes, setBrushes] = useState<LibraryBrush[]>([])
  const [brushId, setBrushId] = useState(() => loadBrushId() ?? DEFAULT_BRUSH_ID)
  const [isDroppingFiles, setIsDroppingFiles] = useState(false)
  const [isTrayOpen, setIsTrayOpen] = useState(false)
  // The chosen brush. One that is no longer in the list (deleted in another tab) falls back to Soft round
  const brush = brushes.find(b => b.id === brushId) ?? brushes.find(b => b.id === DEFAULT_BRUSH_ID)

  // Pixel art needs selections of whole pixels: a soft edge across a line would cut it in part, leaving a gray row. So
  // choosing a pixel brush makes new selections hard, and choosing another brush makes them soft again; they can still
  // be changed by hand in between
  const isPixelBrush = brush !== undefined && brush.preset.pixel !== 'none'
  const [edgesFollow, setEdgesFollow] = useState(isPixelBrush) // the kind of brush the edges were last set for
  if (edgesFollow !== isPixelBrush) {
    setEdgesFollow(isPixelBrush)
    setHardSelectionEdges(isPixelBrush)
  }

  useEffect(() => {
    engine?.setTool(tool)
  }, [engine, tool])

  useEffect(() => {
    engine?.setBrush({ color, size, opacity: opacity / 100 })
  }, [engine, color, size, opacity])

  useEffect(() => {
    engine?.setFill(fill)
  }, [engine, fill])

  useEffect(() => {
    engine?.setSelectionEdges(hardSelectionEdges)
  }, [engine, hardSelectionEdges])

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

  // Images go into the tray, which opens to show them. Returns the ones added
  const addToTray = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return []
      const { added, problems } = await makeTrayImages(files)
      if (added.length > 0) {
        onTrayChange(images => [...images, ...added])
        setIsTrayOpen(true)
      }
      if (problems.length > 0) {
        const title = added.length === 0 ? 'No image was added.' : 'Some files were not added.'
        alert(`${title}\n\n${problems.join('\n')}`)
      }
      return added
    },
    [onTrayChange],
  )

  function removeFromTray(image: TrayImage) {
    onTrayChange(images => images.filter(other => other !== image))
    freeTrayImage(image)
  }

  // Put a tray image into the drawing at this point of the paper, with the handles showing (see placeImage in
  // engine.ts)
  const placeImage = useCallback(
    async (image: TrayImage, at: Point) => {
      if (!engine) return
      try {
        await engine.placeImage(await createImageBitmap(image.file), image.name, at)
      } catch (error) {
        alert(error instanceof Error ? error.message : `Could not put ${image.name} into the drawing.`)
      }
    },
    [engine],
  )

  // Brush files dropped anywhere on the window are imported, and images go into the tray; an image dropped on the
  // drawing also goes into it there. Without this, the browser would open a dropped file in place of Lydia. Tray images
  // dragged onto the drawing go into it
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
    const isFromTray = (e: DragEvent) => e.dataTransfer?.types.includes(TRAY_DRAG_TYPE) ?? false
    // Where on the paper something dropped here would go: null away from the drawing, and over the tray itself
    const dropPoint = (e: DragEvent) => {
      const isOverTray = e.target instanceof Element && e.target.closest('.tray-panel') !== null
      return isOverTray ? null : (engine?.paperAtWindow(e.clientX, e.clientY) ?? null)
    }
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
      if (isFromTray(e)) {
        e.preventDefault()
        e.dataTransfer!.dropEffect = dropPoint(e) ? 'copy' : 'none' // only the drawing takes it
        return
      }
      if (!hasFiles(e)) return
      e.preventDefault() // allow dropping here
      e.dataTransfer!.dropEffect = 'copy'
    }
    const handleDrop = (e: DragEvent) => {
      const at = dropPoint(e)
      if (isFromTray(e)) {
        e.preventDefault()
        const image = tray.find(each => String(each.id) === e.dataTransfer!.getData(TRAY_DRAG_TYPE))
        if (image && at) placeImage(image, at)
        return
      }
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setIsDroppingFiles(false)
      const files = [...e.dataTransfer!.files]
      importBrushes(files.filter(file => !isImageFile(file)))
      addToTray(files.filter(isImageFile)).then(added => {
        if (added.length > 0 && at) placeImage(added[0], at)
      })
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
  }, [importBrushes, addToTray, placeImage, tray, engine])

  const [isGridOn, toggleGrid] = usePixelGrid(engine)
  const [isOutlineOn, toggleOutline] = useBrushOutline(engine)
  const [stabilizer, changeStabilizer] = useStabilizer(engine)
  const [taper, changeTaper] = useTaper(engine)
  useDrawingShortcuts(engine, ALL_TOOLS, setTool, setSize, toggleGrid)
  useBackdrop(engine)
  useSelectionShortcuts(engine)
  useTransformShortcuts(engine)

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
          fill={fill}
          selection={{
            hasSelection: snapshot.hasSelection,
            hardEdges: hardSelectionEdges,
            onHardEdgesChange: setHardSelectionEdges,
            onSelectAll: () => engine?.selectAll(),
            onDeselect: () => engine?.deselect(),
            onInvert: () => engine?.invertSelection(),
          }}
          transform={{
            transform: snapshot.transform,
            isSmartLayer: snapshot.layers.find(layer => layer.id === snapshot.activeLayerId)?.isSmart ?? false,
            onStart: () => engine?.startTransform(),
            onSmoothChange: smooth => engine?.setTransformSmooth(smooth),
            onApply: () => engine?.applyTransform(),
            onCancel: () => engine?.cancelTransform(),
            onConvertToPixels: () => engine?.convertToPixels(),
          }}
          stabilizer={stabilizer}
          taper={taper}
          isGridOn={isGridOn}
          isOutlineOn={isOutlineOn}
          onColorChange={setColor}
          onSizeChange={setSize}
          onOpacityChange={setOpacity}
          onFillChange={change => setFill(current => ({ ...current, ...change }))}
          onStabilizerChange={changeStabilizer}
          onTaperChange={changeTaper}
          onGridToggle={toggleGrid}
          onOutlineToggle={toggleOutline}
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
          <ViewControls engine={engine} />
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
          {(busy || snapshot.task || snapshot.isUpdating) && (
            <span className="busy">{busy ?? snapshot.task ?? 'Updating…'}</span>
          )}
        </div>
      </header>
      <div className="editor-main">
        <ToolColumn
          tool={tool}
          onToolChange={setTool}
          isTrayOpen={isTrayOpen}
          onTrayToggle={() => setIsTrayOpen(open => !open)}
        />
        <BrushesPanel
          brushes={brushes}
          selectedId={brush?.id ?? brushId}
          onSelect={selectBrush}
          onImport={importBrushes}
          onExport={exportBrush}
          onDelete={deleteBrush}
        />
        <div className="draw-area">
          <DrawSpace project={project} gpuMemory={gpuMemory} onEngineChange={setEngine} />
          {isTrayOpen && <TrayPanel images={tray} onImport={addToTray} onRemove={removeFromTray} />}
        </div>
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
      {isDroppingFiles && (
        <div className="drop-hint">
          Drop brush files or images to add them to Lydia (an image dropped on the drawing goes into it)
        </div>
      )}
    </div>
  )
}
