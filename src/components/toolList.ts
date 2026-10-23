import { Brush, Eraser, Hand, Pipette, RotateCw, ZoomIn, type LucideIcon } from 'lucide-react'
import type { Tool } from '../engine/tools'

// Each tool's button, in the order of the tool column: its icon (from Lucide), its name, its shortcut key and, for
// some, other ways to use it
export const TOOLS: Record<Tool, { Icon: LucideIcon; name: string; key: string; also?: string }> = {
  brush: { Icon: Brush, name: 'Brush', key: 'b' },
  eraser: { Icon: Eraser, name: 'Eraser', key: 'e' },
  eyedropper: { Icon: Pipette, name: 'Eyedropper', key: 'i', also: 'or hold Alt while painting' },
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
