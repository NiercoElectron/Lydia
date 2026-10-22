import type { Tool } from '../engine/brush'

export const MIN_BRUSH_SIZE = 1
export const MAX_BRUSH_SIZE = 500

type Props = {
  tool: Tool
  color: string
  size: number
  onToolChange: (tool: Tool) => void
  onColorChange: (color: string) => void
  onSizeChange: (size: number) => void
}

export function Toolbar({ tool, color, size, onToolChange, onColorChange, onSizeChange }: Props) {
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
    </div>
  )
}
