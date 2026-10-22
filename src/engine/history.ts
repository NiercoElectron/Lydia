import type { GpuTiles, PendingPixels } from './gpuTiles'
import { activeIndex, type Layer, type LayerStack } from './layers'
import { bytesOf, type StoredTile } from './memory'
import type { Projection } from './projection'
import { parseTileKey, TILE_SIZE } from './tiles'

// Each undo step keeps what the drawing had before a change, and swapping it in takes the drawing back. The swap keeps
// in the step what the drawing had instead, so the same step works in both directions: undo swaps it once, redo swaps
// it back. There are three kinds of steps:
// - "tiles": a change to a layer's pixels (a stroke, clearing the layer). For every tile the change touched, the step
//   keeps the tile from before it (null = the tile had no paint). Pixels are never changed, so no copy is needed. If
//   the tile's latest pixels were still only on the graphics card, the step keeps an IOU instead, filled in a frame or
//   two later
// - "order": a layer was added, deleted or moved. The step keeps the list of layers and the active layer from before
//   (the same layers, not copies), and which layer it was about. A deleted layer stays in the step, with its tiles,
//   so it can come back
// - "layer": a layer was hidden or shown, or got another opacity or name. The step keeps the values from before
type TileBackup = StoredTile | null | PendingPixels
export type LayerProps = Pick<Layer, 'visible' | 'opacity' | 'name'>
type TilesStep = { kind: 'tiles'; layer: Layer; tiles: Map<string, TileBackup> }
type OrderStep = { kind: 'order'; layers: Layer[]; active: Layer; layer: Layer }
type LayerStep = { kind: 'layer'; layer: Layer; props: LayerProps }
type UndoStep = TilesStep | OrderStep | LayerStep

const MAX_UNDO_BYTES = 500 * 1024 * 1024 // RAM kept for undo and redo

export function propsOf({ visible, opacity, name }: Layer): LayerProps {
  return { visible, opacity, name }
}

