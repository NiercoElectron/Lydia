import { Container, Graphics, RenderTexture, Sprite } from 'pixi.js'
import type {
  BLEND_MODES,
  Geometry,
  GlRenderTarget,
  GlRenderTargetAdaptor,
  Mesh,
  Shader,
  Texture,
  WebGLRenderer,
} from 'pixi.js'
import { createTileMixer, type LayerBlender } from './blendModes'
import { createComposer, type LivePicture, type PaintOf } from './composer'
import type { GpuTiles } from './gpuTiles'
import {
  activeIndex,
  blockStart,
  isFolder,
  isInside,
  isShown,
  LOCKED_ALPHA,
  splitIndex,
  type BlendMode,
  type Layer,
  type LayerStack,
} from './layers'
import { forEachTile, isOnPaper, parseTileKey, TILE_SIZE, tileKey, tileSize, type Grid } from './tiles'

// The projection is the only thing drawn on the screen: one grid of tiles covering the whole paper, with the paper's
// color and all the visible layers already put together, like Krita does. To put a tile together quickly while
// painting, "below" keeps the paper and every layer under the active one already put together as well, so only the
// active layer and the layers above it need to be added (when the active layer is in a folder, "below" stops under
// the outermost folder it is in, which is put together whole: see splitIndex in layers.ts). "background" is the paper's color, or null when the paper is
// transparent: then the tiles are transparent where nothing is painted. The projection only covers the paper: layers'
// tiles off the paper (see tiles.ts) are never put together, and only show faded while the move tool or a transform
// moves them (see "ghost")

// How much the paint off the paper shows while it is moved or transformed (and when a layer shows it: see
// outsideView.ts)
export const GHOST_ALPHA = 0.35

// A stroke being painted, shown on the active layer before it is put into it (see brush.ts): its own tiles of paint
// ("column,row" -> texture, white with the paint in its alpha), and how they go onto the layer
// A stroke being painted: its tiles, its color and opacity, whether it erases, and whether the layer's transparency is
// locked (see layers.ts)
export type ShownStroke = {
  tiles: Map<string, Texture>
  color: string
  opacity: number
  erase: boolean
  alphaLocked: boolean
}

// How a stroke goes onto its layer: taking paint away, only over the paint there, or as any paint does
export const strokeBlend = (shown: ShownStroke) =>
  (shown.erase ? 'erase' : shown.alphaLocked ? LOCKED_ALPHA : 'normal') as BLEND_MODES

