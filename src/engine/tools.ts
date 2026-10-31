// The tools of the drawing: what the left mouse button (or the pen's tip) does on the paper
export type Tool =
  | 'brush'
  | 'eraser'
  | 'smudge'
  | 'blur'
  | 'fill'
  | 'eyedropper'
  | 'select'
  | 'lasso'
  | 'wand'
  | 'move'
  | 'hand'
  | 'zoom'
  | 'rotate'

// The tools that paint with the brush's tip: the brush puts paint down, the eraser takes it away
export type PaintTool = 'brush' | 'eraser'

export const isPaintTool = (tool: Tool): tool is PaintTool => tool === 'brush' || tool === 'eraser'

// The tools that work with the paint on the layer, through the brush's tip (see mixTools.ts)
export type MixTool = 'smudge' | 'blur'

export const isMixTool = (tool: Tool): tool is MixTool => tool === 'smudge' || tool === 'blur'

// The tools with the brush's tip under the pointer
export const usesTip = (tool: Tool) => isPaintTool(tool) || isMixTool(tool)
