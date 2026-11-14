import { projectOf } from '../autosave'
import type { FilterKind } from '../engine/filters'
import { errorMessage, LydiaError, type ErrorCode, type ImportProblem } from '../errors'
import { useLanguage } from '../i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addBrushFiles,
  DEFAULT_BRUSH_ID,
  loadBrushes,
  removeBrush,
  tipOf,
  type BrushNote,
  type LibraryBrush,
} from '../brushLibrary'
import { BrushImportReport } from '../components/BrushImportReport'
import { NewProjectDialog } from '../components/NewProjectDialog'
import { useProjectOpening } from '../components/projectOpening'
import { UnsavedDialog, type UnsavedAnswer } from '../components/UnsavedDialog'
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
import { MenuBar, type Menu } from '../components/MenuBar'
import { SettingsMenu } from '../components/SettingsMenu'
import { ColorTray } from '../components/ColorTray'
import { LayersPanel } from '../components/LayersPanel'
import { ToolColumn } from '../components/ToolColumn'
import { Toolbar } from '../components/Toolbar'
import { TrayPanel } from '../components/TrayPanel'
import { TextBox } from '../components/TextBox'
import { ALL_TOOLS } from '../components/toolList'
import { ViewControls } from '../components/ViewControls'
import { brushFileName } from '../engine/brushFile'
import type { Engine, ImageType } from '../engine/engine'
import type { BlendMode } from '../engine/layers'
import { Redo2, Undo2 } from 'lucide-react'
import { DEFAULT_FILL, type FillSettings } from '../engine/fill'
import { PROJECT_EXTENSION, type ProjectData } from '../engine/projectFile'
import { DEFAULT_WAND, type Point, type WandSettings } from '../engine/selection'
import { hasStrength, type LiquifyMode, type StrengthTool, type Tool } from '../engine/tools'
import { desktop, nameOfFile, sameItems, writeFile } from '../desktop'
import { downloadBlob, timestamp } from '../files'
import { PIXEL_GRID_ZOOM } from '../engine/pixelGrid'
import { isTyping } from '../engine/view'
import {
  loadBrushId,
  loadOpenPanels,
  loadRecentColors,
  loadTrayColors,
  MAX_RECENT_COLORS,
  saveBrushId,
  saveOpenPanels,
  saveRecentColors,
  saveTrayColors,
  type OpenPanels,
} from '../settings'
import {
  addToTrayFolder,
  freeTrayImage,
  isImageFile,
  makeTrayImages,
  removeFromTrayFolder,
  TRAY_DRAG_TYPE,
  type TrayImage,
} from '../tray'

const REPOSITORY = 'https://github.com/NiercoElectron/Lydia/blob/main'
const GUIDE_URL = `${REPOSITORY}/docs/guide.md`
const CHANGES_URL = `${REPOSITORY}/CHANGELOG.md`

const EXPORTED_SHOWN_MS = 6000 // how long the name of an exported image stays on the bar

type Props = {
  project: ProjectData
  gpuMemory: number // GB of the graphics card's memory to use (see settings.ts)
  tray: TrayImage[] // see tray.ts
  onTrayChange: (change: (tray: TrayImage[]) => TrayImage[]) => void
  wantsToLeave: boolean // another project is waiting to open: leave this one, asking first if it has changes
  onStay: () => void // this drawing stays open after that
  onBack: () => void
  onOpenProject: (project: ProjectData) => void // another drawing takes this one's place
}

