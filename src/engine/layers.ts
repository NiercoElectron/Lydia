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
// A folder can also let what is in it "pass through" (see isFolder)
export type BlendMode = (typeof LAYER_BLEND_MODES)[number] | 'pass-through'

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
  parent: Layer | null // the folder it is in, if any (see isFolder)
  folder?: { open: boolean } // set when it is a folder: "open" when the layers panel shows what is in it
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
    parent: null,
  }
}

// Folders hold layers, and other folders, to keep a drawing with many layers in order ("Character" holding "Head",
// which holds "Hair"...). A folder is in the list of layers like a layer, with no paint of its own: what is in it comes
// right under it, from the bottom up, so a folder and what is in it (its "block") are always together in the list.
// Hiding a folder hides all that is in it, and its opacity applies to all of it. By default a folder lets what is in it
// "pass through", as in Photoshop: it only keeps the layers in order, and a layer in it with a blend mode mixes with
// all that is under it, in the folder or not. With another blend mode, what is in the folder is put together on its
// own first, like one layer, which then goes onto what is under the folder with that mode
export function createFolder(name: string): Layer {
  return { ...createLayer(name), blendMode: 'pass-through', folder: { open: true } }
}

export const isFolder = (layer: Layer) => layer.folder !== undefined

// Whether a layer is somewhere in this folder, or in a folder in it
export function isInside(layer: Layer, folder: Layer) {
  for (let parent = layer.parent; parent; parent = parent.parent) if (parent === folder) return true
  return false
}

// Whether a layer shows: it and the folders it is in aren't hidden
export function isShown(layer: Layer) {
  for (let item: Layer | null = layer; item; item = item.parent) if (!item.visible) return false
  return true
}

// The position where the block of the layer or folder at this position starts: a folder's block is all that is in it
// and the folder itself, on top; a layer's is the layer
export function blockStart(stack: LayerStack, index: number) {
  const item = stack.layers[index]
  let start = index
  if (isFolder(item)) while (start > 0 && isInside(stack.layers[start - 1], item)) start--
  return start
}

// The position of the layer or folder right under the one at this position in the same folder (or both in none), or
// -1 when it is the bottom one there
export function siblingBelow(stack: LayerStack, index: number) {
  const below = blockStart(stack, index) - 1
  return below >= 0 && stack.layers[below].parent === stack.layers[index].parent ? below : -1
}

// The layers and folders in this folder (or in none, for null), from the bottom up
export const childrenOf = (stack: LayerStack, folder: Layer | null) =>
  stack.layers.filter(layer => layer.parent === folder)

// The blend mode that paints a layer whose transparency is locked ("source-atop"): the new paint shows only as much
// as the paint already there covers, and the transparency stays as it was. PixiJS has no such mode, so the engine
// adds it (see engine.ts)
export const LOCKED_ALPHA = 'locked-alpha'

// Whether the layer or folder at this position is clipped, like Photoshop's clipping masks: it shows only where its
// "base" has paint, the nearest layer or folder under it, in the same folder, that isn't clipped itself, and its paint
// elsewhere stays hidden. Painting inside the lines of the base is then easy. The bottom one in a folder (or in none)
// has nothing to be clipped to, so it never is
export const isClipped = (stack: LayerStack, index: number) =>
  stack.layers[index]?.clipped === true && siblingBelow(stack, index) >= 0

// The position of the base of the clipped layer or folder at this position (see isClipped)
export function clipBaseIndex(stack: LayerStack, index: number) {
  let base = siblingBelow(stack, index)
  while (isClipped(stack, base)) base = siblingBelow(stack, base)
  return base
}

// The position of the active layer in the stack (0 = the bottom one)
export function activeIndex(stack: LayerStack) {
  return stack.layers.indexOf(stack.active)
}

// The position from which the projection puts the layers together over its "below" tiles (see projection.ts): where
// the block of the outermost folder holding the active layer starts, as a folder's layers are put together with it.
// With no folder, the active layer's (or the active folder's block's) own
export function splitIndex(stack: LayerStack) {
  let outermost = stack.active
  while (outermost.parent) outermost = outermost.parent
  return blockStart(stack, stack.layers.indexOf(outermost))
}
