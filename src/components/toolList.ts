import {
  Brush,
  Droplets,
  Eraser,
  FingerprintPattern,
  Hand,
  Lasso,
  Move,
  PaintBucket,
  Pipette,
  RotateCw,
  SquareDashed,
  WandSparkles,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react'
import type { Tool } from '../engine/tools'

// Each tool's button, in the order of the tool column: its icon (from Lucide), its name, its shortcut key and, for
// some, other ways to use it
export const TOOLS: Record<Tool, { Icon: LucideIcon; name: string; key: string; also?: string }> = {
  brush: { Icon: Brush, name: 'Brush', key: 'b' },
  eraser: { Icon: Eraser, name: 'Eraser', key: 'e' },
  smudge: { Icon: FingerprintPattern, name: 'Smudge', key: 'u', also: 'drags the paint on the layer' },
  blur: { Icon: Droplets, name: 'Blur', key: 'j', also: 'softens the paint on the layer' },
  fill: { Icon: PaintBucket, name: 'Fill', key: 'f', also: 'Alt picks a color' },
  eyedropper: { Icon: Pipette, name: 'Eyedropper', key: 'i', also: 'or hold Alt while painting' },
  select: { Icon: SquareDashed, name: 'Rectangle select', key: 's', also: 'Shift adds, Alt takes away' },
  lasso: { Icon: Lasso, name: 'Lasso', key: 'l', also: 'Shift adds, Alt takes away' },
  wand: { Icon: WandSparkles, name: 'Magic wand', key: 'w', also: 'Shift adds, Alt takes away' },
  move: {
    Icon: Move,
    name: 'Move',
    key: 'v',
    also: 'the whole layer when nothing is selected; Shift keeps it straight',
  },
  hand: { Icon: Hand, name: 'Hand', key: 'h', also: 'or hold Space' },
  zoom: { Icon: ZoomIn, name: 'Zoom', key: 'z', also: 'Alt + click zooms out, dragging zooms smoothly' },
  rotate: {
    Icon: RotateCw,
    name: 'Rotate view',
    key: 'r',
    also: 'or hold Shift + Space; Shift turns in steps of 15°',
  },
}

export const ALL_TOOLS = Object.keys(TOOLS) as Tool[]
