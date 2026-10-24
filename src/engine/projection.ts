import { Container, Graphics, RenderTexture, Sprite } from 'pixi.js'
import type { GlRenderTarget, GlRenderTargetAdaptor, Texture, WebGLRenderer } from 'pixi.js'
import type { GpuTiles } from './gpuTiles'
import { activeIndex, type Layer, type LayerStack } from './layers'
import { forEachTile, parseTileKey, TILE_SIZE, tileKey, tileSize, type Grid } from './tiles'

// The projection is the only thing drawn on the screen: one grid of tiles covering the whole paper, with the paper's
// color and all the visible layers already put together, like Krita does. To put a tile together quickly while
// painting, "below" keeps the paper and every layer under the active one already put together as well, so only the
// active layer and the layers above it need to be added. "background" is the paper's color, or null when the paper is
// transparent: then the tiles are transparent where nothing is painted

// A stroke being painted, shown on the active layer before it is put into it (see brush.ts): its own tiles of paint
// ("column,row" -> texture, white with the paint in its alpha), and how they go onto the layer
export type ShownStroke = { tiles: Map<string, Texture>; color: string; opacity: number; erase: boolean }

export function createProjection(
  renderer: WebGLRenderer,
  grid: Grid,
  stack: LayerStack,
  gpu: GpuTiles,
  background: string | null,
) {
  const projection = new Map<string, RenderTexture>() // "column,row" -> the tile's texture
  const below = new Map<string, RenderTexture>()
  const container = new Container() // holds one sprite per projection tile; this is what the screen shows
  const tileSprites = new Map<string, Sprite>() // "column,row" -> the sprite that shows the projection tile

  // "below" tiles that still have the layers of a previously active layer. Choosing another layer doesn't change the
  // image, so the projection stays as it is, and each "below" tile is put together again only when it is needed
  const staleBelow = new Set<string>()

  // Projection tiles waiting to be put together again after a layer change, and the new versions already put together
  // but not shown yet (see composeLayerTiles)
  const waiting = new Set<string>()
  const prepared = new Map<string, RenderTexture>()
  // Textures of projection tiles that were replaced, reused for the next new versions: creating and deleting
  // thousands of textures at once takes time. When nothing is being updated, they are freed a few every frame
  const spareTextures: RenderTexture[] = []
  const FREE_PER_FRAME = 32
  // The order to work through the waiting tiles in (see cachedFirst); null = to be worked out again
  let waitingOrder: string[] | null = null

  const composeRoot = new Container()
  const paperTile = new Graphics()
  if (background !== null) paperTile.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(background)
  const belowSprite = new Sprite()
  const layerSprites: Sprite[] = [] // reused between tiles instead of creating new sprites every time

  let stroke: ShownStroke | null = null
  // The active layer's tile with the stroke on it, as it will be once the stroke is put into the layer. One tile at a
  // time: it is used right away by the tile being put together
  let withStrokeTexture: RenderTexture | null = null
  const withStrokeRoot = new Container()
  const withStrokeLayer = new Sprite()
  const withStrokePaint = new Sprite()
  withStrokeRoot.addChild(withStrokeLayer, withStrokePaint)

  function withStroke(layerTexture: Texture | null, strokeTexture: Texture, shown: ShownStroke) {
    withStrokeTexture ??= RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE })
    withStrokeLayer.visible = layerTexture !== null
    if (layerTexture) withStrokeLayer.texture = layerTexture
    withStrokePaint.texture = strokeTexture
    withStrokePaint.tint = shown.color
    withStrokePaint.alpha = shown.opacity
    withStrokePaint.blendMode = shown.erase ? 'erase' : 'normal'
    renderer.render({ container: withStrokeRoot, target: withStrokeTexture, clear: true, clearColor: [0, 0, 0, 0] })
    return withStrokeTexture
  }

  // Show this stroke on the active layer from now on, or none
  function showStroke(shown: ShownStroke | null) {
    stroke = shown
  }

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
      let texture = gpu.getTexture(layer, column, row, false)
      const strokeTexture = layer === stack.active ? stroke?.tiles.get(tileKey(column, row)) : undefined
      if (stroke && strokeTexture) texture = withStroke(texture, strokeTexture, stroke)
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

  // The projection tile = the "below" tile + the active layer + the layers above it, put together into "target"
  function composeTileInto(column: number, row: number, target: RenderTexture) {
    const key = tileKey(column, row)
    if (staleBelow.delete(key)) composeBelowTile(column, row) // delete() returns true if the key was in the set
    belowSprite.texture = below.get(key)!
    composeLayers(belowSprite, activeIndex(stack), stack.layers.length, column, row, target)
  }

  // Put a projection tile together right away, on the screen (while painting, after undoing a stroke...)
  function composeTile(column: number, row: number) {
    const key = tileKey(column, row)
    composeTileInto(column, row, projection.get(key)!)
    // It is up to date now, so a new version waiting or being prepared isn't needed anymore
    waiting.delete(key)
    dropPrepared(key)
    stopLive(key)
  }

  // Put the whole projection together again
  function composeAll() {
    forEachTile(grid, composeTile)
  }

  // Put together again the tiles a layer changes: the ones where it has paint. Elsewhere the layer is transparent, so
  // hiding, showing, moving or deleting it, or changing its opacity, changes nothing there.
  // With many big layers that can be thousands of tiles, each needing every layer at its place, and most of those
  // must be sent from RAM to the graphics card again: seconds of work. Doing it all at once would freeze the screen,
  // and showing each tile as soon as it is ready makes the change spread over the picture like a short video. So the
  // new versions are put together out of sight, a few every frame (see composeWaiting), and once they are all ready
  // the screen shows them at once
  function composeLayerTiles(layer: Layer) {
    const index = stack.layers.indexOf(layer) // -1 for a layer that was just deleted, which may have been in "below"
    const isBelowActive = index < activeIndex(stack)
    for (const key of gpu.tilesWithPaint(layer)) {
      if (isBelowActive) markBelowStale(key)
      dropPrepared(key) // a version prepared before this change is out of date
      addWaiting(key)
    }
    // Tiles of this layer still shown live (just after the opacity slider was let go) follow it right away
    if (layer === liveLayer) {
      for (const tile of live.values()) {
        tile.layerSprite.alpha = layer.opacity
        tile.layerSprite.visible = layer.visible
      }
    }
  }

  // Put these tiles together again like the tiles of a layer change: out of sight, a few every frame, and shown all at
  // once when they are all ready (after a big fill)
  function composeLater(keys: Iterable<string>) {
    for (const key of keys) {
      dropPrepared(key)
      addWaiting(key)
    }
  }

  // Do the waiting work for at most "budget" milliseconds: first start the tiles to show live (while the opacity slider
  // moves), then prepare the new versions of the waiting tiles. Each group is shown all at once when it is complete
  function composeWaiting(budget: number) {
    if (waiting.size === 0 && startingLive.size === 0 && prepared.size === 0) {
      for (const texture of spareTextures.splice(-FREE_PER_FRAME)) texture.destroy(true)
      return
    }
    const deadline = performance.now() + budget
    startingOrder ??= cachedFirst(startingLive)
    for (const key of startingOrder) {
      if (!startingLive.has(key)) continue
      if (performance.now() >= deadline) return // the rest in the next frame
      startingLive.delete(key)
      startLive(liveLayer!, key)
    }
    startingOrder = null
    showStartedLive()
    waitingOrder ??= cachedFirst(waiting)
    for (const key of waitingOrder) {
      if (!waiting.has(key)) continue
      if (performance.now() >= deadline) return
      const { column, row } = parseTileKey(key)
      const texture = takeTexture(column, row)
      composeTileInto(column, row, texture)
      waiting.delete(key)
      prepared.set(key, texture)
    }
    waitingOrder = null
    showPrepared()
    releaseLiveLayerIfDone()
  }

  function addWaiting(key: string) {
    waiting.add(key)
    waitingOrder = null
  }

  // The tiles whose layers are most on the graphics card go first. With more tiles than the graphics card keeps, going
  // through them in the same order every time would push each one out just before it is needed again (the tile unused
  // for the longest time leaves first); starting with the ones still there uses them before they leave
  function cachedFirst(keys: Set<string>) {
    const cachedLayers = new Map<string, number>()
    for (const key of keys) {
      let count = 0
      for (const layer of stack.layers) if (layer.visible && gpu.getCached(layer, key)) count++
      cachedLayers.set(key, count)
    }
    return [...keys].sort((a, b) => cachedLayers.get(b)! - cachedLayers.get(a)!)
  }

  // Once every waiting tile has its new version, show them all at once
  function showPrepared() {
    for (const [key, texture] of prepared) {
      applyScaleMode(texture)
      const old = projection.get(key)!
      projection.set(key, texture)
      tileSprites.get(key)!.texture = texture
      spareTextures.push(old)
      stopLive(key)
    }
    prepared.clear()
  }

  // A texture for a new version of a tile: a spare one of the same size, or a new one
  function takeTexture(column: number, row: number) {
    const { width, height } = tileSize(grid, column, row)
    for (let i = spareTextures.length - 1; i >= 0; i--) {
      const texture = spareTextures[i]
      if (texture.width === width && texture.height === height) return spareTextures.splice(i, 1)[0]
    }
    return RenderTexture.create({ width, height })
  }

  function dropPrepared(key: string) {
    const texture = prepared.get(key)
    if (!texture) return
    spareTextures.push(texture)
    prepared.delete(key)
  }

  // Do all the waiting work now (before the projection is read for exporting)
  function finishWaiting() {
    composeWaiting(Infinity)
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
  // back to its projection tile as soon as that is put together again (see composeTile).
  // Starting a tile needs every layer at its place, so with many big layers, starting all of them at once would
  // freeze the screen: they start a few every frame instead (see composeWaiting), out of sight, and are shown all at
  // once when they are all ready
  type LiveTile = { sprites: Container; layerSprite: Sprite; above: RenderTexture | null }
  const live = new Map<string, LiveTile>() // "column,row" -> the tile shown live
  const startingLive = new Set<string>() // tiles waiting to be shown live
  const startedLive: string[] = [] // live tiles ready but not shown yet
  let startingOrder: string[] | null = null // the order to start them in (see cachedFirst)
  let liveLayer: Layer | null = null // the layer the live tiles show
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
    if (liveLayer !== layer) {
      finishLive()
      gpu.keep(layer) // the sprites show the layer's own textures, so they must stay on the graphics card
      liveLayer = layer
    }
    for (const tile of live.values()) tile.layerSprite.alpha = layer.opacity
    for (const key of keys) {
      if (live.has(key) || startingLive.has(key)) continue
      startingLive.add(key)
      startingOrder = null
    }
    return true
  }

  // Get a live tile ready, out of sight until the others are ready too (see showStartedLive)
  function startLive(layer: Layer, key: string) {
    const { column, row } = parseTileKey(key)
    const texture = gpu.getTexture(layer, column, row, false)
    if (!texture) return // no paint here
    if (staleBelow.delete(key)) composeBelowTile(column, row)
    const first = activeIndex(stack) + 1
    let above: RenderTexture | null = null
    if (stack.layers.slice(first).some(other => other.visible && hasPaint(other, key))) {
      above = takeTexture(column, row)
      composeLayers(emptyBase, first, stack.layers.length, column, row, above)
    }

    const sprites = new Container()
    sprites.position.set(column * TILE_SIZE, row * TILE_SIZE)
    const layerSprite = new Sprite(texture)
    layerSprite.blendMode = layer.blendMode
    sprites.addChild(new Sprite(below.get(key)!), layerSprite)
    if (above) sprites.addChild(new Sprite(above))
    for (const sprite of sprites.children as Sprite[]) applyScaleMode(sprite.texture)
    layerSprite.alpha = layer.opacity
    sprites.visible = false
    liveContainer.addChild(sprites)
    live.set(key, { sprites, layerSprite, above })
    startedLive.push(key)
  }

  // Once every live tile is ready, show them all at once instead of their projection tiles
  function showStartedLive() {
    if (startingLive.size > 0) return
    for (const key of startedLive) {
      const tile = live.get(key)
      if (!tile) continue // put together again in the meantime
      tile.sprites.visible = true
      tileSprites.get(key)!.visible = false
    }
    startedLive.length = 0
  }

  // Show the projection tile again instead of the live one
  function stopLive(key: string) {
    const tile = live.get(key)
    if (!tile) return
    tile.sprites.destroy({ children: true }) // only the sprites: their textures belong to the layer and to "below"
    if (tile.above) spareTextures.push(tile.above) // freed later, a few every frame (see composeWaiting)
    tileSprites.get(key)!.visible = true
    live.delete(key)
    releaseLiveLayerIfDone()
  }

  // Once no tile is shown live or waiting to be, the layer's tiles can leave the graphics card again
  function releaseLiveLayerIfDone() {
    if (!liveLayer || live.size > 0 || startingLive.size > 0) return
    gpu.keep(null)
    liveLayer = null
  }

  // Put the tiles shown live together for good, now (before the "below" tiles change, or before exporting). The ones
  // not shown live yet still have the old opacity in the projection, so they wait to be put together again
  function finishLive() {
    for (const key of startingLive) addWaiting(key)
    startingLive.clear()
    startedLive.length = 0
    for (const key of [...live.keys()]) {
      const { column, row } = parseTileKey(key)
      composeTile(column, row)
    }
    releaseLiveLayerIfDone()
  }

  // The same, a few every frame like the other waiting tiles (once the opacity slider is let go). Until it is put
  // together, each live tile stays live, showing the right picture
  function finishLiveLater() {
    for (const key of [...startingLive, ...live.keys()]) addWaiting(key)
    startingLive.clear()
    startedLive.length = 0 // those not shown yet stay hidden: the new versions replace them all at once
    releaseLiveLayerIfDone()
  }

  // ----- Showing a move -----

  // While the move tool drags a part of the active layer (see move.ts), the moved part is shown on its own, over what
  // is left of the layer and under the layers above, so each new position costs nothing to show. Tiles where the layer
  // loses paint, or where layers above have paint, are shown with three pictures instead of their projection tile: the
  // "below" tile with what is left of the active layer on it, the moved part, and the layers above put together.
  // Elsewhere the projection tile already has everything under the moved part, and nothing goes over it.
  // The pictures are copies, so the layer's tiles can change under them once the move is let go. Like the live
  // opacity, the layers above are put together on their own, so a blend mode other than normal among them looks a
  // little different until the move is done, and so does the moved part over what is left of a layer at less than full
  // opacity
  type MoveTile = { sprites: Sprite[]; textures: RenderTexture[] }
  const moveTiles = new Map<string, MoveTile>() // "column,row" -> the tile's pictures
  const moveUnder = new Container() // "below" and what is left of the active layer
  const moved = new Container() // the moved part, at its tiles' places, moved along by the drag
  const moveAbove = new Container() // the layers above
  const moveParts = [moveUnder, moved, moveAbove]
  for (const part of moveParts) part.visible = false

  // The tiles where a visible layer above the active one has paint
  function paintedAbove() {
    const keys = new Set<string>()
    for (const layer of stack.layers.slice(activeIndex(stack) + 1)) {
      if (layer.visible) for (const key of gpu.tilesWithPaint(layer)) keys.add(key)
    }
    return keys
  }

  // Get a tile ready for showing a move, out of sight until showMove: "lifted" is the part of the active layer's tile
  // that moves (null: none), and "left" what is left of the tile (null: nothing). Both are copies made in textures from
  // moveTexture, and belong to the move from now on
  function prepareMoveTile(key: string, lifted: RenderTexture | null, left: RenderTexture | null) {
    const { column, row } = parseTileKey(key)
    const layer = stack.active
    if (staleBelow.delete(key)) composeBelowTile(column, row)
    const tile: MoveTile = { sprites: [], textures: [] }
    const add = (part: Container, texture: Texture, isActiveLayer: boolean) => {
      const sprite = new Sprite(texture)
      sprite.position.set(column * TILE_SIZE, row * TILE_SIZE)
      if (isActiveLayer) {
        sprite.alpha = layer.opacity
        sprite.blendMode = layer.blendMode
      }
      part.addChild(sprite)
      tile.sprites.push(sprite)
    }
    add(moveUnder, below.get(key)!, false)
    if (left) add(moveUnder, left, true)
    if (lifted) add(moved, lifted, true)
    const first = activeIndex(stack) + 1
    let above: RenderTexture | null = null
    if (stack.layers.slice(first).some(other => other.visible && hasPaint(other, key))) {
      above = takeTexture(column, row)
      composeLayers(emptyBase, first, stack.layers.length, column, row, above)
      add(moveAbove, above, false)
    }
    for (const texture of [left, lifted, above]) if (texture) tile.textures.push(texture)
    moveTiles.set(key, tile)
  }

  // Show the prepared tiles instead of their projection tiles, with the moved part this far from where it was
  function showMove(x: number, y: number) {
    moved.position.set(x, y)
    for (const key of moveTiles.keys()) tileSprites.get(key)!.visible = false
    for (const part of moveParts) part.visible = true
    applyMoveScaleMode()
  }

  function setMoveOffset(x: number, y: number) {
    moved.position.set(x, y)
  }

  // Show the projection tiles again. The pictures' textures are freed later, a few every frame
  function endMove() {
    for (const [key, tile] of moveTiles) {
      tileSprites.get(key)!.visible = true
      for (const sprite of tile.sprites) sprite.destroy()
      spareTextures.push(...tile.textures)
    }
    moveTiles.clear()
    for (const part of moveParts) part.visible = false
    moved.position.set(0, 0)
  }

  function applyMoveScaleMode() {
    for (const part of moveParts) {
      for (const sprite of part.children as Sprite[]) applyScaleMode(sprite.texture)
    }
  }

  // ----- Reading colors -----

  const pixel = new Uint8Array(4)

  // The color the screen shows at this point of the paper, as "#rrggbb": the paper and every visible layer, put
  // together. Null outside the paper and where nothing is painted on a transparent paper. (Tiles shown live while a
  // layer's opacity changes are read as they were before it, until they are put together again a moment later)
  function colorAt(x: number, y: number) {
    const paperX = Math.floor(x)
    const paperY = Math.floor(y)
    if (paperX < 0 || paperY < 0 || paperX >= grid.width || paperY >= grid.height) return null
    const column = Math.floor(paperX / TILE_SIZE)
    const row = Math.floor(paperY / TILE_SIZE)
    // Read one pixel of the tile, the way PixiJS reads pixels itself. It waits for the graphics card, which takes
    // a moment for one pixel
    const renderTarget = renderer.renderTarget.getRenderTarget(projection.get(tileKey(column, row))!)
    const glRenderTarget = renderer.renderTarget.getGpuRenderTarget(renderTarget) as GlRenderTarget
    ;(renderer.renderTarget.adaptor as GlRenderTargetAdaptor).bindFramebuffer(glRenderTarget.resolveTargetFramebuffer)
    const gl = renderer.gl
    gl.readPixels(paperX - column * TILE_SIZE, paperY - row * TILE_SIZE, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    const alpha = pixel[3]
    if (alpha === 0) return null
    // The graphics card keeps colors multiplied by their alpha (see exportImage in engine.ts): undo that
    const hex = (value: number) =>
      Math.min(255, Math.round((value * 255) / alpha))
        .toString(16)
        .padStart(2, '0')
    return `#${hex(pixel[0])}${hex(pixel[1])}${hex(pixel[2])}`
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
    applyMoveScaleMode()
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
  container.addChild(liveContainer, ...moveParts)
  composeAll()

  function destroy() {
    endMove()
    for (const tile of live.values()) tile.above?.destroy(true)
    for (const texture of [...prepared.values(), ...spareTextures]) texture.destroy(true)
    for (const texture of [...projection.values(), ...below.values()]) texture.destroy(true)
    container.destroy({ children: true })
    composeRoot.destroy()
    withStrokeRoot.destroy({ children: true })
    withStrokeTexture?.destroy(true)
    paperTile.destroy()
    emptyBase.destroy()
  }

  return {
    container,
    tiles: projection,
    composeTile,
    composeAll,
    composeLayerTiles,
    composeLater,
    composeWaiting,
    finishWaiting,
    isUpdating: () => waiting.size > 0 || startingLive.size > 0 || prepared.size > 0,
    markAllBelowStale,
    markBelowStale,
    prepareTile,
    showOpacityLive,
    showStroke,
    finishLive,
    finishLiveLater,
    paintedAbove,
    moveTexture: takeTexture,
    prepareMoveTile,
    showMove,
    setMoveOffset,
    endMove,
    colorAt,
    setZoom,
    destroy,
  }
}

export type Projection = ReturnType<typeof createProjection>
