import { Container, Graphics, RenderTexture, Sprite } from 'pixi.js'
import type { Texture, WebGLRenderer } from 'pixi.js'
import type { GpuTiles } from './gpuTiles'
import { activeIndex, type Layer, type LayerStack } from './layers'
import { forEachTile, parseTileKey, TILE_SIZE, tileKey, type Grid } from './tiles'

// The projection is the only thing drawn on the screen: one grid of tiles covering the whole paper, with the white
// paper and all the visible layers already put together, like Krita does. To put a tile together quickly while
// painting, "below" keeps the paper and every layer under the active one already put together as well, so only the
// active layer and the layers above it need to be added
export function createProjection(renderer: WebGLRenderer, grid: Grid, stack: LayerStack, gpu: GpuTiles) {
  const projection = new Map<string, RenderTexture>() // "column,row" -> the tile's texture
  const below = new Map<string, RenderTexture>()
  const container = new Container() // holds one sprite per projection tile; this is what the screen shows
  const tileSprites = new Map<string, Sprite>() // "column,row" -> the sprite that shows the projection tile

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
    stopLive(key) // the projection tile is up to date again
  }

  // Put the whole projection together again (after a layer is hidden, shown, or changes its opacity)
  function composeAll() {
    forEachTile(grid, composeTile)
  }

  // Every "below" tile must be put together again, the next time it is needed (after choosing another layer, adding
  // one, or changing a layer under the active one)
  function markAllBelowStale() {
    for (const key of below.keys()) staleBelow.add(key)
    finishLive() // tiles shown live use the "below" tiles of the layer that was active
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

  // ----- Showing the active layer's opacity live -----

  // Putting every tile of a big layer together again for each step of the opacity slider would be too slow. So while
  // the slider moves, each tile of the active layer is shown with three sprites instead of its projection tile: its
  // "below" tile, the layer's own tile with the new opacity, and the layers above it, put together once. A new opacity
  // then only changes one sprite per tile, and the graphics card puts the three together on every frame. A tile goes
  // back to its projection tile as soon as that is put together again (see composeTile)
  type LiveTile = { sprites: Container; layerSprite: Sprite; above: RenderTexture | null }
  const live = new Map<string, LiveTile>() // "column,row" -> the tile shown live
  const liveContainer = new Container() // on top of the projection's sprites
  const emptyBase = new Container() // the layers above are put together over nothing (transparent)

  // Whether a layer has paint at this tile, in RAM or still only on the graphics card
  function hasPaint(layer: Layer, key: string) {
    return layer.tiles.has(key) || gpu.getCached(layer, key)?.dirty === true
  }

  // Show the active layer's tiles at "keys" with its current opacity. Returns false when that can't be done this way,
  // and the tiles must be put together again instead
  function showOpacityLive(layer: Layer, keys: Iterable<string>) {
    if (layer !== stack.active) return false // "below" only has the layers under the active one
    // The layers above are put together on their own, without what is under them. That only gives the same picture
    // when they all use the normal blend mode: the others (like multiply) depend on what is under them
    const above = stack.layers.slice(activeIndex(stack) + 1)
    if (above.some(other => other.visible && other.blendMode !== 'normal')) return false
    gpu.keep(layer) // the sprites show the layer's own textures, so they must stay on the graphics card
    for (const key of keys) {
      const tile = live.get(key) ?? startLive(layer, key)
      if (tile) tile.layerSprite.alpha = layer.opacity
    }
    return true
  }

  function startLive(layer: Layer, key: string) {
    const { column, row } = parseTileKey(key)
    const texture = gpu.getTexture(layer, column, row, false)
    if (!texture) return null // no paint here
    if (staleBelow.delete(key)) composeBelowTile(column, row)
    const first = activeIndex(stack) + 1
    let above: RenderTexture | null = null
    if (stack.layers.slice(first).some(other => other.visible && hasPaint(other, key))) {
      above = gpu.createTexture(column, row)
      composeLayers(emptyBase, first, stack.layers.length, column, row, above)
    }

    const sprites = new Container()
    sprites.position.set(column * TILE_SIZE, row * TILE_SIZE)
    const layerSprite = new Sprite(texture)
    layerSprite.blendMode = layer.blendMode
    sprites.addChild(new Sprite(below.get(key)!), layerSprite)
    if (above) sprites.addChild(new Sprite(above))
    for (const sprite of sprites.children as Sprite[]) applyScaleMode(sprite.texture)
    liveContainer.addChild(sprites)
    tileSprites.get(key)!.visible = false

    const tile = { sprites, layerSprite, above }
    live.set(key, tile)
    return tile
  }

  // Show the projection tile again instead of the live one
  function stopLive(key: string) {
    const tile = live.get(key)
    if (!tile) return
    tile.sprites.destroy({ children: true }) // only the sprites: their textures belong to the layer and to "below"
    tile.above?.destroy(true)
    tileSprites.get(key)!.visible = true
    live.delete(key)
    if (live.size === 0) gpu.keep(null)
  }

  // Put the tiles shown live together for good (once the opacity slider is let go)
  function finishLive() {
    for (const key of [...live.keys()]) {
      const { column, row } = parseTileKey(key)
      composeTile(column, row)
    }
  }

  // ----- Zoom -----

  // Zoomed in, show each pixel as a sharp square (like Photoshop and Krita); zoomed out, blend pixels smoothly
  let scaleMode: 'nearest' | 'linear' = 'linear'
  function setZoom(zoom: number) {
    const mode = zoom >= 1 ? 'nearest' : 'linear'
    if (mode === scaleMode) return
    scaleMode = mode
    for (const texture of projection.values()) applyScaleMode(texture)
    for (const { sprites } of live.values()) {
      for (const sprite of sprites.children as Sprite[]) applyScaleMode(sprite.texture)
    }
  }

  // Tiles are put together with every texture at its own size, where both modes give the same result, so the
  // textures of the tiles shown live can change their mode too
  function applyScaleMode(texture: Texture) {
    if (texture.source.scaleMode === scaleMode) return
    texture.source.scaleMode = scaleMode
    texture.source.style.update() // tell PixiJS the setting changed, so the graphics card uses it
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
    tileSprites.set(key, sprite)
  })
  container.addChild(liveContainer)
  composeAll()

  function destroy() {
    for (const tile of live.values()) tile.above?.destroy(true)
    for (const texture of [...projection.values(), ...below.values()]) texture.destroy(true)
    container.destroy({ children: true })
    composeRoot.destroy()
    paperTile.destroy()
    emptyBase.destroy()
  }

  return {
    container,
    tiles: projection,
    composeTile,
    composeAll,
    markAllBelowStale,
    markBelowStale,
    prepareTile,
    showOpacityLive,
    finishLive,
    setZoom,
    destroy,
  }
}

export type Projection = ReturnType<typeof createProjection>