export function createProjection(
  renderer: WebGLRenderer,
  grid: Grid,
  stack: LayerStack,
  gpu: GpuTiles,
  blender: LayerBlender,
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

  const paperTile = new Graphics()
  if (background !== null) paperTile.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(background)
  const belowSprite = new Sprite()

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
    withStrokePaint.blendMode = strokeBlend(shown)
    renderer.render({ container: withStrokeRoot, target: withStrokeTexture, clear: true, clearColor: [0, 0, 0, 0] })
    return withStrokeTexture
  }

  // Show this stroke on the active layer from now on, or none
  function showStroke(shown: ShownStroke | null) {
    stroke = shown
  }

  const composer = createComposer(renderer, stack, gpu, blender)

  // A layer's paint at this column and row, with the stroke being painted on it, if any
  const paintOf: PaintOf = (layer, column, row) => {
    const texture = gpu.getTexture(layer, column, row, false)
    const strokeTexture = layer === stack.active ? stroke?.tiles.get(tileKey(column, row)) : undefined
    return stroke && strokeTexture ? withStroke(texture, strokeTexture, stroke) : texture
  }

  // Put the tiles at this column and row of the layers and folders from "first" to "last" (not included) on top of
  // "base", into "target" (see composer.ts)
  function composeLayers(
    base: Container,
    first: number,
    last: number,
    column: number,
    row: number,
    target: RenderTexture,
  ) {
    composer.compose(base, first, last, column, row, target, paintOf)
    gpu.trim()
  }

  // Put together again the tiles of every clipped layer: after a change of the layers they are clipped to (a layer
  // deleted, moved, merged, clipped or unclipped)
  function composeClippedTiles() {
    for (const layer of stack.layers) if (layer.clipped && layer.visible) composeLayerTiles(layer)
  }

  // The "below" tile = the paper + every layer under the active one, or under the outermost folder it is in
  function composeBelowTile(column: number, row: number) {
    composeLayers(paperTile, 0, splitIndex(stack), column, row, below.get(tileKey(column, row))!)
  }

  // The projection tile = the "below" tile + the layers from there up, put together into "target"
  function composeTileInto(column: number, row: number, target: RenderTexture) {
    const key = tileKey(column, row)
    if (staleBelow.delete(key)) composeBelowTile(column, row) // delete() returns true if the key was in the set
    belowSprite.texture = below.get(key)!
    composeLayers(belowSprite, splitIndex(stack), stack.layers.length, column, row, target)
  }

  // Put a projection tile together right away, on the screen (while painting, after undoing a stroke...). A tile off
  // the paper has nothing to put together
  function composeTile(column: number, row: number) {
    if (!isOnPaper(grid, column, row)) return
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
  // A folder changes the tiles where the layers in it have paint: "list" is where to find them (the list from before,
  // for a folder just deleted)
  function composeLayerTiles(layer: Layer, list: Layer[] = stack.layers) {
    // Tiles of this layer still shown live (just after the opacity slider was let go) follow it right away
    if (layer === liveLayer) followLiveLayer()
    if (isFolder(layer)) {
      for (const inside of list) if (!isFolder(inside) && isInside(inside, layer)) composeLayerTiles(inside)
      return
    }
    const index = stack.layers.indexOf(layer) // -1 for a layer that was just deleted, which may have been in "below"
    const isBelowActive = index < splitIndex(stack)
    for (const key of onPaper(gpu.tilesWithPaint(layer))) {
      if (isBelowActive) markBelowStale(key)
      dropPrepared(key) // a version prepared before this change is out of date
      addWaiting(key)
    }
  }

  // Put these tiles together again like the tiles of a layer change: out of sight, a few every frame, and shown all at
  // once when they are all ready (after a big fill)
  function composeLater(keys: Iterable<string>) {
    for (const key of onPaper(keys)) {
      dropPrepared(key)
      addWaiting(key)
    }
  }

  // Do the waiting work for at most "budget" milliseconds: first start the tiles to show live (while the opacity slider
  // moves), then prepare the new versions of the waiting tiles. Each group is shown all at once when it is complete
  function composeWaiting(budget: number) {
    updateLive()
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
      startLive(key)
    }
    startingOrder = null
    showStartedLive()
    waitingOrder ??= cachedFirst(waiting)
    for (const key of waitingOrder) {
      if (!waiting.has(key)) continue
      if (performance.now() >= deadline) return
      const { column, row } = parseTileKey(key)
      const texture = takeTexture(tileSize(grid, column, row))
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

  // The keys of the tiles among these that are on the paper
  function onPaper(keys: Iterable<string>) {
    return [...keys].filter(key => {
      const { column, row } = parseTileKey(key)
      return isOnPaper(grid, column, row)
    })
  }

  // A texture of this size (a projection tile's, or a layer's whole tile): a spare one of the same size, or a new one
  function takeTexture({ width, height }: { width: number; height: number }) {
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
    if (below.has(key)) staleBelow.add(key)
  }

  // Make a tile ready for painting: its "below" up to date, and the active layer and the ones above on the graphics
  // card. Tiles that are already ready cost almost nothing
  function prepareTile(column: number, row: number) {
    if (staleBelow.delete(tileKey(column, row))) composeBelowTile(column, row)
    for (const layer of stack.layers.slice(splitIndex(stack))) {
      if (!isFolder(layer) && isShown(layer)) gpu.getTexture(layer, column, row, false)
    }
  }

  // ----- Showing the active layer's opacity live -----

  // Putting every tile of a big layer together again for each step of the opacity slider would be too slow. But a
  // tile's picture changes in a straight line with the layer's opacity: at 30 %, it is the picture without the layer
  // mixed with 30 % of the picture with the layer at full opacity, whatever the layer's blend mode, as long as what
  // goes over it only adds and multiplies (see live in composer.ts). So while the slider moves, each tile of the active
  // layer or folder is shown as a mix of those two pictures, made once (see createTileMixer in blendModes.ts), and a
  // new opacity only changes how much of each the graphics card shows. When a layer above it, or a folder it is in,
  // has a blend mode that does more, the mix is made up to there, and the rest are steps the graphics card also does on
  // every frame, from pictures of the other layers made once. With more steps than it can do at once (a pile of many
  // such layers and folders), the tile is put together for each new opacity instead (see showLive in composer.ts):
  // one more pass on the graphics card per step, instead of all the layers. A tile goes back to its projection tile as
  // soon as that is put together again (see composeTile).
  // Starting a tile needs every layer at its place, so with many big layers, starting all of them at once would
  // freeze the screen: they start a few every frame instead (see composeWaiting), out of sight, and are shown all at
  // once when they are all ready
  // "shown" is the tile put together for the current opacity, when the steps are too many for the screen
  type LiveTile = { mesh: Mesh<Geometry, Shader>; picture: LivePicture; shown: RenderTexture | null }
  const live = new Map<string, LiveTile>() // "column,row" -> the tile shown live
  const startingLive = new Set<string>() // tiles waiting to be shown live
  const startedLive: string[] = [] // live tiles ready but not shown yet
  let startingOrder: string[] | null = null // the order to start them in (see cachedFirst)
  let liveLayer: Layer | null = null // the layer or folder the live tiles show
  let liveAmount = 0 // how much of it they show: its opacity, or 0 while it is hidden
  let isLiveStale = false // the tiles with steps left must be put together again for a new opacity
  const mixer = createTileMixer(renderer)
  const liveContainer = new Container() // on top of the projection's sprites

  // Whether a layer has paint at this tile, in RAM or still only on the graphics card
  function hasPaint(layer: Layer, key: string) {
    return layer.tiles.has(key) || gpu.getCached(layer, key)?.dirty === true
  }

  // The tiles where a layer has paint, or the layers in a folder
  function tilesOf(layer: Layer) {
    if (!isFolder(layer)) return gpu.tilesWithPaint(layer)
    const keys = new Set<string>()
    for (const inside of stack.layers) {
      if (!isFolder(inside) && isInside(inside, layer)) for (const key of gpu.tilesWithPaint(inside)) keys.add(key)
    }
    return keys
  }

  // Show the active layer or folder with its current opacity, on the tiles it changes. Returns false when that can't be
  // done this way, and the tiles must be put together again instead
  function showOpacityLive(layer: Layer) {
    // The tiles start from "below", which only has what is under the active layer, and layers clipped to a folder it
    // is in change with its opacity in a way the mix can't show (see canShowLive in composer.ts)
    if (layer !== stack.active || !composer.canShowLive(activeIndex(stack))) return false
    if (liveLayer !== layer) {
      finishLive()
      liveLayer = layer
    }
    followLiveLayer()
    for (const key of onPaper(tilesOf(layer))) {
      if (live.has(key) || startingLive.has(key)) continue
      startingLive.add(key)
      startingOrder = null
    }
    return true
  }

  // The live tiles show the layer's current opacity, or none of it while it is hidden
  function followLiveLayer() {
    liveAmount = liveLayer!.visible ? liveLayer!.opacity : 0
    mixer.setAmount(liveAmount)
    isLiveStale = true
  }

  // What is under the active layer, or under the active folder's block, at a tile: its "below" tile, with the layers
  // between that and the active one put together on it when the active one is in a folder ("made", a texture of the
  // caller's from then on)
  function underActive(column: number, row: number, key: string) {
    if (staleBelow.delete(key)) composeBelowTile(column, row)
    const start = blockStart(stack, activeIndex(stack))
    const split = splitIndex(stack)
    if (start === split) return { texture: below.get(key)!, made: null }
    const made = takeTexture(tileSize(grid, column, row))
    belowSprite.texture = below.get(key)!
    composeLayers(belowSprite, split, start, column, row, made)
    return { texture: made, made }
  }

  // The layers above the active one at a tile, put together on their own into a texture of the caller's, or null when
  // none of them has paint there
  function aboveActive(column: number, row: number, key: string) {
    const first = activeIndex(stack) + 1
    if (!stack.layers.slice(first).some(other => isShown(other) && hasPaint(other, key))) return null
    const above = takeTexture(tileSize(grid, column, row))
    composeLayers(emptyBase, first, stack.layers.length, column, row, above)
    return above
  }
  const emptyBase = new Container() // the layers above are put together over nothing (transparent)

  // Get a live tile ready, out of sight until the others are ready too (see showStartedLive)
  function startLive(key: string) {
    const { column, row } = parseTileKey(key)
    if (staleBelow.delete(key)) composeBelowTile(column, row)
    belowSprite.texture = below.get(key)!
    const picture = composer.live(activeIndex(stack), column, row, belowSprite, splitIndex(stack), paintOf)
    gpu.trim()
    if (!picture) return // the layer changes nothing here
    // The graphics card does the steps on the screen, unless they are too many: then the tile is put together for each
    // new opacity (see updateLive)
    const { width, height } = tileSize(grid, column, row)
    let shown: RenderTexture | null = null
    let mesh = mixer.show(picture.zero, picture.one, picture.steps, width, height)
    if (!mesh) {
      shown = takeTexture({ width: TILE_SIZE, height: TILE_SIZE })
      composer.showLive(picture, liveAmount, shown)
      mesh = mixer.show(shown, shown, [], width, height)!
    }
    mesh.position.set(column * TILE_SIZE, row * TILE_SIZE)
    mesh.visible = false
    liveContainer.addChild(mesh)
    const tile = { mesh, picture, shown }
    for (const texture of texturesShown(tile)) applyScaleMode(texture)
    live.set(key, tile)
    startedLive.push(key)
  }

  // The textures a live tile shows
  const texturesShown = (tile: LiveTile) => (tile.shown ? [tile.shown] : composer.texturesOf(tile.picture))

  // Put the tiles with steps left together again for the current opacity
  function updateLive() {
    if (!isLiveStale) return
    isLiveStale = false
    for (const tile of live.values()) if (tile.shown) composer.showLive(tile.picture, liveAmount, tile.shown)
  }

  // Once every live tile is ready, show them all at once instead of their projection tiles
  function showStartedLive() {
    if (startingLive.size > 0) return
    for (const key of startedLive) {
      const tile = live.get(key)
      if (!tile) continue // put together again in the meantime
      tile.mesh.visible = true
      tileSprites.get(key)!.visible = false
    }
    startedLive.length = 0
  }

  // Show the projection tile again instead of the live one
  function stopLive(key: string) {
    const tile = live.get(key)
    if (!tile) return
    mixer.remove(tile.mesh)
    // Freed later, a few every frame (see composeWaiting)
    spareTextures.push(...composer.texturesOf(tile.picture))
    if (tile.shown) spareTextures.push(tile.shown)
    tileSprites.get(key)!.visible = true
    live.delete(key)
    releaseLiveLayerIfDone()
  }

  // Once no tile is shown live or waiting to be, they stop following the layer
  function releaseLiveLayerIfDone() {
    if (live.size === 0 && startingLive.size === 0) liveLayer = null
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
  // opacity. The active layer's own blend mode is shown with the graphics card's closest blending (see closestBlend),
  // and clipped layers (see isClipped in layers.ts) aren't clipped until the move is let go.
  // The pictures of the active layer are its whole tiles, and it can have paint off the paper: they are cut at the
  // paper's edge, and the "ghost", under the paper (see engine.ts), shows them faded where they are off it
  type MoveTile = { sprites: Sprite[]; textures: RenderTexture[] }
  const moveTiles = new Map<string, MoveTile>() // "column,row" -> the tile's pictures
  const moveUnder = new Container() // "below" and what is left of the active layer
  const moved = new Container() // the moved part, at its tiles' places, moved along by the drag
  const moveAbove = new Container() // the layers above
  const moveParts = [moveUnder, moved, moveAbove]
  const moveRoot = new Container() // the three, cut at the paper's edge
  const paperShape = new Graphics().rect(0, 0, grid.width, grid.height).fill(0xffffff)
  moveRoot.addChild(...moveParts, paperShape)
  moveRoot.mask = paperShape
  const ghost = new Container() // what is left of the active layer and what moves, faded
  const ghostLeft = new Container()
  const ghostMoved = new Container() // moved along by the drag, like "moved"
  ghost.addChild(ghostLeft, ghostMoved)
  ghost.alpha = GHOST_ALPHA
  ghost.visible = false
  let movedContent: Container | null = null // shown in place of the moved part's tiles (see setMoveContent)
  let ghostContent: Container | null = null
  for (const part of moveParts) part.visible = false

  // The graphics card's own blending closest to a layer's blend mode, to show a move: Screen and Add give the same
  // picture, and Multiply too over paint that covers fully (like the paper's). The others show as Normal until the
  // move is let go
  const closestBlend = (mode: BlendMode): BLEND_MODES =>
    mode === 'multiply' || mode === 'screen' || mode === 'add' ? mode : 'normal'

  // The tiles on the paper where a layer that shows, above the active one, has paint
  function paintedAbove() {
    const keys = new Set<string>()
    for (const layer of stack.layers.slice(activeIndex(stack) + 1)) {
      if (isShown(layer)) for (const key of onPaper(gpu.tilesWithPaint(layer))) keys.add(key)
    }
    return keys
  }

  // Get a tile ready for showing a move, out of sight until showMove: "lifted" is the part of the active layer's tile
  // that moves (null: none), and "left" what is left of the tile (null: nothing). Both are copies made in textures from
  // moveTexture, and belong to the move from now on. Off the paper, the tile only has what moves, which can be dragged
  // onto it, and both show in the ghost
  function prepareMoveTile(key: string, lifted: RenderTexture | null, left: RenderTexture | null) {
    const { column, row } = parseTileKey(key)
    const layer = stack.active
    const tile: MoveTile = { sprites: [], textures: [] }
    const add = (part: Container, texture: Texture, isActiveLayer: boolean) => {
      const sprite = new Sprite(texture)
      sprite.position.set(column * TILE_SIZE, row * TILE_SIZE)
      if (isActiveLayer) {
        sprite.alpha = layer.opacity
        sprite.blendMode = closestBlend(layer.blendMode)
      }
      part.addChild(sprite)
      tile.sprites.push(sprite)
    }
    let above: RenderTexture | null = null
    if (isOnPaper(grid, column, row)) {
      const under = underActive(column, row, key)
      add(moveUnder, under.texture, false)
      if (under.made) tile.textures.push(under.made)
      if (left) add(moveUnder, left, true)
      above = aboveActive(column, row, key)
      if (above) add(moveAbove, above, false)
    }
    if (lifted) add(moved, lifted, true)
    if (left) add(ghostLeft, left, false)
    if (lifted) add(ghostMoved, lifted, false)
    for (const texture of [left, lifted, above]) if (texture) tile.textures.push(texture)
    moveTiles.set(key, tile)
  }

  // Show the prepared tiles instead of their projection tiles, with the moved part this far from where it was
  function showMove(x: number, y: number) {
    setMoveOffset(x, y)
    for (const key of moveTiles.keys()) {
      const sprite = tileSprites.get(key)
      if (sprite) sprite.visible = false
    }
    for (const part of moveParts) part.visible = true
    ghost.visible = true
    applyMoveScaleMode()
  }

  function setMoveOffset(x: number, y: number) {
    moved.position.set(x, y)
    ghostMoved.position.set(x, y)
  }

  // Show this in place of pictures of the moved part (a smart object being transformed draws itself: see
  // smartObject.ts), and "faded" in the ghost, or nothing
  function setMoveContent(content: Container | null, faded: Container | null = null) {
    if (movedContent) moved.removeChild(movedContent)
    if (ghostContent) ghost.removeChild(ghostContent)
    movedContent = content
    ghostContent = faded
    if (content) moved.addChild(content)
    if (faded) ghost.addChild(faded)
  }

  // Show the projection tiles again. The pictures' textures are freed later, a few every frame
  function endMove() {
    for (const [key, tile] of moveTiles) {
      const shown = tileSprites.get(key)
      if (shown) shown.visible = true
      for (const sprite of tile.sprites) sprite.destroy()
      spareTextures.push(...tile.textures)
    }
    moveTiles.clear()
    setMoveContent(null)
    for (const part of moveParts) part.visible = false
    ghost.visible = false
    setMoveOffset(0, 0)
  }

  function applyMoveScaleMode() {
    for (const part of [...moveParts, ghostLeft, ghostMoved]) {
      for (const child of part.children) if (child instanceof Sprite) applyScaleMode(child.texture)
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
    for (const tile of live.values()) for (const texture of texturesShown(tile)) applyScaleMode(texture)
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
  // A transparent texture for the projection tile, or the "below" tile, at this column and row (cut at the paper's edge)
  function createPaperTexture(column: number, row: number) {
    const texture = RenderTexture.create(tileSize(grid, column, row))
    gpu.clearTexture(texture)
    return texture
  }

  forEachTile(grid, (column, row) => {
    const key = tileKey(column, row)
    below.set(key, createPaperTexture(column, row))
    staleBelow.add(key)
    const texture = createPaperTexture(column, row)
    projection.set(key, texture)
    const sprite = new Sprite(texture)
    sprite.position.set(column * TILE_SIZE, row * TILE_SIZE)
    container.addChild(sprite)
    tileSprites.set(key, sprite)
  })
  container.addChild(liveContainer, moveRoot)
  composeAll()

  function destroy() {
    endMove()
    for (const tile of live.values()) {
      for (const texture of [...composer.texturesOf(tile.picture), tile.shown]) texture?.destroy(true)
    }
    for (const texture of [...prepared.values(), ...spareTextures]) texture.destroy(true)
    for (const texture of [...projection.values(), ...below.values()]) texture.destroy(true)
    container.destroy({ children: true })
    mixer.destroy()
    ghost.destroy({ children: true })
    composer.destroy()
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
    composeClippedTiles,
    composeLater,
    composeFolder: composer.composeFolder,
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
    ghost,
    // A texture for a picture of a layer's whole tile, during a move (it belongs to the move from then on)
    moveTexture: () => takeTexture({ width: TILE_SIZE, height: TILE_SIZE }),
    prepareMoveTile,
    showMove,
    setMoveOffset,
    setMoveContent,
    endMove,
    colorAt,
    setZoom,
    destroy,
  }
}

export type Projection = ReturnType<typeof createProjection>
