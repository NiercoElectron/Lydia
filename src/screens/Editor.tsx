import { projectOf } from '../autosave'
import { errorMessage, LydiaError, type ErrorCode } from '../errors'
import { useLanguage } from '../i18n'
import { useCallback, useEffect, useState } from 'react'
import { addBrushFiles, DEFAULT_BRUSH_ID, loadBrushes, removeBrush, tipOf, type LibraryBrush } from '../brushLibrary'
import { BrushesPanel } from '../components/BrushesPanel'
import { DrawSpace } from '../components/DrawSpace'
import {
  useAutosave,
  useBackdrop,
  useDrawingShortcuts,
  useEngineSnapshot,
  useBrushOutline,
  usePixelGrid,
  useSharpPixels,
  usePixelPerfect,
  useStabilizer,
  useTaper,
  useLayerShortcuts,
  useSelectionShortcuts,
  useTransformShortcuts,
} from '../components/engineHooks'
import { ColorPanel } from '../components/ColorPanel'
import { ColorTray } from '../components/ColorTray'
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
import { DEFAULT_WAND, type Point, type WandSettings } from '../engine/selection'
import { hasStrength, type LiquifyMode, type StrengthTool, type Tool } from '../engine/tools'
import { downloadBlob, timestamp } from '../files'
import { isTyping } from '../engine/view'
import {
  loadBrushId,
  loadRecentColors,
  loadTrayColors,
  MAX_RECENT_COLORS,
  saveBrushId,
  saveRecentColors,
  saveTrayColors,
} from '../settings'
import { freeTrayImage, isImageFile, makeTrayImages, TRAY_DRAG_TYPE, type TrayImage } from '../tray'

type Props = {
  project: ProjectData
  gpuMemory: number // GB of the graphics card's memory to use (see settings.ts)
  tray: TrayImage[] // see tray.ts
  onTrayChange: (change: (tray: TrayImage[]) => TrayImage[]) => void
  onBack: () => void
}

