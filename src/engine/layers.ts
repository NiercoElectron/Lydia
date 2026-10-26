import type { StoredTile } from './memory'
import type { SmartObject } from './smartObject'

// The ways a layer's paint can go onto what is under it (see blendModes.ts)
export const LAYER_BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'add',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'soft-light',
  'hard-light',
  'difference',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const
export type BlendMode = (typeof LAYER_BLEND_MODES)[number]

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
  clipped: boolean // it is clipped to the layers under it (see isClipped)
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
    clipped: false,
  }
}

// The blend mode that paints a layer whose transparency is locked ("source-atop"): the new paint shows only as much
// as the paint already there covers, and the transparency stays as it was. PixiJS has no such mode, so the engine
// adds it (see engine.ts)
export const LOCKED_ALPHA = 'locked-alpha'

// Whether the layer at this position is clipped, like Photoshop's clipping masks: it shows only where its "base" has
// paint, the nearest layer under it that isn't clipped itself, and its paint elsewhere stays hidden. Painting inside
// the lines of the base is then easy. The bottom layer has nothing to be clipped to, so it never is
export const isClipped = (stack: LayerStack, index: number) => index > 0 && stack.layers[index]?.clipped === true

// The position of the base of the clipped layer at this position (see isClipped)
export function clipBaseIndex(stack: LayerStack, index: number) {
  let base = index - 1
  while (isClipped(stack, base)) base--
  return base
}

// The position of the active layer in the stack (0 = the bottom one)
export function activeIndex(stack: LayerStack) {
  return stack.layers.indexOf(stack.active)
}