export function Editor({
  project: opened,
  gpuMemory,
  tray,
  onTrayChange,
  wantsToLeave,
  onStay,
  onBack,
  onOpenProject,
}: Props) {
  const { t, locale } = useLanguage()
  const [filePath, setFilePath] = useState(opened.file ?? null) // where it is saved, in the desktop app
  const [exported, setExported] = useState<string | null>(null) // the image just exported, shown for a moment
  const drawingName = filePath === null ? null : nameOfFile(filePath)
  // The drawing the engine starts from: the one opened, or the one in RAM when the graphics card was lost
  const [project, setProject] = useState(opened)
  const [engine, setEngine] = useState<Engine | null>(null)
  const snapshot = useEngineSnapshot(engine)
  const [tool, setTool] = useState<Tool>('brush')
  const [color, setColor] = useState('#000000')
  const [background, setBackground] = useState('#ffffff') // the color kept behind the brush's, swapped by X
  const [recentColors, setRecentColors] = useState(loadRecentColors)
  const [trayColors, setTrayColors] = useState(loadTrayColors) // the color tray's, for all drawings
  const [brushSize, setBrushSize] = useState(20)
  const [opacity, setOpacity] = useState(100) // in percent
  const [brushBlend, setBrushBlend] = useState<BlendMode>('normal')
  // The spacing chosen for each brush, in percent, while this drawing is open: the brush itself keeps its own
  const [spacings, setSpacings] = useState<Record<string, number>>({})
  const [importReport, setImportReport] = useState<{
    added: number
    notes: BrushNote[]
    problems: ImportProblem[]
  } | null>(null) // what was left out of brushes from other apps, until it has been read
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
  const [panels, setPanels] = useState(loadOpenPanels)
  const togglePanel = (panel: keyof OpenPanels) =>
    setPanels(current => {
      const next = { ...current, [panel]: !current[panel] }
      saveOpenPanels(next)
      return next
    })
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
    engine?.setBrush({ color, size, opacity: opacity / 100, blendMode: brushBlend })
  }, [engine, color, size, opacity, brushBlend])

  const chosenSpacing = brush && spacings[brush.id]
  // What the brush has, worked out for this size when it grows with its square root (see brushFile.ts)
  const ownSpacing = !brush
    ? 0
    : brush.preset.rootSpacing
      ? brush.preset.rootSpacing / Math.sqrt(size)
      : brush.preset.spacing
  const spacingNow = chosenSpacing ?? Math.max(1, Math.round(ownSpacing * 100))
  useEffect(() => {
    engine?.setBrush({ spacing: chosenSpacing === undefined ? null : chosenSpacing / 100 })
  }, [engine, chosenSpacing])

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
    const load = () => {
      loadBrushes().then(list => {
        if (!cancelled) setBrushes(current => (sameItems(current, list) ? current : list))
      })
    }
    load()
    // What is copied into the Brushes folder shows up on coming back to Lydia
    if (desktop) window.addEventListener('focus', load)
    return () => {
      cancelled = true
      window.removeEventListener('focus', load)
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
      const { added, problems, notes } = await addBrushFiles(files, brushes)
      if (added.length > 0) {
        setBrushes(list => [...list, ...added])
        setBrushId(added[0].id)
        saveBrushId(added[0].id)
      }
      if (notes.length > 0) setImportReport({ added: added.length, notes, problems })
      else if (problems.length > 0) {
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
      const { added, problems } = await (desktop ? addToTrayFolder(files) : makeTrayImages(files))
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

  async function removeFromTray(image: TrayImage) {
    try {
      if (image.keptAs) await removeFromTrayFolder(image)
    } catch (error) {
      alert(errorMessage(error, 'LYD-306'))
      return
    }
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
    const name = `${drawingName ?? 'lydia'}-${timestamp()}${scale > 1 ? `@${scale}x` : ''}.${extension}`
    runTask('Exporting…', 'LYD-305', async () => {
      const image = await engine.exportImage(type)
      if (!desktop) {
        downloadBlob(image, name)
        return
      }
      await writeFile(await desktop.exportPath(name), image)
      setExported(name)
    })
  }

  // Ctrl+S: in the desktop app, over the drawing's own file, once it has one. "asNew" always asks where. Whether it was
  // saved: not when the system's window was closed, or saving failed
  async function handleSave(asNew = false) {
    if (!engine || busy !== null) return false
    let isSaved = false
    await runTask('Saving…', 'LYD-106', async () => {
      if (desktop) {
        const target = (!asNew && filePath) || (await desktop.chooseToSave(drawingName ?? t('Untitled')))
        if (!target) return
        try {
          await writeFile(target, await engine.saveProject())
        } catch (error) {
          engine.noteNotSaved()
          throw error
        }
        setFilePath(target)
      } else {
        downloadBlob(await engine.saveProject(), `lydia-${timestamp()}${PROJECT_EXTENSION}`)
      }
      await autosave.saver.current?.markSaved()
      isSaved = true
    })
    return isSaved
  }

  // Another drawing, or the start screen, takes this one's place: File > New and Open, Back, and a project the system
  // opens. With changes not saved, it asks first whether to save them (see UnsavedDialog.tsx); "stay" is for when the
  // drawing stays open after all
  const [question, setQuestion] = useState<{ next: () => void; stay?: () => void } | null>(null)
  const isLeaving = useRef(false) // asking, or saving before leaving: another request to leave waits for the answer
  const [isChoosingNew, setIsChoosingNew] = useState(false) // the window for a new drawing is open
  const opening = useProjectOpening(chosen => leave(() => onOpenProject(chosen)))

  function leave(next: () => void, stay?: () => void) {
    if (isLeaving.current) return
    isLeaving.current = true
    if (snapshot.isModified) {
      setQuestion({ next, stay })
      return
    }
    void autosave.saver.current?.close()
    next()
  }

  async function answer(choice: UnsavedAnswer) {
    const { next, stay } = question!
    setQuestion(null)
    const isSaved = choice === 'save' && (await handleSave())
    if (choice === 'cancel' || (choice === 'save' && !isSaved)) {
      isLeaving.current = false
      stay?.()
      return
    }
    // After "Discard", the last copy stays in the Recover list, in case it was a mistake
    if (isSaved) await autosave.saver.current?.close()
    next()
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 's') {
        e.preventDefault()
        void handleSave(e.shiftKey && desktop !== undefined)
      } else if ((key === 'n' || key === 'o') && !e.shiftKey && !isTyping(e.target)) {
        // A browser keeps Ctrl+N for itself, and opens a window of its own: only the desktop app gets it
        e.preventDefault()
        if (busy !== null || question !== null || isChoosingNew) return
        if (key === 'n') setIsChoosingNew(true)
        else opening.open()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  useEffect(() => {
    if (wantsToLeave) leave(onBack, onStay)
  })

  useEffect(() => {
    if (exported === null) return
    const timer = setTimeout(() => setExported(null), EXPORTED_SHOWN_MS)
    return () => clearTimeout(timer)
  }, [exported])

  useEffect(() => {
    document.title = drawingName === null ? 'Lydia' : `${drawingName}${snapshot.isModified ? ' *' : ''} - Lydia`
    return () => {
      document.title = 'Lydia'
    }
  }, [drawingName, snapshot.isModified])

  const thumbnailOf = useCallback((id: number) => engine?.layerThumbnail(id) ?? null, [engine])
  const cantExport = !engine || busy !== null || snapshot.filter !== null || snapshot.typing !== null

  const activeLayer = snapshot.layers.find(layer => layer.id === snapshot.activeLayerId)
  const menus: Menu[] = [
    {
      title: t('File'),
      items: [
        { label: t('New project…'), keys: 'Ctrl+N', onClick: () => setIsChoosingNew(true), disabled: busy !== null },
        {
          label: t('Open project'),
          keys: 'Ctrl+O',
          onClick: opening.open,
          disabled: busy !== null || opening.isOpening,
        },
        null,
        {
          label: t('Save'),
          keys: 'Ctrl+S',
          onClick: () => handleSave(),
          disabled: !engine || busy !== null,
          hint:
            autosave.lastTime === null
              ? undefined
              : t('Autosaved at {time}', { time: new Date(autosave.lastTime).toLocaleTimeString(locale) }),
        },
        ...(desktop
          ? [
              {
                label: t('Save as…'),
                keys: 'Ctrl+Shift+S',
                onClick: () => handleSave(true),
                disabled: !engine || busy !== null,
              },
            ]
          : []),
        null,
        { label: t('Export PNG'), onClick: () => handleExport('png'), disabled: cantExport },
        { label: t('Export JPEG'), onClick: () => handleExport('jpeg'), disabled: cantExport },
        ...(desktop ? [{ label: t('Open Lydia folder'), onClick: () => void desktop?.openFolder() }] : []),
        null,
        { label: t('Back'), onClick: () => leave(onBack) },
      ],
      extra: (
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
      ),
    },
    {
      title: t('Edit'),
      items: [
        { label: t('Undo'), keys: 'Ctrl+Z', onClick: () => engine?.undo(), disabled: !snapshot.canUndo },
        { label: t('Redo'), keys: 'Ctrl+Shift+Z', onClick: () => engine?.redo(), disabled: !snapshot.canRedo },
        null,
        { label: t('Transform'), keys: 'Ctrl+T', onClick: () => engine?.startTransform(), disabled: !engine },
        { label: t('Clear layer'), onClick: () => engine?.clearLayer(), disabled: !engine },
      ],
    },
    {
      title: t('Layer'),
      items: [
        { label: t('New layer'), onClick: () => engine?.addLayer(), disabled: !engine },
        {
          label: t('New folder'),
          hint: t('Add a folder to keep layers in (Ctrl+G puts the active layer in a new one)'),
          onClick: () => engine?.addFolder(),
          disabled: !engine,
        },
        {
          label: t('New layer outside'),
          hint: t('Add a layer above the folder the active layer is in (or above the active folder), out of it'),
          onClick: () => engine?.addLayerOutside(),
          disabled: !activeLayer || (!activeLayer.isFolder && activeLayer.parentId === null),
        },
        null,
        { label: t('Duplicate'), keys: 'Ctrl+J', onClick: () => engine?.duplicateLayer(), disabled: !activeLayer },
        {
          label: t(activeLayer?.isFolder ? 'Merge folder' : 'Merge down'),
          keys: 'Ctrl+E',
          onClick: () => engine?.mergeDown(),
          disabled: !snapshot.canMergeDown,
        },
        {
          label: t(activeLayer?.isFolder ? 'Delete folder' : 'Delete layer'),
          onClick: () => engine?.deleteLayer(),
          disabled: !snapshot.canDelete,
        },
      ],
    },
    {
      title: t('Filter'),
      items: (['hue', 'levels', 'blur'] as FilterKind[]).map(kind => ({
        label: t({ hue: 'Hue and saturation', levels: 'Levels', blur: 'Gaussian blur' }[kind]),
        onClick: () => engine?.startFilter(kind),
        disabled: !snapshot.canFilter || snapshot.filter !== null,
      })),
    },
    {
      title: t('Select'),
      items: [
        { label: t('Select all'), keys: 'Ctrl+A', onClick: () => engine?.selectAll(), disabled: !engine },
        { label: t('Deselect'), keys: 'Ctrl+D', onClick: () => engine?.deselect(), disabled: !snapshot.hasSelection },
        { label: t('Invert'), keys: 'Ctrl+Shift+I', onClick: () => engine?.invertSelection(), disabled: !engine },
      ],
    },
    {
      title: t('View'),
      items: [
        { label: t('Fit'), keys: 'Ctrl+0', onClick: () => engine?.fitToScreen(), disabled: !engine },
        { label: t('Flip'), keys: 'M', onClick: () => engine?.flipView(), disabled: !engine },
        null,
        {
          label: t('Grid'),
          keys: 'G',
          hint: t('Pixel grid, shown from {zoom}% zoom (G)', { zoom: PIXEL_GRID_ZOOM * 100 }),
          onClick: toggleGrid,
          isOn: isGridOn,
        },
        {
          label: t('Sharp'),
          hint: t('Show the pixels as sharp squares when zoomed in, instead of smoothing them'),
          onClick: toggleSharp,
          isOn: isSharpOn,
        },
        {
          label: t('Brush outline'),
          hint: t('The outline of the brush under the pointer'),
          onClick: toggleOutline,
          isOn: isOutlineOn,
        },
      ],
    },
    {
      title: t('Window'),
      items: [
        { label: t('Tools'), onClick: () => togglePanel('tools'), isOn: panels.tools },
        { label: t('Color'), onClick: () => togglePanel('color'), isOn: panels.color },
        { label: t('Brushes'), onClick: () => togglePanel('brushes'), isOn: panels.brushes },
        { label: t('Layers'), onClick: () => togglePanel('layers'), isOn: panels.layers },
        null,
        { label: t('Tray'), onClick: () => setIsTrayOpen(open => !open), isOn: isTrayOpen },
      ],
    },
    {
      title: t('Help'),
      items: [
        { label: t('Guide'), onClick: () => window.open(GUIDE_URL, '_blank', 'noopener') },
        { label: t('What changed'), onClick: () => window.open(CHANGES_URL, '_blank', 'noopener') },
      ],
    },
  ]

  const toolOptions = (
    <Toolbar
      tool={tool}
      onToolChange={setTool}
      size={size}
      opacity={opacity}
      brushBlend={brushBlend}
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
        isSmartLayer: activeLayer?.isSmart ?? false,
        isShapeLayer: snapshot.isShapeLayer,
        isTextLayer: snapshot.isTextLayer,
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
      filter={{
        filter: snapshot.filter,
        onChange: change => engine?.setFilter(change),
        onApply: () => engine?.applyFilter(),
        onCancel: () => engine?.cancelFilter(),
      }}
      shape={{
        style: snapshot.shapeStyle,
        isEditing: snapshot.isEditingShape,
        onEditingChange: on => engine?.setEditingShape(on),
        onChange: change => engine?.setShapeStyle(change),
        onCommit: () => engine?.commitShapeStyle(),
        onColor: part => engine?.setShapeColor(part),
        onTakeBrush: () => engine?.takeBrushForShape(),
      }}
      text={{
        style: snapshot.textStyle,
        isTyping: snapshot.typing !== null,
        isFontHere: snapshot.typing?.isFontHere ?? true,
        onChange: change => engine?.setTextStyle(change),
        onEdit: () => engine?.editText(),
        onDone: () => engine?.finishText(),
        onCancel: () => engine?.cancelText(),
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
      isAlphaLocked={activeLayer?.alphaLocked ?? false}
      isFolder={activeLayer?.isFolder ?? false}
      isPixelBrush={isPixelBrush}
      isPixelPerfectOn={isPixelPerfectOn}
      onSizeChange={setSize}
      onOpacityChange={setOpacity}
      onBrushBlendChange={setBrushBlend}
      spacing={spacingNow}
      onSpacingChange={spacing => brush && setSpacings(list => ({ ...list, [brush.id]: spacing }))}
      onStrengthChange={value =>
        mixTool && setMixSettings(settings => ({ ...settings, [mixTool]: { ...settings[mixTool], strength: value } }))
      }
      onLiquifyModeChange={setLiquifyMode}
      onFillChange={change => setFill(current => ({ ...current, ...change }))}
      onWandChange={change => setWand(current => ({ ...current, ...change }))}
      onStabilizerChange={changeStabilizer}
      onTaperChange={changeTaper}
      onPixelPerfectToggle={togglePixelPerfect}
    />
  )

  return (
    <div className="editor">
      {importReport && <BrushImportReport {...importReport} onClose={() => setImportReport(null)} />}
      {opening.input}
      {isChoosingNew && (
        <NewProjectDialog
          onCreate={created => {
            setIsChoosingNew(false)
            leave(() => onOpenProject(created))
          }}
          onCancel={() => setIsChoosingNew(false)}
        />
      )}
      {question && <UnsavedDialog name={drawingName} onAnswer={choice => void answer(choice)} />}
      <header className="editor-bar">
        <MenuBar menus={menus} />
        <div className="top-row">
          <button
            className="top-icon"
            aria-label={t('Undo')}
            title={t('Undo (Ctrl+Z)')}
            onClick={() => engine?.undo()}
            disabled={!snapshot.canUndo}
          >
            <Undo2 size={20} aria-hidden />
          </button>
          <button
            className="top-icon"
            aria-label={t('Redo')}
            title={t('Redo (Ctrl+Shift+Z)')}
            onClick={() => engine?.redo()}
            disabled={!snapshot.canRedo}
          >
            <Redo2 size={20} aria-hidden />
          </button>
          {exported && <span className="notice">{t('Exported: {name}', { name: exported })}</span>}
          {autosave.failure && <span className="notice">{autosave.failure}</span>}
          <SettingsMenu />
        </div>
      </header>
      <div className="editor-main">
        <div className="editor-work">
          <div className="editor-row">
            {(panels.tools || panels.color) && (
              <div className="left-panels">
                {panels.tools && (
                  <ToolColumn
                    tool={tool}
                    onToolChange={setTool}
                    canFilter={snapshot.canFilter && snapshot.filter === null}
                    onFilter={kind => engine?.startFilter(kind)}
                    isTrayOpen={isTrayOpen}
                    onTrayToggle={() => setIsTrayOpen(open => !open)}
                  />
                )}
                {panels.color && (
                  <div className="color-side">
                    <ColorPanel
                      color={color}
                      background={background}
                      recent={recentColors}
                      onColorChange={setColor}
                      onSwap={swapColors}
                    />
                    <ColorTray
                      color={color}
                      general={trayColors}
                      drawing={snapshot.trayColors}
                      onPick={setColor}
                      onGeneralChange={setTrayColors}
                      onDrawingChange={colors => engine?.setTrayColors(colors)}
                    />
                    {toolOptions}
                  </div>
                )}
              </div>
            )}
            <div className="draw-area">
              <DrawSpace project={project} gpuMemory={gpuMemory} onEngineChange={setEngine}>
                {snapshot.typing && <TextBox engine={engine} typing={snapshot.typing} />}
              </DrawSpace>
              {isTrayOpen && <TrayPanel images={tray} onImport={addToTray} onRemove={removeFromTray} />}
            </div>
          </div>
          <footer className="draw-footer">
            <div className="panel-dock">
              <button
                aria-pressed={panels.tools}
                onClick={() => togglePanel('tools')}
                title={t('Show or hide the tools')}
              >
                {t('Tools')}
              </button>
              <button
                aria-pressed={panels.color}
                onClick={() => togglePanel('color')}
                title={t('Show or hide the color')}
              >
                {t('Color')}
              </button>
              <span className="paper-size">
                {project.width} × {project.height} px
              </span>
              {(busy || snapshot.task || snapshot.isUpdating) && (
                <span className="busy">
                  {t(busy ?? snapshot.task ?? 'Updating…')}
                  {!busy && snapshot.task && snapshot.progress !== null && (
                    <progress value={snapshot.progress} aria-label={t(snapshot.task)} />
                  )}
                </span>
              )}
            </div>
            <ViewControls engine={engine} />
          </footer>
        </div>
        {(panels.brushes || panels.layers) && (
          <div className="side-panels">
            {panels.brushes && (
              <BrushesPanel
                brushes={brushes}
                selectedId={brush?.id ?? brushId}
                onSelect={selectBrush}
                onImport={importBrushes}
                onExport={exportBrush}
                onDelete={deleteBrush}
                onClose={() => togglePanel('brushes')}
              />
            )}
            {panels.layers && (
              <LayersPanel
                layers={snapshot.layers}
                activeLayerId={snapshot.activeLayerId}
                canDelete={snapshot.canDelete}
                paperColor={snapshot.paperColor}
                isPaperShown={snapshot.isPaperShown}
                thumbnailOf={thumbnailOf}
                onAdd={() => engine?.addLayer()}
                onAddFolder={() => engine?.addFolder()}
                onDelete={() => engine?.deleteLayer()}
                onDuplicate={() => engine?.duplicateLayer()}
                onPaperShownChange={shown => engine?.setPaperShown(shown)}
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
            )}
          </div>
        )}
      </div>
      {isDroppingFiles && (
        <div className="drop-hint">
          {t('Drop brush files or images to add them to Lydia (an image dropped on the drawing goes into it)')}
        </div>
      )}
    </div>
  )
}
