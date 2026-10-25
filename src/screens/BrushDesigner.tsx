import { useEffect, useMemo, useState } from 'react'
import { builtInBrush, saveBrush, tipOf } from '../brushLibrary'
import { BrushShapeControls } from '../components/BrushShapeControls'
import { BrushTestArea } from '../components/BrushTestArea'
import { DrawSpace } from '../components/DrawSpace'
import { SliderValue } from '../components/SliderValue'
import {
  useBackdrop,
  useBrushOutline,
  useDrawingShortcuts,
  useEngineSnapshot,
  usePixelGrid,
  useStabilizer,
  useTaper,
} from '../components/engineHooks'
import { AdvancedMenu } from '../components/AdvancedMenu'
import {
  GridButton,
  MAX_BRUSH_SIZE,
  MIN_BRUSH_SIZE,
  OutlineButton,
  StabilizerControls,
  TaperControls,
} from '../components/Toolbar'
import { brushFileName, DEFAULT_SHAPE, serializeBrushFile, type BrushShape } from '../engine/brushFile'
import { decodeTip, tipFromPicture, type BrushTip } from '../engine/brushTip'
import type { Engine } from '../engine/engine'
import { newProject } from '../engine/projectFile'
import type { PaintTool } from '../engine/tools'
import { downloadBlob } from '../files'
import { saveBrushId } from '../settings'

const DEFAULT_NAME = 'My brush'
const MAX_NAME_LENGTH = 100

// The paper is painted with one of Lydia's own round brushes: soft or hard edge
type Edge = 'soft' | 'hard'
const ROUND_BRUSHES: Record<Edge, string> = { soft: 'soft-round', hard: 'hard-round' }

// The tip is drawn with the brush and the eraser only
const DESIGNER_TOOLS: readonly PaintTool[] = ['brush', 'eraser']

// The color that paints this much (in percent): black paints fully, white not at all
function grayFor(strength: number) {
  const level = Math.round(255 * (1 - strength / 100))
    .toString(16)
    .padStart(2, '0')
  return `#${level}${level}${level}`
}

type Props = {
  tipSize: number // the paper's width and height, in pixels
  gpuMemory: number // GB of the graphics card's memory to use (see settings.ts)
  onBack: () => void
}

