import type { GpuTiles, PendingPixels } from './gpuTiles'
import { activeIndex, type Layer, type LayerStack } from './layers'
import { bytesOf, type StoredTile } from './memory'
import type { Projection } from './projection'
import { parseTileKey, TILE_SIZE } from './tiles'

// Each undo step keeps the layer that was changed and, for every tile the change touched, the tile from before it
// (null = the tile had no paint). Pixels are never changed, so no copy is needed. If the tile's latest pixels were
// still only on the graphics card, the step keeps an IOU instead, filled in a frame or two later
type TileBackup = StoredTile | null | PendingPixels
type UndoStep = { layer: Layer; tiles: Map<string, TileBackup> }

const MAX_UNDO_BYTES = 500 * 1024 * 1024 // RAM kept for undo and redo

export function createHistory(stack: LayerStack, gpu: GpuTiles, projection: Projection) {
  const undoStack: UndoStep[] = []
  const redoStack: UndoStep[] = []
  let current: UndoStep | null = null // the step being recorded (while the user paints)

  // What a layer's tile has right now, to keep for undo or redo: the tile in RAM or, if its latest pixels are still
  // only on the graphics card, an IOU, read without waiting. The read gets the tile as it is now, even if something
  // changes it right afterwards, because the graphics card works in order
  function currentTile(layer: Layer, key: string): TileBackup {
    const cached = gpu.getCached(layer, key)
    if (!cached?.dirty) return layer.tiles.get(key) ?? null
    return gpu.readLater(cached)
  }

  // Start recording a change to a layer (a stroke, clearing the layer...)
  function begin(layer: Layer) {
    current = { layer, tiles: new Map() }
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
    undoStack.push(step)
    // After a new change, the steps that were undone can't be redone anymore
    for (const s of redoStack) forget(s)
    redoStack.length = 0

    // When the history takes too much memory, forget the oldest steps (but always keep the newest one)
    let bytes = 0
    for (const s of undoStack) bytes += stepBytes(s)
    while (bytes > MAX_UNDO_BYTES && undoStack.length > 1) {
      const oldest = undoStack.shift()!
      bytes -= stepBytes(oldest)
      forget(oldest)
    }
    return true
  }

  // A step that will never be used again: its IOUs are not needed anymore, so their reads don't have to fetch pixels
  function forget(step: UndoStep) {
    for (const backup of step.tiles.values()) {
      if (backup && 'read' in backup && backup.tile === undefined) gpu.cancel(backup)
    }
  }

  // The tile a backup stands for (an IOU is redeemed first)
  function tileOf(backup: TileBackup) {
    return backup && 'read' in backup ? gpu.redeem(backup) : backup
  }

  // How much RAM a step keeps (tiles that had no paint cost nothing)
  function stepBytes(step: UndoStep) {
    let bytes = 0
    for (const backup of step.tiles.values()) {
      const tile = backup && 'read' in backup ? backup.tile : backup
      if (tile) bytes += bytesOf(tile)
      else if (tile === undefined) bytes += TILE_SIZE * TILE_SIZE * 4 // an IOU not filled in yet counts as a whole tile
    }
    return bytes
  }

  // Put the kept pixels back into the layer, and keep in the step what the layer had instead.
  // That way the same step works in both directions: undo swaps it once, redo swaps it back
  function swapTiles(step: UndoStep) {
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

  function undo() {
    const step = undoStack.pop()
    if (!step) return
    swapTiles(step)
    redoStack.push(step)
  }

  function redo() {
    const step = redoStack.pop()
    if (!step) return
    swapTiles(step)
    undoStack.push(step)
  }

  // Every tile the history keeps, for the memory budget
  function* storedTiles() {
    for (const step of [...undoStack, ...redoStack]) {
      for (const backup of step.tiles.values()) {
        const tile = backup && 'read' in backup ? backup.tile : backup
        if (tile) yield tile
      }
    }
  }

  return {
    begin,
    backUpTile,
    isRecording,
    end,
    undo,
    redo,
    storedTiles,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
  }
}

export type History = ReturnType<typeof createHistory>
