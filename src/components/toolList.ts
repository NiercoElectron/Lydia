import { Brush, Eraser, Pipette, type LucideIcon } from 'lucide-react'
import type { Tool } from '../engine/tools'

// Each tool's button, in the order of the tool column: its icon (from Lucide), its name, its shortcut key and, for
// some, another way to use it
export const TOOLS: Record<Tool, { Icon: LucideIcon; name: string; key: string; also?: string }> = {
  brush: { Icon: Brush, name: 'Brush', key: 'b' },
  eraser: { Icon: Eraser, name: 'Eraser', key: 'e' },
  eyedropper: { Icon: Pipette, name: 'Eyedropper', key: 'i', also: 'or hold Alt while painting' },
}

export const ALL_TOOLS = Object.keys(TOOLS) as Tool[]