export function createHistory(stack: LayerStack, gpu: GpuTiles, projection: Projection) {
  const undoStack: UndoStep[] = []
  const redoStack: UndoStep[] = []
  let current: TilesStep | null = null // the step being recorded (while the user paints)

  // ----- Recording -----

  // What a layer's tile has right now, to keep for undo or redo: the tile in RAM or, if its latest pixels are still
  // only on the graphics card, an IOU, read without waiting. The read gets the tile as it is now, even if something
  // changes it right afterwards, because the graphics card works in order
  function currentTile(layer: Layer, key: string): TileBackup {
    const cached = gpu.getCached(layer, key)
    if (!cached?.dirty) return layer.tiles.get(key) ?? null
    return gpu.readLater(cached)
  }

  // Start recording a change to a layer's pixels (a stroke, clearing the layer...)
  function begin(layer: Layer) {
    current = { kind: 'tiles', layer, tiles: new Map() }
  }

  // Before a change touches a tile for the first time, keep what the tile had before it
  function backUpTile(key: string) {
    if (!current || current.tiles.has(key)) return // not recording, or already kept during this change
    current.tiles.set(key, currentTile(current.layer, key))
  }

  // Is this tile part of the change being recorded? (Its pixels will change again in a moment)
  function isRecording(layer: Layer, key: string) {
    return current?.layer === layer && current.tiles.has(key)
  }

  // Finish recording. A change that touched no tiles (a click outside the paper) is not kept: an empty step would make
  // undo seem to do nothing. Returns whether a step was added
  function end() {
    const step = current
    current = null
    if (!step || step.tiles.size === 0) return false
    add(step)
    return true
  }

  // Call before adding, deleting or moving "layer": keeps the list of layers and the active layer as they are now
  function recordOrder(layer: Layer) {
    add({ kind: 'order', layers: [...stack.layers], active: stack.active, layer })
  }

  // Keep the values a layer had before it was hidden, shown or renamed, or got another opacity
  function recordLayer(layer: Layer, before: LayerProps) {
    add({ kind: 'layer', layer, props: { ...before } })
  }

  function add(step: UndoStep) {
    undoStack.push(step)
    // After a new change, the steps that were undone can't be redone anymore
    const forgotten = redoStack.splice(0)

    // When the history takes too much memory, forget the oldest steps (but always keep the newest one)
    let bytes = 0
    for (const s of undoStack) bytes += stepBytes(s)
    while (bytes > MAX_UNDO_BYTES && undoStack.length > 1) {
      const oldest = undoStack.shift()!
      bytes -= stepBytes(oldest)
      forgotten.push(oldest)
    }
    forget(forgotten)
  }

  // ----- Forgetting -----

  // The layers a step is about
  function layersOf(step: UndoStep) {
    return step.kind === 'order' ? [...step.layers, step.layer] : [step.layer]
  }

  // Layers only a step keeps: ones that were deleted (or added, and that was undone)
  function layersKeptBy(step: UndoStep) {
    return step.kind === 'order' ? step.layers.filter(layer => !stack.layers.includes(layer)) : []
  }

  // Steps that will never be used again. Their IOUs are not needed anymore, so their reads don't have to fetch pixels.
  // A layer that is no longer in the drawing nor in any other step is gone for good: its tiles leave the graphics card
  // (and RAM, once nothing points to them)
  function forget(steps: UndoStep[]) {
    const layers = new Set<Layer>()
    for (const step of steps) {
      if (step.kind === 'tiles') {
        for (const backup of step.tiles.values()) {
          if (backup && 'read' in backup && backup.tile === undefined) gpu.cancel(backup)
        }
      }
      for (const layer of layersOf(step)) layers.add(layer)
    }
    const stillUsed = new Set([...stack.layers, ...[...undoStack, ...redoStack].flatMap(layersOf)])
    for (const layer of layers) if (!stillUsed.has(layer)) gpu.dropLayer(layer)
  }

  // ----- Undo and redo -----

  // The tile a backup stands for (an IOU is redeemed first)
  function tileOf(backup: TileBackup) {
    return backup && 'read' in backup ? gpu.redeem(backup) : backup
  }

  // How much RAM a step keeps (tiles that had no paint cost nothing)
  function stepBytes(step: UndoStep) {
    let bytes = 0
    if (step.kind === 'tiles') {
      for (const backup of step.tiles.values()) {
        const tile = backup && 'read' in backup ? backup.tile : backup
        if (tile) bytes += bytesOf(tile)
        else if (tile === undefined) bytes += TILE_SIZE * TILE_SIZE * 4 // an IOU not filled in yet counts as a whole tile
      }
    }
    for (const layer of layersKeptBy(step)) {
      for (const tile of layer.tiles.values()) bytes += bytesOf(tile)
    }
    return bytes
  }

  // Put the kept pixels back into the layer, and keep in the step what the layer had instead
  function swapTiles(step: TilesStep) {
    const isBelowActive = stack.layers.indexOf(step.layer) < activeIndex(stack)
    for (const [key, backup] of step.tiles) {
      const { column, row } = parseTileKey(key)
      const now = currentTile(step.layer, key) // what the layer has now, to swap back later

      if (backup && 'read' in backup && backup.tile === undefined) {
        // An IOU whose pixels haven't been fetched: they are still on the graphics card, in the read's buffer, so put
        // them back from there instead of bringing them to RAM and back. The tile is now newer than RAM, like a
        // painted tile, and the background saving takes care of it
        gpu.restoreFromRead(backup.read, gpu.getTexture(step.layer, column, row, true)!)
        gpu.markDirty(step.layer, key)
      } else {
        const kept = tileOf(backup) // no waiting: an IOU here already has its pixels
        if (kept) step.layer.tiles.set(key, kept)
        else step.layer.tiles.delete(key)

        // If the graphics card has a copy of this tile, update it too
        const cached = gpu.getCached(step.layer, key)
        if (cached) {
          if (kept) gpu.upload(kept, cached.texture)
          else gpu.clearTexture(cached.texture)
          gpu.markClean(cached)
        }
      }
      step.tiles.set(key, now)

      // A layer under the active one is part of "below", so that tile must be put together again too
      if (isBelowActive) projection.markBelowStale(key)
      projection.composeTile(column, row)
    }
  }

  // Put the kept list of layers and active layer back, and keep the current ones in the step instead
  function swapOrder(step: OrderStep) {
    const layers = [...stack.layers]
    const active = stack.active
    stack.layers.splice(0, stack.layers.length, ...step.layers)
    stack.active = step.active
    step.layers = layers
    step.active = active
    projection.markAllBelowStale() // "below" may have other layers now
    if (step.layer.visible) projection.composeLayerTiles(step.layer)
  }

  // Put the kept values back into the layer, and keep the current ones in the step instead
  function swapLayer(step: LayerStep) {
    const { layer } = step
    const now = propsOf(layer)
    Object.assign(layer, step.props)
    step.props = now
    const looksDifferent = now.visible !== layer.visible || (layer.visible && now.opacity !== layer.opacity)
    if (looksDifferent) projection.composeLayerTiles(layer)
  }

  function swap(step: UndoStep) {
    if (step.kind === 'tiles') swapTiles(step)
    else if (step.kind === 'order') swapOrder(step)
    else swapLayer(step)
  }

  function undo() {
    const step = undoStack.pop()
    if (!step) return
    swap(step)
    redoStack.push(step)
  }

  function redo() {
    const step = redoStack.pop()
    if (!step) return
    swap(step)
    undoStack.push(step)
  }

  // Every tile the history keeps, for the memory budget
  function* storedTiles() {
    for (const step of [...undoStack, ...redoStack]) {
      if (step.kind === 'tiles') {
        for (const backup of step.tiles.values()) {
          const tile = backup && 'read' in backup ? backup.tile : backup
          if (tile) yield tile
        }
      }
      for (const layer of layersKeptBy(step)) yield* layer.tiles.values()
    }
  }

  return {
    begin,
    backUpTile,
    isRecording,
    end,
    recordOrder,
    recordLayer,
    undo,
    redo,
    storedTiles,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
  }
}

export type History = ReturnType<typeof createHistory>
