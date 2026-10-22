import type { StoredTile } from './memory'

export type BlendMode = 'normal' | 'multiply'

export type Layer = {
  id: number // never reused, so caches can tell layers apart
  name: string
  tiles: Map<string, StoredTile> // "column,row" -> the tile in RAM. Tiles without paint are not stored at all
  visible: boolean
  opacity: number // from 0 (invisible) to 1
  blendMode: BlendMode
}

// The layers of the open drawing, from the bottom to the top, and the one the brush paints on
export type LayerStack = {
  layers: Layer[]
  active: Layer
}

let nextLayerId = 1

export function createLayer(name: string, tiles = new Map<string, StoredTile>()): Layer {
  return { id: nextLayerId++, name, tiles, visible: true, opacity: 1, blendMode: 'normal' }
}

// The position of the active layer in the stack (0 = the bottom one)
export function activeIndex(stack: LayerStack) {
  return stack.layers.indexOf(stack.active)
}
