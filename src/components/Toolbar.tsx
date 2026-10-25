import { MAX_FILL_EXPAND, type FillSettings } from '../engine/fill'
import { PIXEL_GRID_ZOOM } from '../engine/pixelGrid'
import type { Tool } from '../engine/tools'
import { SliderValue } from './SliderValue'

export const MIN_BRUSH_SIZE = 1
export const MAX_BRUSH_SIZE = 500

// The selection's settings and commands, shown with the selection tools
export type SelectionControls = {
  hasSelection: boolean
  hardEdges: boolean // whether new selections get hard edges (whole pixels) instead of soft ones
  onHardEdgesChange: (hard: boolean) => void
  onSelectAll: () => void
  onDeselect: () => void
  onInvert: () => void
}

// Transforms and smart objects (see smartObject.ts): the transform being made, if any, and whether the active layer is
// a smart object
export type TransformControls = {
  transform: { smooth: boolean } | null
  isSmartLayer: boolean
  onStart: () => void
  onSmoothChange: (smooth: boolean) => void
  onApply: () => void
  onCancel: () => void
  onConvertToPixels: () => void
}

type Props = {
  tool: Tool
  color: string
  size: number
  opacity: number // in percent
  fill: FillSettings
  selection: SelectionControls
  transform: TransformControls
  isGridOn: boolean
  onColorChange: (color: string) => void
  onSizeChange: (size: number) => void
  onOpacityChange: (opacity: number) => void
  onFillChange: (change: Partial<FillSettings>) => void
  onGridToggle: () => void
}

// The settings of the chosen tool: the color, then the brush's size and opacity, the fill bucket's settings, or the
// selection's. The move tool has none. While a transform is made, its own settings instead
export function Toolbar({
  tool,
  color,
  size,
  opacity,
  fill,
  selection,
  transform,
  isGridOn,
  onColorChange,
  onSizeChange,
  onOpacityChange,
  onFillChange,
  onGridToggle,
}: Props) {
  const isSelecting = tool === 'select' || tool === 'lasso'
  const isMoving = tool === 'move'
  if (transform.transform) {
    return (
      <div className="toolbar">
        <TransformButtons controls={transform} smooth={transform.transform.smooth} />
        <GridButton isOn={isGridOn} onToggle={onGridToggle} />
      </div>
    )
  }
  const isBlocked = transform.isSmartLayer && (tool === 'brush' || tool === 'eraser' || tool === 'fill')
  return (
    <div className="toolbar">
      <label>
        Color
        <input type="color" value={color} disabled={tool === 'eraser'} onChange={e => onColorChange(e.target.value)} />
      </label>
      {tool === 'fill' && <FillControls fill={fill} onFillChange={onFillChange} />}
      {isSelecting && <SelectionButtons selection={selection} />}
      {(isSelecting || isMoving) && (
        <button
          onClick={transform.onStart}
          title="Scale, turn, skew or distort what is selected, or the layer (Ctrl+T)"
        >
          Transform
        </button>
      )}
      {isBlocked && (
        <>
          <span className="notice">This layer is a smart object: it can't be painted on.</span>
          <button onClick={transform.onConvertToPixels} title="It keeps its pixels, but no longer its original">
            Convert to pixels
          </button>
        </>
      )}
      {tool !== 'fill' && !isSelecting && !isMoving && (
        <label title="Brush size ([ and ])">
          Size
          <input
            type="range"
            min={MIN_BRUSH_SIZE}
            max={MAX_BRUSH_SIZE}
            value={size}
            onChange={e => onSizeChange(Number(e.target.value))}
          />
          <SliderValue value={size} min={MIN_BRUSH_SIZE} max={MAX_BRUSH_SIZE} onChange={onSizeChange} />
        </label>
      )}
      {!isSelecting && !isMoving && (
        <label title="How much a stroke or a fill covers, however many times a stroke passes over a place">
          Opacity
          <input
            type="range"
            min={1}
            max={100}
            value={opacity}
            onChange={e => onOpacityChange(Number(e.target.value))}
          />
          <SliderValue value={opacity} min={1} max={100} unit="%" onChange={onOpacityChange} />
        </label>
      )}
      <GridButton isOn={isGridOn} onToggle={onGridToggle} />
    </div>
  )
}

