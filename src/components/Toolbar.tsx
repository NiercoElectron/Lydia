import { MAX_FILL_EXPAND, type FillSettings } from '../engine/fill'
import { PIXEL_GRID_ZOOM } from '../engine/pixelGrid'
import type { Tool } from '../engine/tools'

export const MIN_BRUSH_SIZE = 1
export const MAX_BRUSH_SIZE = 500

type Props = {
  tool: Tool
  color: string
  size: number
  opacity: number // in percent
  fill: FillSettings
  isGridOn: boolean
  onColorChange: (color: string) => void
  onSizeChange: (size: number) => void
  onOpacityChange: (opacity: number) => void
  onFillChange: (change: Partial<FillSettings>) => void
  onGridToggle: () => void
}

// The settings of the chosen tool: the color, the opacity, and the brush's size or the fill bucket's own settings
export function Toolbar({
  tool,
  color,
  size,
  opacity,
  fill,
  isGridOn,
  onColorChange,
  onSizeChange,
  onOpacityChange,
  onFillChange,
  onGridToggle,
}: Props) {
  return (
    <div className="toolbar">
      <label>
        Color
        <input type="color" value={color} disabled={tool === 'eraser'} onChange={e => onColorChange(e.target.value)} />
      </label>
      {tool === 'fill' ? (
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
            <span className="slider-value">{fill.tolerance}</span>
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
            <span className="slider-value">{fill.expand} px</span>
          </label>
        </>
      ) : (
        <label title="Brush size ([ and ])">
          Size
          <input
            type="range"
            min={MIN_BRUSH_SIZE}
            max={MAX_BRUSH_SIZE}
            value={size}
            onChange={e => onSizeChange(Number(e.target.value))}
          />
          {size}
        </label>
      )}
      <label title="How much a stroke or a fill covers, however many times a stroke passes over a place">
        Opacity
        <input type="range" min={1} max={100} value={opacity} onChange={e => onOpacityChange(Number(e.target.value))} />
        <span className="slider-value">{opacity}%</span>
      </label>
      <GridButton isOn={isGridOn} onToggle={onGridToggle} />
    </div>
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
