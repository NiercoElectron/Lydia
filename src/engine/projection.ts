import { Container, Graphics, RenderTexture, Sprite } from 'pixi.js'
import type { WebGLRenderer } from 'pixi.js'
import type { GpuTiles } from './gpuTiles'
import { activeIndex, type LayerStack } from './layers'
import { forEachTile, TILE_SIZE, tileKey, type Grid } from './tiles'

// The projection is the only thing drawn on the screen: one grid of tiles covering the whole paper, with the white
// paper and all the visible layers already put together, like Krita does. To put a tile together quickly while
// painting, "below" keeps the paper and every layer under the active one already put together as well, so only the
// active layer and the layers above it need to be added
export function createProjection(renderer: WebGLRenderer, grid: Grid, stack: LayerStack, gpu: GpuTiles) {
  const projection = new Map<string, RenderTexture>() // "column,row" -> the tile's texture
  const below = new Map<string, RenderTexture>()
  const container = new Container() // holds one sprite per projection tile; this is what the screen shows

  // "below" tiles that still have the layers of a previously active layer. Choosing another layer doesn't change the
  // image, so the projection stays as it is, and each "below" tile is put together again only when it is needed
  const staleBelow = new Set<string>()

  const composeRoot = new Container()
  const paperTile = new Graphics().rect(0, 0, TILE_SIZE, TILE_SIZE).fill(0xffffff)
  const belowSprite = new Sprite()
  const layerSprites: Sprite[] = [] // reused between tiles instead of creating new sprites every time

  // Put the tiles at this column and row of the layers from "first" to "last" (not included) on top of "base",
  // into "target"
  function composeLayers(
    base: Container,
    first: number,
    last: number,
    column: number,
    row: number,
    target: RenderTexture,
  ) {
    composeRoot.removeChildren()
    composeRoot.addChild(base)
    let count = 0
    for (let i = first; i < last; i++) {
      const layer = stack.layers[i]
      if (!layer.visible) continue
      const texture = gpu.getTexture(layer, column, row, false)
      if (!texture) continue // no paint on this layer here
      let sprite = layerSprites[count]
      if (!sprite) {
        sprite = new Sprite()
        layerSprites[count] = sprite
      }
      sprite.texture = texture
      sprite.alpha = layer.opacity
      sprite.blendMode = layer.blendMode
      composeRoot.addChild(sprite)
      count++
    }
    renderer.render({ container: composeRoot, target, clear: true })
    gpu.trim()
  }

  // The "below" tile = the paper + every layer under the active one
  function composeBelowTile(column: number, row: number) {
    composeLayers(paperTile, 0, activeIndex(stack), column, row, below.get(tileKey(column, row))!)
  }

  // The projection tile = the "below" tile + the active layer + the layers above it
  function composeTile(column: number, row: number) {
    const key = tileKey(column, row)
    if (staleBelow.delete(key)) composeBelowTile(column, row) // delete() returns true if the key was in the set
    belowSprite.texture = below.get(key)!
    composeLayers(belowSprite, activeIndex(stack), stack.layers.length, column, row, projection.get(key)!)
  }

  // Put the whole projection together again (after a layer is hidden, shown, or changes its opacity)
  function composeAll() {
    forEachTile(grid, composeTile)
  }

  // Every "below" tile must be put together again, the next time it is needed (after choosing another layer, adding
  // one, or changing a layer under the active one)
  function markAllBelowStale() {
    for (const key of below.keys()) staleBelow.add(key)
  }

  function markBelowStale(key: string) {
    staleBelow.add(key)
  }

  // Make a tile ready for painting: its "below" up to date, and the active layer and the ones above on the graphics
  // card. Tiles that are already ready cost almost nothing
  function prepareTile(column: number, row: number) {
    if (staleBelow.delete(tileKey(column, row))) composeBelowTile(column, row)
    for (let i = activeIndex(stack); i < stack.layers.length; i++) {
      if (stack.layers[i].visible) gpu.getTexture(stack.layers[i], column, row, false)
    }
  }

  // Zoomed in, show each pixel as a sharp square (like Photoshop and Krita); zoomed out, blend pixels smoothly
  let scaleMode: 'nearest' | 'linear' = 'linear'
  function setZoom(zoom: number) {
    const mode = zoom >= 1 ? 'nearest' : 'linear'
    if (mode === scaleMode) return
    scaleMode = mode
    for (const texture of projection.values()) {
      texture.source.scaleMode = mode
      texture.source.style.update() // tell PixiJS the setting changed, so the graphics card uses it
    }
  }

  // Create the tiles of the projection (with one sprite each) and of "below", and show the drawing
  forEachTile(grid, (column, row) => {
    const key = tileKey(column, row)
    below.set(key, gpu.createTexture(column, row))
    staleBelow.add(key)
    const texture = gpu.createTexture(column, row)
    projection.set(key, texture)
    const sprite = new Sprite(texture)
    sprite.position.set(column * TILE_SIZE, row * TILE_SIZE)
    container.addChild(sprite)
  })
  composeAll()

  function destroy() {
    for (const texture of [...projection.values(), ...below.values()]) texture.destroy(true)
    container.destroy({ children: true })
    composeRoot.destroy()
    paperTile.destroy()
  }

  return {
    container,
    tiles: projection,
    composeTile,
    composeAll,
    markAllBelowStale,
    markBelowStale,
    prepareTile,
    setZoom,
    destroy,
  }
}

export type Projection = ReturnType<typeof createProjection>