function FillControls({
  fill,
  onFillChange,
}: {
  fill: FillSettings
  onFillChange: (change: Partial<FillSettings>) => void
}) {
  return (
    <>
      <label title="How far a color can be from the one clicked and still be filled, from 0 to 255">
        Tolerance
        <input
          type="range"
          min={0}
          max={255}
          value={fill.tolerance}
          onChange={e => onFillChange({ tolerance: Number(e.target.value) })}
        />
        <SliderValue value={fill.tolerance} min={0} max={255} onChange={tolerance => onFillChange({ tolerance })} />
      </label>
      <span className="button-group" title="What the fill looks at to find where to stop">
        Look at
        <button aria-pressed={fill.reference === 'all'} onClick={() => onFillChange({ reference: 'all' })}>
          All layers
        </button>
        <button aria-pressed={fill.reference === 'layer'} onClick={() => onFillChange({ reference: 'layer' })}>
          This layer
        </button>
      </span>
      <label title="At most how many pixels the fill goes past its edge, behind the soft edge of the lines around it, up to where they are darkest">
        Expand
        <input
          type="range"
          min={0}
          max={MAX_FILL_EXPAND}
          value={fill.expand}
          onChange={e => onFillChange({ expand: Number(e.target.value) })}
        />
        <SliderValue
          value={fill.expand}
          min={0}
          max={MAX_FILL_EXPAND}
          unit=" px"
          onChange={expand => onFillChange({ expand })}
        />
      </label>
    </>
  )
}

function SelectionButtons({ selection }: { selection: SelectionControls }) {
  return (
    <>
      <span className="button-group" title="Edges of new selections: soft, or whole pixels for pixel art">
        Edges
        <button aria-pressed={!selection.hardEdges} onClick={() => selection.onHardEdgesChange(false)}>
          Soft
        </button>
        <button aria-pressed={selection.hardEdges} onClick={() => selection.onHardEdgesChange(true)}>
          Hard
        </button>
      </span>
      <button onClick={selection.onSelectAll} title="Select everything (Ctrl+A)">
        Select all
      </button>
      <button onClick={selection.onDeselect} disabled={!selection.hasSelection} title="Select nothing (Ctrl+D)">
        Deselect
      </button>
      <button onClick={selection.onInvert} title="Select what isn't selected, and the other way round (Ctrl+Shift+I)">
        Invert
      </button>
    </>
  )
}

function TransformButtons({ controls, smooth }: { controls: TransformControls; smooth: boolean }) {
  return (
    <>
      <span className="notice">
        Drag the corners or the sides to scale (Shift changes the proportions, Alt from the middle), outside to turn,
        with Ctrl to distort or skew
      </span>
      <span className="button-group" title="How the pixels are worked out: smoothly, or as whole pixels for pixel art">
        Pixels
        <button aria-pressed={smooth} onClick={() => controls.onSmoothChange(true)}>
          Smooth
        </button>
        <button aria-pressed={!smooth} onClick={() => controls.onSmoothChange(false)}>
          Whole
        </button>
      </span>
      <button onClick={controls.onApply} title="Apply (Enter)">
        Apply
      </button>
      <button onClick={controls.onCancel} title="Cancel (Esc)">
        Cancel
      </button>
    </>
  )
}

// Turns the pixel grid on and off. Also used by the Brush Designer
export function GridButton({ isOn, onToggle }: { isOn: boolean; onToggle: () => void }) {
  return (
    <button aria-pressed={isOn} onClick={onToggle} title={`Pixel grid, shown from ${PIXEL_GRID_ZOOM * 100}% zoom (G)`}>
      Grid
    </button>
  )
}
