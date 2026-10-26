import type { StoredTile } from './memory'
import type { SmartObject } from './smartObject'

export type BlendMode = 'normal' | 'multiply'

export type Layer = {
  id: number // never reused, so caches can tell layers apart
  name: string
  tiles: Map<string, StoredTile> // "column,row" -> the tile in RAM. Tiles without paint are not stored at all
  visible: boolean
  opacity: number // from 0 (invisible) to 1
  blendMode: BlendMode
  showOffPaper: boolean // its paint off the paper shows faded around the paper (see outsideView.ts)
  // Its transparency is locked: painting only changes the colors of the paint already there, and the eraser can't
  // take any away (see LOCKED_ALPHA)
  alphaLocked: boolean
  smart?: SmartObject // set when the layer is a smart object (see smartObject.ts): its tiles are then its source drawn
}

// The layers of the open drawing, from the bottom to the top, and the one the brush paints on
export type LayerStack = {
  layers: Layer[]
  active: Layer
}

let nextLayerId = 1

export function createLayer(name: string, tiles = new Map<string, StoredTile>()): Layer {
  return {
    id: nextLayerId++,
    name,
    tiles,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    showOffPaper: false,
    alphaLocked: false,
  }
}

// The blend mode that paints a layer whose transparency is locked ("source-atop"): the new paint shows only as much
// as the paint already there covers, and the transparency stays as it was. PixiJS has no such mode, so the engine
// adds it (see engine.ts)
export const LOCKED_ALPHA = 'locked-alpha'

// The position of the active layer in the stack (0 = the bottom one)
export function activeIndex(stack: LayerStack) {
  return stack.layers.indexOf(stack.active)
}
