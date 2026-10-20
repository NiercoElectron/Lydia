import type { Tool } from '../drawing/types'

const MIN_BRUSH_SIZE = 1
const MAX_BRUSH_SIZE = 64

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
    <div>
      <button aria-pressed={tool === 'brush'} onClick={() => onToolChange('brush')}>Brush</button>
      <button aria-pressed={tool === 'eraser'} onClick={() => onToolChange('eraser')}>Eraser</button>
      <label>
        Color
        <input type="color" value={color} disabled={tool === 'eraser'} onChange={e => onColorChange(e.target.value)} />
      </label>
      <label>
        Size
        <input type="range" min={MIN_BRUSH_SIZE} max={MAX_BRUSH_SIZE} value={size} onChange={e => onSizeChange(Number(e.target.value))} />
        {size}
      </label>
    </div>
  )
}
