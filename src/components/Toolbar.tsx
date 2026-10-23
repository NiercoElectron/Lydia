import type { Tool } from '../engine/brush'
import { PIXEL_GRID_ZOOM } from '../engine/pixelGrid'

export const MIN_BRUSH_SIZE = 1
export const MAX_BRUSH_SIZE = 500

type Props = {
  tool: Tool
  color: string
  size: number
  opacity: number // in percent
  isGridOn: boolean
  onToolChange: (tool: Tool) => void
  onColorChange: (color: string) => void
  onSizeChange: (size: number) => void
  onOpacityChange: (opacity: number) => void
  onGridToggle: () => void
}

export function Toolbar({
  tool,
  color,
  size,
  opacity,
  isGridOn,
  onToolChange,
  onColorChange,
  onSizeChange,
  onOpacityChange,
  onGridToggle,
}: Props) {
  return (
    <div className="toolbar">
      <button aria-pressed={tool === 'brush'} onClick={() => onToolChange('brush')} title="Brush (B)">
        Brush
      </button>
      <button aria-pressed={tool === 'eraser'} onClick={() => onToolChange('eraser')} title="Eraser (E)">
        Eraser
      </button>
      <label>
        Color
        <input type="color" value={color} disabled={tool === 'eraser'} onChange={e => onColorChange(e.target.value)} />
      </label>
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
      <label title="How much the whole stroke covers, however many times it passes over a place">
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
