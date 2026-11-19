import { errorMessage, LydiaError } from '../errors'
import { useLanguage } from '../i18n'
import { Redo2, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { builtInBrush, saveBrush, tipOf, type LibraryBrush } from '../brushLibrary'
import { BrushShapeControls, type GrainChoice } from '../components/BrushShapeControls'
import { BrushTestArea } from '../components/BrushTestArea'
import { DrawSpace } from '../components/DrawSpace'
import { MenuBar, type Menu } from '../components/MenuBar'
import { SavedNotice, type Saved } from '../components/SavedNotice'
import { SliderValue } from '../components/SliderValue'
import {
  useBackdrop,
  useBrushOutline,
  useDrawingShortcuts,
  useEngineSnapshot,
  usePixelGrid,
  useSharpPixels,
  useStabilizer,
  useStrokeOpen,
  useTaper,
} from '../components/engineHooks'
import { ToolColumn } from '../components/ToolColumn'
import { MAX_BRUSH_SIZE, MIN_BRUSH_SIZE, StabilizerControls, StrokeButton, TaperControls } from '../components/Toolbar'
import { ViewControls } from '../components/ViewControls'
import {
  brushFileName,
  DEFAULT_SHAPE,
  serializeBrushFile,
  type BrushPreset,
  type BrushShape,
} from '../engine/brushFile'
import { decodeTip, invertedPaper, paperOfImage, paperOfTip, tipFromPicture, type BrushTip } from '../engine/brushTip'
import type { Engine } from '../engine/engine'
import { PIXEL_GRID_ZOOM } from '../engine/pixelGrid'
import { newProject } from '../engine/projectFile'
import type { PaintTool } from '../engine/tools'
import { downloadBlob } from '../files'
import { saveBrushId } from '../settings'

const DEFAULT_NAME = 'My brush'
const MAX_NAME_LENGTH = 100

// The paper is painted with one of Lydia's own round brushes: soft or hard edge
type Edge = 'soft' | 'hard'
const ROUND_BRUSHES: Record<Edge, string> = { soft: 'soft-round', hard: 'hard-round' }

// A pixel brush's tip is drawn with Lydia's Pixel brush, a pixel at a time, and the new brush starts placing its tip
// at every pixel, as the Pixel brush does, at one size whatever the pen's pressure
const PIXEL_DRAWING_BRUSH = 'pixel'
const PIXEL_SHAPE: BrushShape = { ...DEFAULT_SHAPE, spacing: 0.01, pressureSize: false, pixel: 'drawn' }

// The tip is drawn with the brush and the eraser only
const DESIGNER_TOOLS: readonly PaintTool[] = ['brush', 'eraser']

// The settings of a brush as it is in its file
function shapeOf(preset: BrushPreset): BrushShape {
  const shape: Partial<BrushPreset> = { ...preset }
  delete shape.name
  delete shape.tip
  delete shape.grain
  return shape as BrushShape
}

// The text of a brush's file. The grain's picture goes in only when it has some depth
function brushFile(name: string, tip: Uint8Array, shape: BrushShape, grain: GrainChoice | null) {
  return serializeBrushFile({ name, tip, ...shape, grain: shape.grainDepth > 0 ? grain?.png : undefined })
}

// The color that paints this much (in percent): black paints fully, white not at all
function grayFor(strength: number) {
  const level = Math.round(255 * (1 - strength / 100))
    .toString(16)
    .padStart(2, '0')
  return `#${level}${level}${level}`
}

type Props = {
  tipSize: number // the paper's width and height, in pixels
  pixel: boolean // the brush is a pixel brush, its tip drawn pixel by pixel (see brushFile.ts)
  brush?: LibraryBrush // the brush it starts from, with its tip on the paper and its settings; none for a new brush
  gpuMemory: number // GB of the graphics card's memory to use (see settings.ts)
  onBack: () => void
}

// The Brush Designer: draw the tip of a new brush on a small paper, or change a brush, choose how the tip is placed
// along a stroke, try it, and keep it in the brushes or as a file (decisions 30 and 70). It is laid out like the editor
// (decision 91): menus and saving on top, the brush and the eraser with their settings at the left, the paper, and the
// brush at the right, with the area to try it always in sight. A pixel brush's tip paints
// fully or not at all: it is drawn in black only, and its edges, strength and the settings that turn the tip are left
// out
export function BrushDesigner({ tipSize, pixel, brush, gpuMemory, onBack }: Props) {
  const { t } = useLanguage()
  const [paper] = useState(() => newProject(tipSize, tipSize))
  const [engine, setEngine] = useState<Engine | null>(null)
  const snapshot = useEngineSnapshot(engine)
  const [tool, setTool] = useState<PaintTool>('brush')
  const [edge, setEdge] = useState<Edge>('hard')
  const [strength, setStrength] = useState(100)
  const [size, setSize] = useState(pixel ? 1 : Math.round(tipSize / 8))
  // The brush as it starts. One that comes with Lydia is never changed, so it starts as a copy of it
  const [start] = useState(() => {
    const preset = brush?.preset
    if (!preset) return { name: t(DEFAULT_NAME), shape: pixel ? PIXEL_SHAPE : DEFAULT_SHAPE, grain: null }
    const name = brush.isBuiltIn ? t('{name} copy', { name: t(preset.name, {}, 'brush') }) : preset.name
    const grain: GrainChoice | null = preset.grain ? { id: 'custom', png: preset.grain } : null
    return { name, shape: shapeOf(preset), grain }
  })
  const [name, setName] = useState(start.name)
  const [shape, setShape] = useState<BrushShape>(start.shape)
  const [startTip, setStartTip] = useState<Uint8Array | null>(null) // the tip made from the paper as it started
  const [tipPng, setTipPng] = useState<Uint8Array | null>(null) // the tip as it goes in the file
  const [tip, setTip] = useState<BrushTip | null>(null) // the same tip, ready to paint with
  // The picture of the paper's grain, if one was chosen
  const [grain, setGrain] = useState<GrainChoice | null>(start.grain)
  // The id of the brush that saving changes: the one it got when it was saved, or the one opened if it is the user's.
  // And the file saved then
  const [savedId, setSavedId] = useState(brush && !brush.isBuiltIn ? brush.id : undefined)
  const [savedFile, setSavedFile] = useState<string | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    engine?.setBrush({ tool, size, color: grayFor(strength) })
  }, [engine, tool, size, strength])

  useEffect(() => {
    if (!engine) return
    let cancelled = false
    const drawing = builtInBrush(pixel ? PIXEL_DRAWING_BRUSH : ROUND_BRUSHES[edge])
    tipOf(drawing).then(drawingTip => {
      if (!cancelled) engine.setBrushTip(drawingTip, drawing.preset)
    })
    return () => {
      cancelled = true
    }
  }, [engine, edge, pixel])

  // The paper starts with the tip of the brush opened
  useEffect(() => {
    if (!engine || !brush) return
    let cancelled = false
    tipOf(brush).then(openedTip => {
      if (!cancelled) engine.setPaper(paperOfTip(openedTip, tipSize), false)
    })
    return () => {
      cancelled = true
    }
  }, [engine, brush, tipSize])

  const [isGridOn, toggleGrid] = usePixelGrid(engine)
  const [isOutlineOn, toggleOutline] = useBrushOutline(engine)
  const [isSharpOn, toggleSharp] = useSharpPixels(engine)
  const [stabilizer, changeStabilizer] = useStabilizer(engine)
  const [taper, changeTaper] = useTaper(engine)
  const [isStrokeOpen, toggleStroke] = useStrokeOpen()
  useDrawingShortcuts(engine, DESIGNER_TOOLS, setTool, setSize, toggleGrid)
  useEffect(() => engine?.onGraphicsLost(() => alert(new LydiaError('LYD-404').message)), [engine])
  useBackdrop(engine)

  // After every change to the paper (a stroke, undo, redo, clearing), the tip is made again from it, and when another
  // grain is chosen
  useEffect(() => {
    if (!engine) return
    let cancelled = false
    async function makeTip(engine: Engine) {
      const png = await tipFromPicture(await engine.exportImage('png'), pixel)
      const decoded = png ? await decodeTip(png, grain?.png) : null
      if (cancelled) return
      setStartTip(first => first ?? png)
      setTipPng(png)
      setTip(decoded)
    }
    makeTip(engine).catch(error => {
      if (!cancelled) console.warn('Could not make the tip from the paper:', error)
    })
    return () => {
      cancelled = true
    }
  }, [engine, snapshot, pixel, grain])

  // The brush's file as it is now, or null while nothing is painted
  const fileName = name.trim() || t(DEFAULT_NAME)
  const file = useMemo(
    () => (tipPng ? brushFile(fileName, tipPng, shape, grain) : null),
    [fileName, tipPng, shape, grain],
  )
  // The file of the brush opened, as it was, so that a brush nobody changed has nothing to save
  const openedFile = useMemo(
    () => (brush && startTip ? brushFile(start.name, startTip, start.shape, start.grain) : null),
    [brush, startTip, start],
  )
  const [saved, setSaved] = useState<Saved | null>(null) // what was just saved or exported, shown for a moment
  const noteSaved = (text: string) => setSaved({ text, at: Date.now() })
  const doneSaved = useCallback(() => setSaved(null), [])
  const isUnsaved = file !== null && file !== (savedFile ?? openedFile)

  // Ask before closing the tab with a brush that isn't saved
  useEffect(() => {
    if (!isUnsaved) return
    const handleBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isUnsaved])

  // Keep the brush in the brush list. It becomes the chosen brush, so it is ready when a drawing is opened
  async function handleSave() {
    if (!file) return
    try {
      const id = await saveBrush(file, savedId)
      setSavedId(id)
      setSavedFile(file)
      saveBrushId(id)
      noteSaved(t('Saved to your brushes. Open a drawing to paint with it.'))
    } catch (error) {
      alert(errorMessage(error, 'LYD-212'))
    }
  }

  // Keep the brush as a new one, leaving the one it came from as it was. From then on, saving changes the new one
  async function handleSaveCopy() {
    if (!tipPng) return
    try {
      const copyName = t('{name} copy', { name: fileName })
      const copy = brushFile(copyName, tipPng, shape, grain)
      const id = await saveBrush(copy)
      setName(copyName)
      setSavedId(id)
      setSavedFile(copy)
      saveBrushId(id)
      noteSaved(t('Saved to your brushes. Open a drawing to paint with it.'))
    } catch (error) {
      alert(errorMessage(error, 'LYD-212'))
    }
  }

  // Put an image on the paper, as a step of undo
  async function handleImageChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const image = e.target.files?.[0]
    e.target.value = '' // so the same file can be chosen again
    if (!image || !engine) return
    try {
      engine.setPaper(await paperOfImage(image, tipSize, pixel), true)
    } catch (error) {
      alert(errorMessage(error, 'LYD-301'))
    }
  }

  async function handleInvert() {
    if (!engine) return
    try {
      engine.setPaper(await invertedPaper(await engine.exportImage('png'), tipSize), true)
    } catch (error) {
      alert(errorMessage(error, 'LYD-305'))
    }
  }

  function handleExport() {
    if (!file) return
    const exportName = brushFileName(name)
    downloadBlob(new Blob([file], { type: 'application/octet-stream' }), exportName)
    noteSaved(t('Exported: {name}', { name: exportName }))
  }

  function handleBack() {
    if (isUnsaved && !window.confirm(t('Leave the Brush Designer? This brush has changes that are not saved.'))) return
    onBack()
  }

  const saveLabel = brush && !brush.isBuiltIn ? t('Save changes') : t('Save to my brushes')
  const canCopy = savedId !== undefined && brush !== undefined
  const menus: Menu[] = [
    {
      title: t('File'),
      items: [
        { label: saveLabel, onClick: () => void handleSave(), disabled: !isUnsaved },
        ...(canCopy
          ? [{ label: t('Save copy'), hint: t('Keep it as a new brush'), onClick: () => void handleSaveCopy() }]
          : []),
        { label: t('Export file'), onClick: handleExport, disabled: !file },
        null,
        { label: t('Back'), onClick: handleBack },
      ],
    },
    {
      title: t('Edit'),
      items: [
        { label: t('Undo'), keys: 'Ctrl+Z', onClick: () => engine?.undo(), disabled: !snapshot.canUndo },
        { label: t('Redo'), keys: 'Ctrl+Shift+Z', onClick: () => engine?.redo(), disabled: !snapshot.canRedo },
        null,
        { label: t('Clear paper'), onClick: () => engine?.clearLayer(), disabled: !engine },
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
  ]

  return (
    <div className="editor">
      <SavedNotice saved={saved} onDone={doneSaved} />
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
          <div className="designer-save">
            <button onClick={() => void handleSave()} disabled={!isUnsaved}>
              {saveLabel}
            </button>
            {canCopy && (
              <button onClick={() => void handleSaveCopy()} disabled={!file} title={t('Keep it as a new brush')}>
                {t('Save copy')}
              </button>
            )}
            <button onClick={handleExport} disabled={!file}>
              {t('Export file')}
            </button>
          </div>
        </div>
      </header>
      <div className="editor-main">
        <div className="editor-work">
          <div className="editor-row">
            <div className="left-panels">
              <ToolColumn tool={tool} onToolChange={each => setTool(each as PaintTool)} only={DESIGNER_TOOLS} />
              <div className="options-side">
                <div className="toolbar">
                  {!pixel && (
                    <>
                      <span className="button-group">
                        {t('Edge')}
                        <button aria-pressed={edge === 'soft'} onClick={() => setEdge('soft')}>
                          {t('Soft', {}, 'brushEdge')}
                        </button>
                        <button aria-pressed={edge === 'hard'} onClick={() => setEdge('hard')}>
                          {t('Hard', {}, 'brushEdge')}
                        </button>
                      </span>
                      <label title={t('How much the brush paints: black paints fully, gray paints lightly')}>
                        {t('Strength')}
                        <input
                          type="range"
                          min={1}
                          max={100}
                          value={strength}
                          disabled={tool === 'eraser'}
                          onChange={e => setStrength(Number(e.target.value))}
                        />
                        <SliderValue
                          value={strength}
                          min={1}
                          max={100}
                          unit="%"
                          disabled={tool === 'eraser'}
                          onChange={setStrength}
                        />
                      </label>
                    </>
                  )}
                  <label title={t('Brush size ([ and ])')}>
                    {t('Size')}
                    <input
                      type="range"
                      min={MIN_BRUSH_SIZE}
                      max={MAX_BRUSH_SIZE}
                      value={size}
                      onChange={e => setSize(Number(e.target.value))}
                    />
                    <SliderValue value={size} min={MIN_BRUSH_SIZE} max={MAX_BRUSH_SIZE} onChange={setSize} />
                  </label>
                  <StrokeButton isOpen={isStrokeOpen} onToggle={toggleStroke} />
                  {isStrokeOpen && (
                    <div className="stroke-settings">
                      <StabilizerControls stabilizer={stabilizer} onChange={changeStabilizer} />
                      <TaperControls taper={taper} onChange={changeTaper} />
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="draw-area">
              <DrawSpace project={paper} gpuMemory={gpuMemory} onEngineChange={setEngine} />
            </div>
          </div>
          <footer className="draw-footer">
            <span className="paper-size">
              {tipSize} × {tipSize} px
            </span>
            <ViewControls engine={engine} />
          </footer>
        </div>
        <aside className="designer-panel">
          <div className="designer-brush">
            <h2>{t('Brush Designer')}</h2>
            <label className="name-row">
              {t('Name')}
              <input type="text" value={name} maxLength={MAX_NAME_LENGTH} onChange={e => setName(e.target.value)} />
            </label>
            <p className="hint">
              {tip
                ? t('Tip: {width}×{height} pixels, the painted part of the paper.', {
                    width: tip.image.width,
                    height: tip.image.height,
                  }) + (pixel ? t(' It paints at 1×, 2×, 3×… this size, as the brush size comes nearest.') : '')
                : pixel
                  ? t('Paint the tip on the paper, pixel by pixel: black paints, white doesn’t paint.')
                  : t('Paint the tip on the paper: black paints, gray paints lightly, white doesn’t paint.')}
            </p>
            <div className="designer-actions">
              <button
                onClick={() => imageInput.current?.click()}
                disabled={!engine}
                title={t('Put an image on the paper: dark places paint, light ones don’t')}
              >
                {t('Use image…')}
              </button>
              <button
                onClick={() => void handleInvert()}
                disabled={!tip}
                title={t('What paints stops painting, and the other way round')}
              >
                {t('Invert')}
              </button>
              <input ref={imageInput} type="file" accept="image/*" hidden onChange={handleImageChosen} />
            </div>
            <BrushShapeControls shape={shape} onChange={setShape} grain={grain} onGrainChange={setGrain} />
          </div>
          <div className="designer-try">
            <h2>{t('Try it')}</h2>
            <BrushTestArea tip={tip} shape={shape} />
          </div>
        </aside>
      </div>
    </div>
  )
}