export function Editor({ project: opened, gpuMemory, tray, onTrayChange, onBack }: Props) {
  const { t, locale } = useLanguage()
  // The drawing the engine starts from: the one opened, or the one in RAM when the graphics card was lost
  const [project, setProject] = useState(opened)
  const [engine, setEngine] = useState<Engine | null>(null)
  const snapshot = useEngineSnapshot(engine)
  const [tool, setTool] = useState<Tool>('brush')
  const [color, setColor] = useState('#000000')
  const [background, setBackground] = useState('#ffffff') // the color kept behind the brush's, swapped by X
  const [recentColors, setRecentColors] = useState(loadRecentColors)
  const [trayColors, setTrayColors] = useState(loadTrayColors) // the color tray's, for all drawings
  const [isColorTrayOpen, setIsColorTrayOpen] = useState(false)
  const [brushSize, setBrushSize] = useState(20)
  const [opacity, setOpacity] = useState(100) // in percent
  // Smudge's, blur's and liquify's own size and strength (in percent)
  const [mixSettings, setMixSettings] = useState<Record<StrengthTool, { size: number; strength: number }>>({
    smudge: { size: 40, strength: 50 },
    blur: { size: 40, strength: 50 },
    liquify: { size: 100, strength: 50 },
  })
  const [liquifyMode, setLiquifyMode] = useState<LiquifyMode>('push')
  const mixTool = hasStrength(tool) ? tool : null
  const size = mixTool ? mixSettings[mixTool].size : brushSize
  const setSize = useCallback(
    (change: number | ((size: number) => number)) => {
      if (!mixTool) {
        setBrushSize(change)
        return
      }
      setMixSettings(settings => {
        const mixed = settings[mixTool]
        const newSize = typeof change === 'function' ? change(mixed.size) : change
        return { ...settings, [mixTool]: { ...mixed, size: newSize } }
      })
    },
    [mixTool],
  )
  const [fill, setFill] = useState<FillSettings>(DEFAULT_FILL)
  const [wand, setWand] = useState<WandSettings>(DEFAULT_WAND)
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

  const strength = mixTool ? mixSettings[mixTool].strength : 0
  useEffect(() => {
    if (mixTool) engine?.setMixStrength(strength / 100)
  }, [engine, mixTool, strength])

  useEffect(() => {
    engine?.setLiquifyMode(liquifyMode)
  }, [engine, liquifyMode])

  useEffect(() => {
    engine?.setFill(fill)
  }, [engine, fill])

  // The colors painted with lately: each stroke of the brush and each fill puts its color first
  useEffect(
    () =>
      engine?.onPaint(used =>
        setRecentColors(colors => [used, ...colors.filter(each => each !== used)].slice(0, MAX_RECENT_COLORS)),
      ),
    [engine],
  )
  useEffect(() => saveRecentColors(recentColors), [recentColors])
  useEffect(() => saveTrayColors(trayColors), [trayColors])

  // The brush's color and the background color change places (X, as in Photoshop and Krita)
  const swapColors = useCallback(() => {
    setColor(background)
    setBackground(color)
  }, [color, background])
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.toLowerCase() === 'x') swapColors()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [swapColors])

  useEffect(() => {
    engine?.setWand(wand)
  }, [engine, wand])

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
        if (cancelled) return
        engine.setBrushTip(tip, brush.preset)
        // A drawn pixel brush starts at 1×, its tip as it was drawn (see dabs.ts)
        if (brush.preset.pixel === 'drawn') setBrushSize(Math.max(tip.image.width, tip.image.height))
      },
      error => alert(errorMessage(error, 'LYD-210')),
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
        alert(
          `${t(title)}\n\n${problems.map(problem => `${problem.name}: ${errorMessage(problem.error, 'LYD-209')}`).join('\n')}`,
        )
      }
    },
    [brushes, t],
  )

  function exportBrush(chosen: LibraryBrush) {
    downloadBlob(new Blob([chosen.file], { type: 'application/octet-stream' }), brushFileName(chosen.preset.name))
  }

  async function deleteBrush(chosen: LibraryBrush) {
    if (
      !window.confirm(
        t('Delete the brush "{name}" from Lydia? Its file can be imported again.', { name: chosen.preset.name }),
      )
    )
      return
    try {
      await removeBrush(chosen)
    } catch (error) {
      alert(errorMessage(error, 'LYD-211'))
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
        alert(
          `${t(title)}\n\n${problems.map(problem => `${problem.name}: ${errorMessage(problem.error, 'LYD-302')}`).join('\n')}`,
        )
      }
      return added
    },
    [onTrayChange, t],
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
        alert(errorMessage(error, 'LYD-303'))
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
  const [isSharpOn, toggleSharp] = useSharpPixels(engine)
  const [isPixelPerfectOn, togglePixelPerfect] = usePixelPerfect(engine)
  const [stabilizer, changeStabilizer] = useStabilizer(engine)
  const [taper, changeTaper] = useTaper(engine)
  useDrawingShortcuts(engine, ALL_TOOLS, setTool, setSize, toggleGrid)
  useBackdrop(engine)
  useSelectionShortcuts(engine)
  useLayerShortcuts(engine)
  useTransformShortcuts(engine)
  const autosave = useAutosave(engine, project.fromAutosave)

  // The graphics card is gone, with the engine. The drawing goes into a copy first, for if another one can't be had: then
  // it is in the Recover list. Then the drawing opens again here, with a new engine, and the same tools and settings
  useEffect(
    () =>
      engine?.onGraphicsLost(async drawing => {
        const saver = autosave.saver.current
        try {
          await saver?.save(drawing)
        } catch (error) {
          console.error('Could not keep a copy of the drawing:', error)
        }
        alert(new LydiaError('LYD-403').message)
        setProject({ ...projectOf(drawing), fromAutosave: saver?.id ?? '' })
      }),
    [engine, autosave.saver],
  )

  // Ask before closing the tab with changes that aren't saved
  useEffect(() => {
    if (!snapshot.isModified) return
    const handleBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [snapshot.isModified])

  // Run a slow task (saving, exporting), showing what is being done meanwhile
  async function runTask(label: string, failed: ErrorCode, task: () => Promise<void>) {
    setBusy(label)
    try {
      await task()
    } catch (error) {
      alert(errorMessage(error, failed))
    } finally {
      setBusy(null)
    }
  }

  function handleExport(type: ImageType) {
    if (!engine) return
    const extension = type === 'jpeg' ? 'jpg' : 'png' // ".jpg" is the name most programs use for JPEG files
    // An enlarged image says how many times in its name, as "@4x"
    const scale = snapshot.exportScales.includes(snapshot.exportScale) ? snapshot.exportScale : 1
    const name = `lydia-${timestamp()}${scale > 1 ? `@${scale}x` : ''}.${extension}`
    runTask('Exporting…', 'LYD-305', async () => downloadBlob(await engine.exportImage(type), name))
  }

  function handleSave() {
    if (!engine) return
    runTask('Saving…', 'LYD-106', async () => {
      downloadBlob(await engine.saveProject(), `lydia-${timestamp()}${PROJECT_EXTENSION}`)
      await autosave.saver.current?.markSaved()
    })
  }

  function handleBack() {
    if (
      snapshot.isModified &&
      !window.confirm(t('Discard the changes to this drawing and go back to the start screen?'))
    ) {
      return
    }
    // After "Discard", the last copy stays in the Recover list, in case it was a mistake
    if (!snapshot.isModified) void autosave.saver.current?.close()
    onBack()
  }

  return (
    <div className="editor">
      <header className="editor-bar">
        <Toolbar
          tool={tool}
          size={size}
          opacity={opacity}
          strength={strength}
          liquifyMode={liquifyMode}
          fill={fill}
          wand={wand}
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
            onModeChange: mode => engine?.setTransformMode(mode),
            onWarpSideChange: side => engine?.setTransformWarpSide(side),
            onApply: () => engine?.applyTransform(),
            onCancel: () => engine?.cancelTransform(),
            onConvertToPixels: () => engine?.convertToPixels(),
          }}
          symmetry={{
            symmetry: snapshot.symmetry,
            isMoving: snapshot.isMovingSymmetry,
            onChange: change => engine?.setSymmetry(change),
            onCenter: () => engine?.centerSymmetry(),
            onMovingChange: on => engine?.setMovingSymmetry(on),
          }}
          rulers={{
            rulers: snapshot.rulers,
            isEditing: snapshot.isEditingRulers,
            hasChosen: snapshot.chosenRuler !== null,
            onOnChange: on => engine?.setRulersOn(on),
            onAdd: kind => engine?.addRuler(kind),
            onEditingChange: on => engine?.setEditingRulers(on),
            onRemove: () => engine?.removeRuler(),
          }}
          stabilizer={stabilizer}
          taper={taper}
          isGridOn={isGridOn}
          isOutlineOn={isOutlineOn}
          isSharpOn={isSharpOn}
          isAlphaLocked={snapshot.layers.find(layer => layer.id === snapshot.activeLayerId)?.alphaLocked ?? false}
          isFolder={snapshot.layers.find(layer => layer.id === snapshot.activeLayerId)?.isFolder ?? false}
          isPixelBrush={isPixelBrush}
          isPixelPerfectOn={isPixelPerfectOn}
          onSizeChange={setSize}
          onOpacityChange={setOpacity}
          onStrengthChange={value =>
            mixTool &&
            setMixSettings(settings => ({ ...settings, [mixTool]: { ...settings[mixTool], strength: value } }))
          }
          onLiquifyModeChange={setLiquifyMode}
          onFillChange={change => setFill(current => ({ ...current, ...change }))}
          onWandChange={change => setWand(current => ({ ...current, ...change }))}
          onStabilizerChange={changeStabilizer}
          onTaperChange={changeTaper}
          onGridToggle={toggleGrid}
          onOutlineToggle={toggleOutline}
          onSharpToggle={toggleSharp}
          onPixelPerfectToggle={togglePixelPerfect}
        />
        <div className="actions">
          <button onClick={() => engine?.undo()} disabled={!snapshot.canUndo} title={t('Undo (Ctrl+Z)')}>
            {t('Undo')}
          </button>
          <button onClick={() => engine?.redo()} disabled={!snapshot.canRedo} title={t('Redo (Ctrl+Shift+Z)')}>
            {t('Redo')}
          </button>
          <button onClick={() => engine?.clearLayer()} disabled={!engine}>
            {t('Clear layer')}
          </button>
          <ViewControls engine={engine} />
          <button onClick={() => handleExport('png')} disabled={!engine || busy !== null}>
            {t('Export PNG')}
          </button>
          <button onClick={() => handleExport('jpeg')} disabled={!engine || busy !== null}>
            {t('Export JPEG')}
          </button>
          <label title={t('How many times bigger images are exported, each pixel a square of pixels (for pixel art)')}>
            {t('Scale')}
            <select
              value={snapshot.exportScale}
              disabled={!engine || snapshot.exportScales.length < 2}
              onChange={e => engine?.setExportScale(Number(e.target.value))}
            >
              {snapshot.exportScales.map(scale => (
                <option key={scale} value={scale}>
                  {scale}×
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={handleSave}
            disabled={!engine || busy !== null}
            title={
              autosave.lastTime === null
                ? undefined
                : t('Autosaved at {time}', { time: new Date(autosave.lastTime).toLocaleTimeString(locale) })
            }
          >
            {t('Save')}
          </button>
          {autosave.failure && <span className="notice">{autosave.failure}</span>}
          <button onClick={handleBack}>{t('Back')}</button>
          {(busy || snapshot.task || snapshot.isUpdating) && (
            <span className="busy">
              {t(busy ?? snapshot.task ?? 'Updating…')}
              {!busy && snapshot.task && snapshot.progress !== null && (
                <progress value={snapshot.progress} aria-label={t(snapshot.task)} />
              )}
            </span>
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
          {isColorTrayOpen && (
            <ColorTray
              color={color}
              general={trayColors}
              drawing={snapshot.trayColors}
              onPick={setColor}
              onGeneralChange={setTrayColors}
              onDrawingChange={colors => engine?.setTrayColors(colors)}
            />
          )}
        </div>
        <div className="side-panels">
          <ColorPanel
            color={color}
            background={background}
            recent={recentColors}
            isTrayOpen={isColorTrayOpen}
            onColorChange={setColor}
            onSwap={swapColors}
            onTrayToggle={() => setIsColorTrayOpen(open => !open)}
          />
          <LayersPanel
            layers={snapshot.layers}
            activeLayerId={snapshot.activeLayerId}
            canDelete={snapshot.canDelete}
            canMergeDown={snapshot.canMergeDown}
            onAdd={() => engine?.addLayer()}
            onAddFolder={() => engine?.addFolder()}
            onAddOutside={() => engine?.addLayerOutside()}
            onDelete={() => engine?.deleteLayer()}
            onDuplicate={() => engine?.duplicateLayer()}
            onMergeDown={() => engine?.mergeDown()}
            onSelect={id => engine?.selectLayer(id)}
            onMove={(id, parentId, aboveId) => engine?.moveLayer(id, parentId, aboveId)}
            onRename={(id, name) => engine?.renameLayer(id, name)}
            onVisibleChange={(id, visible) => engine?.setLayerVisible(id, visible)}
            onOpenChange={(id, open) => engine?.setFolderOpen(id, open)}
            onOffPaperChange={(id, show) => engine?.setLayerOffPaper(id, show)}
            onAlphaLockChange={(id, locked) => engine?.setLayerAlphaLock(id, locked)}
            onClipChange={(id, clipped) => engine?.setLayerClipped(id, clipped)}
            onBlendModeChange={(id, mode) => engine?.setLayerBlendMode(id, mode)}
            onOpacityChange={(id, opacity) => engine?.setLayerOpacity(id, opacity)}
            onOpacityChangeEnd={() => engine?.finishLayerOpacity()}
          />
        </div>
      </div>
      {isDroppingFiles && (
        <div className="drop-hint">
          {t('Drop brush files or images to add them to Lydia (an image dropped on the drawing goes into it)')}
        </div>
      )}
    </div>
  )
}
