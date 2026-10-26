import { Container, Sprite } from 'pixi.js'
import type { GpuTiles } from './gpuTiles'
import type { Layer, LayerStack } from './layers'
import { GHOST_ALPHA } from './projection'
import { isOnPaper, parseTileKey, TILE_SIZE, tileSize, type Grid } from './tiles'

// The paint off the paper of the layers that show it (each layer's "showOffPaper", decision 50), faded, around the
// paper: it goes under the paper (see engine.ts), which hides it where it is on the paper. It is shown again after
// every change (see update), from the layers' own tiles on the graphics card, which stay there meanwhile ("pinned")
export function createOutsideView(grid: Grid, stack: LayerStack, gpu: GpuTiles) {
  const container = new Container()
  container.alpha = GHOST_ALPHA
  const sprites: Sprite[] = [] // reused from one update to the next

  // Show the paint off the paper of the visible layers that show it, from the bottom up. "hidden" is left out: the
  // layer the move tool or a transform is moving, which shows its own (see the ghost in projection.ts)
  function update(hidden: Layer | null = null) {
    gpu.unpinAll()
    container.removeChildren()
    let count = 0
    for (const layer of stack.layers) {
      if (!layer.showOffPaper || !layer.visible || layer === hidden) continue
      for (const key of gpu.tilesWithPaint(layer)) {
        const { column, row } = parseTileKey(key)
        if (isOnPaper(grid, column, row)) {
          const { width, height } = tileSize(grid, column, row)
          if (width === TILE_SIZE && height === TILE_SIZE) continue // all on the paper
        }
        const texture = gpu.pin(layer, column, row)
        if (!texture) continue
        sprites[count] ??= new Sprite()
        const sprite = sprites[count++]
        sprite.texture = texture
        sprite.position.set(column * TILE_SIZE, row * TILE_SIZE)
        sprite.alpha = layer.opacity
        container.addChild(sprite)
      }
    }
  }

  function destroy() {
    gpu.unpinAll()
    container.destroy()
    for (const sprite of sprites) sprite.destroy()
  }

  return { container, update, destroy }
}

export type OutsideView = ReturnType<typeof createOutsideView>
