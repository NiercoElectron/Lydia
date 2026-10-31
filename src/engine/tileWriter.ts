import { Container, RenderTexture, Sprite, type Texture, type WebGLRenderer } from 'pixi.js'
import type { StrokeCutter } from './brush'
import type { GpuTiles } from './gpuTiles'
import type { History } from './history'
import { LOCKED_ALPHA, type Layer } from './layers'
import type { Projection } from './projection'
import { parseTileKey, TILE_SIZE } from './tiles'

export type LayerSelection = StrokeCutter & { cutAway: (texture: RenderTexture, key: string) => void }

// For the tools that work out a layer's tiles apart from it (see mixTools.ts and liquify.ts): drawing pictures into
// textures, and putting a finished tile on the layer
export function createTileWriter(
  renderer: WebGLRenderer,
  gpu: GpuTiles,
  projection: Projection,
  history: History,
  selection: LayerSelection,
) {
  // PixiJS ignores the blend mode of what it is asked to render, so the sprite goes inside a container
  const copyRoot = new Container()
  const copySprite = new Sprite()
  copyRoot.addChild(copySprite)
  const nothing = new Container()
  let kept: RenderTexture | null = null // a tile for working out what goes on the layer

  const clear = (target: RenderTexture) =>
    renderer.render({ container: nothing, target, clear: true, clearColor: [0, 0, 0, 0] })

  // Draw "from" into "target" at (x, y). "none": in place of what is there
  function draw(from: Texture, target: RenderTexture, x = 0, y = 0, blendMode: string = 'none') {
    copySprite.texture = from
    copySprite.position.set(x, y)
    copySprite.blendMode = blendMode as Sprite['blendMode']
    renderer.render({ container: copyRoot, target, clear: false })
  }

  // What a worked out tile gives the layer's tile: only the paint of the layer's tile when its transparency is locked,
  // and only what is selected. "before" is the tile as it was, for those two cases
  function publish(layer: Layer, key: string, work: Texture, before?: Texture) {
    if (!selection.canPaint(key)) return
    const { column, row } = parseTileKey(key)
    history.backUpTile(key) // before the tile changes: the graphics card works in order
    const target = gpu.getTexture(layer, column, row, true)!
    if (!before) {
      draw(work, target)
    } else {
      kept ??= RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE })
      if (layer.alphaLocked) {
        draw(before, kept)
        draw(work, kept, 0, 0, LOCKED_ALPHA)
      } else {
        draw(work, kept)
      }
      if (selection.isCut(key)) {
        selection.cut(kept, key)
        draw(before, target)
        selection.cutAway(target, key)
        draw(kept, target, 0, 0, 'add')
      } else {
        draw(kept, target)
      }
    }
    gpu.markDirty(layer, key)
    projection.composeTile(column, row)
  }

  function destroy() {
    copyRoot.destroy({ children: true })
    kept?.destroy(true)
  }

  return { clear, draw, publish, destroy }
}

export type TileWriter = ReturnType<typeof createTileWriter>
