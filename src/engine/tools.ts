// The tools of the drawing: what the left mouse button (or the pen's tip) does on the paper
export type Tool =
  'brush' | 'eraser' | 'fill' | 'eyedropper' | 'select' | 'lasso' | 'wand' | 'move' | 'hand' | 'zoom' | 'rotate'

// The tools that paint with the brush's tip: the brush puts paint down, the eraser takes it away
export type PaintTool = 'brush' | 'eraser'

export const isPaintTool = (tool: Tool): tool is PaintTool => tool === 'brush' || tool === 'eraser'
