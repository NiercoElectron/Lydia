// The tools of the drawing: what the left mouse button (or the pen's tip) does on the paper
export type Tool =
  | 'brush'
  | 'eraser'
  | 'smudge'
  | 'blur'
  | 'liquify'
  | 'fill'
  | 'eyedropper'
  | 'select'
  | 'lasso'
  | 'wand'
  | 'move'
  | 'hand'
  | 'zoom'
  | 'rotate'

// How a transform is made: with the corners and the sides, or with the points of a mesh (see warp.ts)
export type TransformMode = 'free' | 'mesh'

// The tools that paint with the brush's tip: the brush puts paint down, the eraser takes it away
export type PaintTool = 'brush' | 'eraser'

export const isPaintTool = (tool: Tool): tool is PaintTool => tool === 'brush' || tool === 'eraser'

// The tools that work with the paint on the layer, through the brush's tip (see mixTools.ts)
export type MixTool = 'smudge' | 'blur'

export const isMixTool = (tool: Tool): tool is MixTool => tool === 'smudge' || tool === 'blur'

// How liquify moves the picture (see liquify.ts): along the stroke, out from the middle of the dab or in toward it,
// round it, or back to how it was
export type LiquifyMode = 'push' | 'bloat' | 'pucker' | 'twirl' | 'reconstruct'

export const LIQUIFY_MODES: LiquifyMode[] = ['push', 'bloat', 'pucker', 'twirl', 'reconstruct']

// The tools with a strength in place of an opacity, and a size of their own
export type StrengthTool = MixTool | 'liquify'

export const hasStrength = (tool: Tool): tool is StrengthTool => isMixTool(tool) || tool === 'liquify'

// The tools that work where the brush's outline is, under the pointer
export const usesTip = (tool: Tool) => isPaintTool(tool) || hasStrength(tool)