// The Brush Designer: draw the tip of a new brush on a small paper, choose how the tip is placed along a stroke, try
// it, and keep it in the brushes or as a file (decision 30)
export function BrushDesigner({ tipSize, gpuMemory, onBack }: Props) {
  const [paper] = useState(() => newProject(tipSize, tipSize))
  const [engine, setEngine] = useState<Engine | null>(null)
  const snapshot = useEngineSnapshot(engine)
  const [tool, setTool] = useState<PaintTool>('brush')
  const [edge, setEdge] = useState<Edge>('hard')
  const [strength, setStrength] = useState(100)
  const [size, setSize] = useState(Math.round(tipSize / 8))
  const [name, setName] = useState(DEFAULT_NAME)
  const [shape, setShape] = useState<BrushShape>(DEFAULT_SHAPE)
  const [tipPng, setTipPng] = useState<Uint8Array | null>(null) // the tip as it goes in the file
  const [tip, setTip] = useState<BrushTip | null>(null) // the same tip, ready to paint with
  // The id the brush got when it was saved, so saving again changes it, and the file saved then
  const [savedId, setSavedId] = useState<string>()
  const [savedFile, setSavedFile] = useState<string | null>(null)

  useEffect(() => {
    engine?.setBrush({ tool, size, color: grayFor(strength) })
  }, [engine, tool, size, strength])

  useEffect(() => {
    if (!engine) return
    let cancelled = false
    const round = builtInBrush(ROUND_BRUSHES[edge])
    tipOf(round).then(roundTip => {
      if (!cancelled) engine.setBrushTip(roundTip, round.preset)
    })
    return () => {
      cancelled = true
    }
  }, [engine, edge])

  const [isGridOn, toggleGrid] = usePixelGrid(engine)
  const [isOutlineOn, toggleOutline] = useBrushOutline(engine)
  const [stabilizer, changeStabilizer] = useStabilizer(engine)
  const [taper, changeTaper] = useTaper(engine)
  useDrawingShortcuts(engine, DESIGNER_TOOLS, setTool, setSize, toggleGrid)
  useBackdrop(engine)

  // After every change to the paper (a stroke, undo, redo, clearing), the tip is made again from it
  useEffect(() => {
    if (!engine) return
    let cancelled = false
    async function makeTip(engine: Engine) {
      const png = await tipFromPicture(await engine.exportImage('png'))
      const decoded = png ? await decodeTip(png) : null
      if (cancelled) return
      setTipPng(png)
      setTip(decoded)
    }
    makeTip(engine).catch(error => {
      if (!cancelled) console.warn('Could not make the tip from the paper:', error)
    })
    return () => {
      cancelled = true
    }
  }, [engine, snapshot])

  // The brush's file as it is now, or null while nothing is painted
  const file = useMemo(
    () => (tipPng ? serializeBrushFile({ name: name.trim() || DEFAULT_NAME, tip: tipPng, ...shape }) : null),
    [name, tipPng, shape],
  )
  const isSaved = file !== null && file === savedFile
  const isUnsaved = file !== null && file !== savedFile

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
    } catch {
      alert('Could not save the brush in this browser.')
    }
  }

  function handleExport() {
    if (file) downloadBlob(new Blob([file], { type: 'application/octet-stream' }), brushFileName(name))
  }

  function handleBack() {
    if (isUnsaved && !window.confirm('Leave the Brush Designer? This brush has changes that are not saved.')) return
    onBack()
  }

  return (
    <div className="editor">
      <header className="editor-bar">
        <div className="toolbar">
          <button aria-pressed={tool === 'brush'} onClick={() => setTool('brush')} title="Brush (B)">
            Brush
          </button>
          <button aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')} title="Eraser (E)">
            Eraser
          </button>
          <span className="button-group">
            Edge
            <button aria-pressed={edge === 'soft'} onClick={() => setEdge('soft')}>
              Soft
            </button>
            <button aria-pressed={edge === 'hard'} onClick={() => setEdge('hard')}>
              Hard
            </button>
          </span>
          <label title="How much the brush paints: black paints fully, gray paints lightly">
            Strength
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
          <label title="Brush size ([ and ])">
            Size
            <input
              type="range"
              min={MIN_BRUSH_SIZE}
              max={MAX_BRUSH_SIZE}
              value={size}
              onChange={e => setSize(Number(e.target.value))}
            />
            <SliderValue value={size} min={MIN_BRUSH_SIZE} max={MAX_BRUSH_SIZE} onChange={setSize} />
          </label>
          <AdvancedMenu>
            <StabilizerControls stabilizer={stabilizer} onChange={changeStabilizer} />
            <TaperControls taper={taper} onChange={changeTaper} />
          </AdvancedMenu>
          <GridButton isOn={isGridOn} onToggle={toggleGrid} />
          <OutlineButton isOn={isOutlineOn} onToggle={toggleOutline} />
        </div>
        <div className="actions">
          <button onClick={() => engine?.undo()} disabled={!snapshot.canUndo} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button onClick={() => engine?.redo()} disabled={!snapshot.canRedo} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
          <button onClick={() => engine?.clearLayer()} disabled={!engine}>
            Clear paper
          </button>
          <button onClick={() => engine?.fitToScreen()} disabled={!engine} title="Show the whole paper (Ctrl+0)">
            Fit
          </button>
          <button onClick={handleBack}>Back</button>
        </div>
      </header>
      <div className="editor-main">
        <DrawSpace project={paper} gpuMemory={gpuMemory} onEngineChange={setEngine} />
        <aside className="designer-panel">
          <h2>Brush Designer</h2>
          <label className="name-row">
            Name
            <input type="text" value={name} maxLength={MAX_NAME_LENGTH} onChange={e => setName(e.target.value)} />
          </label>
          <p className="hint">
            {tip
              ? `Tip: ${tip.image.width}×${tip.image.height} pixels, the painted part of the paper.`
              : 'Paint the tip on the paper: black paints, gray paints lightly, white doesn’t paint.'}
          </p>
          <BrushShapeControls shape={shape} onChange={setShape} />
          <h2>Try it</h2>
          <BrushTestArea tip={tip} shape={shape} />
          <div className="designer-actions">
            <button onClick={handleSave} disabled={!file || isSaved}>
              Save to my brushes
            </button>
            <button onClick={handleExport} disabled={!file}>
              Export file
            </button>
          </div>
          {isSaved && <p className="hint">Saved to your brushes. Open a drawing to paint with it.</p>}
        </aside>
      </div>
    </div>
  )
}
