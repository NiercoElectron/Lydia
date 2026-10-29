import { Container, Graphics, RenderTexture, Sprite } from 'pixi.js'
import type { BLEND_MODES, GlRenderTarget, GlRenderTargetAdaptor, Texture, WebGLRenderer } from 'pixi.js'
import { createTileMixer, createTileMover, DRAWN, type LayerBlender, type ShownTile } from './blendModes'
import { createComposer, type LivePicture, type MovePicture, type PaintOf } from './composer'
import type { GpuTiles } from './gpuTiles'
import {
  activeIndex,
  blockStart,
  clipBaseIndex,
  isClipped,
  isFolder,
  isInside,
  isShown,
  LOCKED_ALPHA,
  splitIndex,
  type Layer,
  type LayerStack,
} from './layers'
import { forEachTile, isOnPaper, parseTileKey, TILE_SIZE, tileKey, tilesTouching, tileSize, type Grid } from './tiles'

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

// What a transform draws, for the exact way of showing a move (see createSmartView in smartObject.ts): into one tile
// of the paper, and the tiles it covers
export type MoveContent = {
  drawTile: (column: number, row: number, target: RenderTexture) => void
  coveredKeys: () => Set<string>
}

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
  // While a move is let go but still shows (see holdMove), the tiles it changed are put together with at most this many
  // passes of the graphics card a frame (see passes in composer.ts): more would make the screen skip frames, and the move
  // shows the right picture meanwhile, so a few more frames to finish show nothing different
  const HELD_PASSES = 80
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
    updateMove()
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
    const passesBefore = composer.passes()
    for (const key of waitingOrder) {
      if (!waiting.has(key)) continue
      if (performance.now() >= deadline) return
      if (isMoveHeld && composer.passes() - passesBefore >= HELD_PASSES) return
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
  type LiveTile = { screen: ShownTile; picture: LivePicture; shown: RenderTexture | null }
  const live = new Map<string, LiveTile>() // "column,row" -> the tile shown live
  const startingLive = new Set<string>() // tiles waiting to be shown live
  const startedLive: string[] = [] // live tiles ready but not shown yet
  let startingOrder: string[] | null = null // the order to start them in (see cachedFirst)
  let liveLayer: Layer | null = null // the layer or folder the live tiles show
  let liveAmount = 0 // how much of it they show: its opacity, or 0 while it is hidden
  let isLiveStale = false // the tiles with steps left must be put together again for a new opacity
  const mixer = createTileMixer(renderer)
  const liveContainer = new Container() // on top of the projection's sprites
  liveContainer.addChild(mixer.container)

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

  // Get a live tile ready, out of sight until the others are ready too (see showStartedLive)
  function startLive(key: string) {
    const { column, row } = parseTileKey(key)
    if (staleBelow.delete(key)) composeBelowTile(column, row)
    const belowTile = below.get(key)!
    belowSprite.texture = belowTile
    // The "below" tiles stay as they are while tiles show live (see markAllBelowStale): a whole one can be used as it
    // is (see live in composer.ts)
    const { width, height } = tileSize(grid, column, row)
    const whole = width === TILE_SIZE && height === TILE_SIZE ? belowTile : undefined
    const picture = composer.live(activeIndex(stack), column, row, belowSprite, splitIndex(stack), paintOf, whole)
    gpu.trim()
    if (!picture) return // the layer changes nothing here
    // The graphics card does the steps on the screen, unless they are too many: then the tile is put together for each
    // new opacity (see updateLive)
    let shown: RenderTexture | null = null
    let screen = mixer.show(picture.zero, picture.one, picture.steps, column, row, width, height)
    if (!screen) {
      shown = takeTexture({ width: TILE_SIZE, height: TILE_SIZE })
      composer.showLive(picture, liveAmount, shown)
      screen = mixer.show(shown, shown, [], column, row, width, height)!
    }
    const tile = { screen, picture, shown }
    for (const texture of texturesShown(tile)) applyScaleMode(texture)
    live.set(key, tile)
    startedLive.push(key)
  }

  // The textures a live tile shows
  const texturesShown = (tile: LiveTile) =>
    tile.shown ? [tile.shown] : [tile.picture.zero, ...composer.texturesOf(tile.picture)]

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
      tile.screen.visible = true
      tileSprites.get(key)!.visible = false
    }
    startedLive.length = 0
  }

  // Show the projection tile again instead of the live one
  function stopLive(key: string) {
    const tile = live.get(key)
    if (!tile) return
    mixer.remove(tile.screen)
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

  // While the move tool drags a part of the active layer or folder (see move.ts), or a transform changes it (see
  // smartObject.ts), the screen shows it where the pointer has it, in one of two ways (see planMove):
  // - "plain", when the layer is Normal at full opacity, isn't clipped and has nothing clipped to it, is in folders that
  //   change nothing, and the layers above are all Normal. The moved part is then shown on its own, over what is left of
  //   the layer and under the layers above, so each new position costs nothing to show. Tiles where the layer loses
  //   paint, or where layers above have paint, are shown with three pictures instead of their projection tile: the
  //   "below" tile with what is left of the active layer on it, the moved part, and the layers above put together.
  //   Elsewhere the projection tile already has everything under the moved part, and nothing goes over it
  // - "exact", otherwise: a blend mode, an opacity, clipping or a folder with a mode of its own would make that picture
  //   wrong. Each tile the move changes shows as it will be once let go: the layer's paint where it is now, onto a
  //   picture of what is under it, and the steps above it, made once for each tile (see moveProgram in composer.ts).
  //   The graphics card works that out on the screen on every frame, from the pictures of the layer's tiles at their
  //   new place (see createTileMover in blendModes.ts), so a new position costs almost nothing, as a new opacity does
  //   (see "Showing the active layer's opacity live" above). Only the tiles on the screen are shown (see updateMove).
  //   The layer's paint is the layer's, or a folder's layers put together, which then move as one picture. In a folder
  //   letting what is in it pass through, with blend modes in it, each of its layers is drawn where it is now instead,
  //   and put together as they are in the folder: those tiles, and the ones with more steps above them than the
  //   graphics card can do on the screen, are put together again for each new position, a few passes on the graphics
  //   card each (see showExactTile). When layers are clipped to a folder the layer is in, that folder is the one whose
  //   tiles are worked out (see clippedAround in composer.ts).
  // The pictures belong to the move (copies, or the layer's tiles themselves, taken off the graphics card's copies: see
  // prepareLift in engine.ts), so the layer's tiles can change once the move is let go, while it still shows. The
  // pictures of the active layer are its whole tiles, and it can have paint off the paper: they are cut at the paper's
  // edge, and the "ghost", under the paper (see engine.ts), shows them faded where they are off it
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

  // How the move shows: "root" is the position of the layer or folder whose tiles are worked out, and "asOne" whether
  // its paint moves as one picture (else each layer in it is drawn where it is now)
  type MovePlan = { isExact: boolean; root: number; asOne: boolean }
  let plan: MovePlan = { isExact: false, root: -1, asOne: true }

  // The exact way's tiles: shown in place of the projection tiles, cut at the paper's edge like them. "state" is the
  // moveState they were put together for
  type ExactTile = { sprite: Sprite; texture: RenderTexture; state: number }
  const exactTiles = new Map<string, ExactTile>()
  const exactContainer = new Container()
  // The exact way's tiles worked out on the screen (see showMovingTile): "drawn" is what a transform draws there,
  // "copy" a copy of what stays of the layer there, and "shift" where the pictures that move start, as "column,row" of
  // tiles, for the pictures it reads
  type MovingTile = {
    screen: ShownTile
    drawn: RenderTexture | null
    copy: RenderTexture | null
    shift: string
    state: number
  }
  const movingTiles = new Map<string, MovingTile>()
  const onlyExact = new Set<string>() // tiles with more steps than the graphics card can do on the screen
  const shownMoveTiles = new Set<string>() // the tiles shown in place of their projection tiles, either way
  const mover = createTileMover(renderer)
  exactContainer.addChild(mover.container)
  const programs = new Map<string, MovePicture | null>() // "column,row" -> what the tile needs (see moveProgram)
  // For each layer drawn where it is now, its pictures at its tiles: what moves ("lifted") and what stays ("left"), and
  // whether the tile loses paint ("isLifted": all of it may move, with no picture when a transform draws it)
  type TilePictures = { lifted: RenderTexture | null; left: RenderTexture | null; isLifted: boolean }
  const movePictures = new Map<Layer, Map<string, TilePictures>>()
  const folderPictures = new Map<string, RenderTexture>() // a folder's layers put together where nothing of it moves
  const moveScratch: RenderTexture[] = [] // whole tiles for drawing the layers where they are now, reused
  let moveState = 0 // goes up whenever what the move shows changes
  let lastShown = '' // the move's state and the tiles on the screen when they were last put together (see updateMove)
  let lastTiles = '' // the tiles on the screen, and the tiles the pictures that move are on, at the same time
  let isMoveShown = false
  let isMoveHeld = false // let go: the layers change now, and the tiles stay as they are until the move ends
  const moveOffset = { x: 0, y: 0 }
  // What a transform draws (see createSmartView in smartObject.ts), and whether it goes into a new layer above
  // (a selected part, or an image placed) instead of the layer itself
  let drawnContent: MoveContent | null = null
  let isContentAbove = false

  // Whether a layer or folder shows in the plain way: Normal, or a folder that lets what is in it pass through
  const isPlain = (layer: Layer) =>
    !isShown(layer) || layer.blendMode === 'normal' || layer.blendMode === 'pass-through'

  // Whether a folder's layers, put together, can move as one picture: always for a folder with a mode of its own (they
  // are put together on their own, from nothing); for one letting what is in it pass through, when they are all Normal
  function movesAsOne(folder: Layer) {
    if (folder.blendMode !== 'pass-through') return true
    const index = stack.layers.indexOf(folder)
    return stack.layers.slice(blockStart(stack, index), index).every(isPlain)
  }

  // Choose how the move of the active layer or folder shows (see above), before its tiles are prepared
  function planMove() {
    const index = activeIndex(stack)
    const item = stack.active
    const around = composer.clippedAround(index)
    if (around !== null) plan = { isExact: true, root: around, asOne: false }
    else if (isFolder(item) && !movesAsOne(item)) plan = { isExact: true, root: index, asOne: false }
    else {
      let inPlainFolders = true
      for (let folder = item.parent; folder; folder = folder.parent) {
        const at = stack.layers.indexOf(folder)
        if (folder.blendMode !== 'pass-through' || folder.opacity < 1 || isClipped(stack, at)) inPlainFolders = false
      }
      const hasClipped = stack.layers.some(
        (other, at) => at > index && isShown(other) && isClipped(stack, at) && clipBaseIndex(stack, at) === index,
      )
      const plain =
        item.opacity === 1 &&
        isPlain(item) &&
        !isClipped(stack, index) &&
        !hasClipped &&
        inPlainFolders &&
        stack.layers.slice(index + 1).every(isPlain)
      plan = { isExact: !plain, root: index, asOne: true }
    }
    return { isExact: plan.isExact, asOne: plan.asOne }
  }

  // Whether a layer has paint at this tile, in RAM or still only on the graphics card
  function hasPaint(layer: Layer, key: string) {
    return layer.tiles.has(key) || gpu.getCached(layer, key)?.dirty === true
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

  // The tiles on the paper where a layer that shows, above the active one, has paint
  function paintedAbove() {
    const keys = new Set<string>()
    for (const layer of stack.layers.slice(activeIndex(stack) + 1)) {
      if (isShown(layer)) for (const key of onPaper(gpu.tilesWithPaint(layer))) keys.add(key)
    }
    return keys
  }

  // Get a tile ready for showing a move, out of sight until showMove: "lifted" is the part of the layer's tile that
  // moves (null: none), and "left" what is left of the tile (null: nothing). Both belong to the move from now on:
  // copies made in textures from moveTexture, or the layer's own (see prepareLift in engine.ts). "isLifted": the tile
  // loses paint. "layer" is the active layer or folder, or a layer in it when its layers are drawn one by one (see
  // planMove). Off the paper, the tile only has what moves, which can be dragged onto it, and both show in the ghost
  function prepareMoveTile(
    key: string,
    lifted: RenderTexture | null,
    left: RenderTexture | null,
    isLifted: boolean,
    layer: Layer = stack.active,
  ) {
    const { column, row } = parseTileKey(key)
    const tile = moveTiles.get(key) ?? { sprites: [], textures: [] }
    moveTiles.set(key, tile)
    const add = (part: Container, texture: Texture) => {
      const sprite = new Sprite(texture)
      sprite.position.set(column * TILE_SIZE, row * TILE_SIZE)
      part.addChild(sprite)
      tile.sprites.push(sprite)
    }
    if (left) add(ghostLeft, left)
    if (lifted) add(ghostMoved, lifted)
    for (const texture of [left, lifted]) if (texture) tile.textures.push(texture)
    if (plan.isExact) {
      let pictures = movePictures.get(layer)
      if (!pictures) movePictures.set(layer, (pictures = new Map()))
      pictures.set(key, { lifted, left, isLifted })
      movedPlaces = null
      // Made now, a few tiles every frame, rather than all at once when the move starts showing
      if (isOnPaper(grid, column, row)) {
        const program = programFor(key)
        if (program) movingTileFor(key, program)
      }
      return
    }
    if (!isOnPaper(grid, column, row)) {
      if (lifted) add(moved, lifted)
      return
    }
    const under = underActive(column, row, key)
    add(moveUnder, under.texture)
    if (under.made) tile.textures.push(under.made)
    if (left) add(moveUnder, left)
    const above = aboveActive(column, row, key)
    if (above) {
      add(moveAbove, above)
      tile.textures.push(above)
    }
    if (lifted) add(moved, lifted)
  }

  // Show the prepared tiles instead of their projection tiles, with the moved part this far from where it was
  function showMove(x: number, y: number) {
    setMoveOffset(x, y)
    ghost.visible = true
    isMoveShown = true
    if (plan.isExact) {
      updateMove()
      return
    }
    for (const key of moveTiles.keys()) {
      const sprite = tileSprites.get(key)
      if (sprite) sprite.visible = false
    }
    for (const part of moveParts) part.visible = true
    applyMoveScaleMode()
  }

  function setMoveOffset(x: number, y: number) {
    moved.position.set(x, y)
    ghostMoved.position.set(x, y)
    moveOffset.x = x
    moveOffset.y = y
    moveState++
  }

  // What a transform shows changed (its corners, or how smooth it is)
  function moveChanged() {
    moveState++
  }

  // The move was let go: its tiles stay as they are, while the layers change under them (see endLift in engine.ts)
  function holdMove() {
    isMoveHeld = true
  }

  // Show this in place of pictures of the moved part (a smart object being transformed draws itself: see
  // smartObject.ts), and "faded" in the ghost, or nothing. In the exact way, "drawn" draws it into a tile, and "above"
  // says it goes into a new layer above the active one
  function setMoveContent(
    content: Container | null,
    faded: Container | null = null,
    drawn: MoveContent | null = null,
    above = false,
  ) {
    if (movedContent) moved.removeChild(movedContent)
    if (ghostContent) ghost.removeChild(ghostContent)
    movedContent = content
    ghostContent = faded
    drawnContent = drawn
    isContentAbove = above
    if (content) moved.addChild(content)
    if (faded) ghost.addChild(faded)
    moveState++
  }

  // What the exact way needs for a tile (see moveProgram in composer.ts), made the first time
  function programFor(key: string) {
    if (programs.has(key)) return programs.get(key)!
    const { column, row } = parseTileKey(key)
    if (staleBelow.delete(key)) composeBelowTile(column, row)
    const belowTile = below.get(key)!
    belowSprite.texture = belowTile
    // The "below" tiles stay as they are until the move ends: a whole one can be used as it is (see moveProgram)
    const { width, height } = tileSize(grid, column, row)
    const whole = width === TILE_SIZE && height === TILE_SIZE ? belowTile : undefined
    const program = composer.moveProgram(plan.root, column, row, belowSprite, splitIndex(stack), paintOf, whole)
    gpu.trim()
    programs.set(key, program)
    return program
  }

  // The tiles on the paper the move changes now: where a layer loses paint, where its moved part is, and what a
  // transform covers
  // Among the tiles on the paper between these columns and rows (the screen's), those the move changes now: where a
  // layer loses paint, where its moved part is, and what a transform covers
  function changedTiles(firstColumn: number, lastColumn: number, firstRow: number, lastRow: number) {
    const keys = new Set<string>()
    const add = (column: number, row: number) => {
      if (column < Math.max(firstColumn, 0) || column > Math.min(lastColumn, grid.columns - 1)) return
      if (row < Math.max(firstRow, 0) || row > Math.min(lastRow, grid.rows - 1)) return
      keys.add(tileKey(column, row))
    }
    movedPlaces ??= placesOfMove()
    for (const { column, row } of movedPlaces.lost) add(column, row)
    // A moved picture covers one or two columns, and one or two rows, of the tiles
    const columns = [Math.floor(moveOffset.x / TILE_SIZE)]
    if (moveOffset.x % TILE_SIZE !== 0) columns.push(columns[0] + 1)
    const rows = [Math.floor(moveOffset.y / TILE_SIZE)]
    if (moveOffset.y % TILE_SIZE !== 0) rows.push(rows[0] + 1)
    for (const { column, row } of movedPlaces.lifted) {
      for (const shiftColumn of columns) for (const shiftRow of rows) add(column + shiftColumn, row + shiftRow)
    }
    if (drawnContent) {
      for (const key of drawnContent.coveredKeys()) {
        const { column, row } = parseTileKey(key)
        add(column, row)
      }
    }
    return keys
  }

  // Where the layers that move lose paint, and where their moved pictures start from: the same for the whole move,
  // so worked out once (null: to be worked out again, after more tiles are prepared)
  let movedPlaces: { lost: { column: number; row: number }[]; lifted: { column: number; row: number }[] } | null = null
  function placesOfMove() {
    const lost: { column: number; row: number }[] = []
    const lifted: { column: number; row: number }[] = []
    for (const pictures of movePictures.values()) {
      for (const [key, picture] of pictures) {
        if (picture.isLifted) lost.push(parseTileKey(key))
        if (picture.lifted) lifted.push(parseTileKey(key))
      }
    }
    return { lost, lifted }
  }

  // The columns and rows of the tiles on the screen now
  function tilesOnScreen() {
    const { width, height } = renderer.screen
    const corners = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: 0, y: height },
      { x: width, y: height },
    ].map(point => container.toLocal(point))
    const xs = corners.map(p => p.x)
    const ys = corners.map(p => p.y)
    return tilesTouching(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))
  }

  // Put together, for where the move is now, the tiles it changes that are on the screen (in the exact way), each once
  // for each new position. The others show their projection tiles, being out of sight or unchanged. Every frame
  function updateMove() {
    if (!isMoveShown || !plan.isExact || isMoveHeld) return
    const { firstColumn, lastColumn, firstRow, lastRow } = tilesOnScreen()
    // Nothing to do while neither the move nor the screen changes
    const shownNow = `${moveState} ${firstColumn} ${lastColumn} ${firstRow} ${lastRow}`
    if (shownNow === lastShown) return
    lastShown = shownNow
    // The pictures that move start one or two tiles from where they were (see createTileMover)
    const shift = { column: Math.floor(moveOffset.x / TILE_SIZE), row: Math.floor(moveOffset.y / TILE_SIZE) }
    mover.setShift(moveOffset.x - shift.column * TILE_SIZE, moveOffset.y - shift.row * TILE_SIZE)
    const item = stack.layers[plan.root]
    mover.setItem(item.blendMode, item.opacity, drawnAs())
    // While the pictures that move stay on the same tiles, the same tiles show, reading the same pictures: when the
    // graphics card works them all out on the screen, there is nothing more to do
    const onTiles = [shift.column, shift.row, moveOffset.x % TILE_SIZE === 0, moveOffset.y % TILE_SIZE === 0]
    const tilesNow = `${onTiles.join(' ')} ${firstColumn} ${lastColumn} ${firstRow} ${lastRow}`
    const isOnScreenOnly = plan.asOne && !drawnContent && onlyExact.size === 0
    if (isOnScreenOnly && tilesNow === lastTiles) return
    lastTiles = tilesNow
    const wanted = changedTiles(firstColumn, lastColumn, firstRow, lastRow)
    for (const key of shownMoveTiles) if (!wanted.has(key)) hideMoveTile(key)
    for (const key of wanted) {
      const program = programFor(key)
      if (!program) continue // nothing of the layer shows here: the projection tile is right
      if (!showMovingTile(key, program, shift)) showExactTile(key, program)
    }
  }

  // How what a transform draws goes in (see DRAWN in blendModes.ts)
  function drawnAs() {
    if (!drawnContent) return DRAWN.none
    if (!isContentAbove) return DRAWN.inLayer
    const clip = composer.clipAbove(plan.root)
    return clip === 'layer' ? DRAWN.aboveClippedToLayer : clip === 'base' ? DRAWN.aboveClippedToBase : DRAWN.above
  }

  // Show the projection tile again in place of the move's
  function hideMoveTile(key: string) {
    const exact = exactTiles.get(key)
    if (exact) exact.sprite.visible = false
    const moving = movingTiles.get(key)
    if (moving) moving.screen.visible = false
    tileSprites.get(key)!.visible = true
    shownMoveTiles.delete(key)
  }

  // The tile worked out on the screen for a tile of the paper (see showMovingTile), made the first time, out of sight.
  // Null when it can't be: the layers of a folder are drawn one by one, or the steps are too many
  function movingTileFor(key: string, program: MovePicture) {
    const known = movingTiles.get(key)
    if (known || !plan.asOne || onlyExact.has(key)) return known ?? null
    const { column, row } = parseTileKey(key)
    const { width, height } = tileSize(grid, column, row)
    const screen = mover.show(program, column, row, width, height)
    if (!screen) {
      onlyExact.add(key)
      return null
    }
    // What the layer has at a tile with no pictures (one the move only reaches) is copied too: its tiles change once
    // the move is let go, while the move still shows (see holdMove)
    const root = stack.layers[plan.root]
    const stays = movePictures.get(root)?.has(key) || isFolder(root) ? null : gpu.getTexture(root, column, row, false)
    let copy: RenderTexture | null = null
    if (stays) {
      copy = takeTexture({ width: TILE_SIZE, height: TILE_SIZE })
      gpu.copyInto(stays, copy)
    }
    const tile: MovingTile = { screen, drawn: null, copy, shift: '', state: -1 }
    movingTiles.set(key, tile)
    for (const texture of [program.under, ...composer.texturesOfMove(program), copy]) {
      if (texture) applyScaleMode(texture)
    }
    return tile
  }

  // Show a tile the move changes worked out by the graphics card on the screen, on every frame, from the pictures of
  // the layer's tiles at their new place (see createTileMover in blendModes.ts). False when it can't be (see
  // movingTileFor)
  function showMovingTile(key: string, program: MovePicture, shift: { column: number; row: number }) {
    const tile = movingTileFor(key, program)
    if (!tile) return false
    const { column, row } = parseTileKey(key)
    if (drawnContent && !tile.drawn) {
      tile.drawn = takeTexture({ width: TILE_SIZE, height: TILE_SIZE })
      applyScaleMode(tile.drawn)
      tile.shift = '' // the program reads it from now on
    }
    const shiftKey = `${shift.column},${shift.row}`
    if (tile.shift !== shiftKey) {
      tile.shift = shiftKey
      const root = stack.layers[plan.root]
      const pictures = movePictures.get(root)
      const here = pictures?.get(key)
      // What stays of the layer: the picture made of it here, if any (see prepareMoveTile)
      const stays = here ? here.left : isFolder(root) ? staysAt(root, column, row) : tile.copy
      const moved = [0, 1, 2, 3].map(i => {
        const from = tileKey(column - shift.column - 1 + (i % 2), row - shift.row - 1 + Math.floor(i / 2))
        return pictures?.get(from)?.lifted ?? null
      })
      mover.setPaint(tile.screen, stays, moved, tile.drawn)
      for (const texture of [stays, ...moved]) if (texture) applyScaleMode(texture)
    }
    if (tile.drawn && tile.state !== moveState) drawnContent?.drawTile(column, row, tile.drawn)
    tile.state = moveState
    tile.screen.visible = true
    tileSprites.get(key)!.visible = false
    shownMoveTiles.add(key)
    return true
  }

  // Put a tile the move changes together again for where it is now
  function showExactTile(key: string, program: MovePicture) {
    const { column, row } = parseTileKey(key)
    let tile = exactTiles.get(key)
    if (tile?.sprite.visible && tile.state === moveState) return
    if (!tile) {
      const texture = takeTexture(tileSize(grid, column, row))
      const sprite = new Sprite(texture)
      sprite.position.set(column * TILE_SIZE, row * TILE_SIZE)
      exactContainer.addChild(sprite)
      tile = { sprite, texture, state: -1 }
      exactTiles.set(key, tile)
      applyScaleMode(texture)
    }
    const used: RenderTexture[] = []
    const drawnAt = new Map<Layer, RenderTexture>()
    const paintNow: PaintOf = (layer, c, r) => {
      if (!movePictures.has(layer)) return gpu.getTexture(layer, c, r, false)
      let paint = drawnAt.get(layer)
      if (!paint) {
        paint = layerWhereItIs(layer, c, r, used)
        drawnAt.set(layer, paint)
      }
      return paint
    }
    const root = stack.layers[plan.root]
    if (!plan.asOne) composer.showMoved(program, plan.root, column, row, paintNow, tile.texture)
    else {
      const paint = layerWhereItIs(root, column, row, used)
      const content = isContentAbove && drawnContent ? scratchTile(used) : undefined
      if (content) drawnContent!.drawTile(column, row, content)
      composer.showMoved(program, plan.root, column, row, paintNow, tile.texture, paint, content)
    }
    moveScratch.push(...used)
    tile.state = moveState
    tile.sprite.visible = true
    tileSprites.get(key)!.visible = false
    shownMoveTiles.add(key)
  }

  const drawRoot = new Container() // a layer drawn where it is now, at one tile
  const drawSprites: Sprite[] = []

  function scratchTile(used: RenderTexture[]) {
    const tile = moveScratch.pop() ?? RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE })
    used.push(tile)
    return tile
  }

  // A layer's paint at a tile with its moved part where it is now, in a whole tile from "used": what stays there (the
  // part left, or all of its paint there when none of it moves), the moved pictures that reach it, and what a
  // transform draws there. For a folder moving as one picture, its layers put together
  function layerWhereItIs(layer: Layer, column: number, row: number, used: RenderTexture[]) {
    const key = tileKey(column, row)
    const pictures = movePictures.get(layer) ?? new Map<string, TilePictures>()
    const textures: { texture: Texture; x: number; y: number }[] = []
    const here = pictures.get(key)
    const stays = here?.isLifted ? here.left : staysAt(layer, column, row)
    if (stays) textures.push({ texture: stays, x: 0, y: 0 })
    const { firstColumn, lastColumn, firstRow, lastRow } = tilesTouching(
      column * TILE_SIZE - moveOffset.x,
      row * TILE_SIZE - moveOffset.y,
      (column + 1) * TILE_SIZE - moveOffset.x,
      (row + 1) * TILE_SIZE - moveOffset.y,
    )
    for (let c = firstColumn; c <= lastColumn; c++) {
      for (let r = firstRow; r <= lastRow; r++) {
        const lifted = pictures.get(tileKey(c, r))?.lifted
        if (lifted) {
          textures.push({
            texture: lifted,
            x: (c - column) * TILE_SIZE + moveOffset.x,
            y: (r - row) * TILE_SIZE + moveOffset.y,
          })
        }
      }
    }
    if (drawnContent && !isContentAbove && layer === stack.active) {
      const drawn = scratchTile(used)
      drawnContent.drawTile(column, row, drawn)
      textures.push({ texture: drawn, x: 0, y: 0 })
    }
    drawRoot.removeChildren()
    for (const [i, { texture, x, y }] of textures.entries()) {
      drawSprites[i] ??= new Sprite()
      drawSprites[i].texture = texture
      drawSprites[i].position.set(x, y)
      drawRoot.addChild(drawSprites[i])
    }
    const target = scratchTile(used)
    renderer.render({ container: drawRoot, target, clear: true, clearColor: [0, 0, 0, 0] })
    return target
  }

  // A layer's paint at a tile where none of it moves: its own, or for a folder, its layers put together (made once)
  function staysAt(layer: Layer, column: number, row: number) {
    if (!isFolder(layer)) return gpu.getTexture(layer, column, row, false)
    const key = tileKey(column, row)
    let tile = folderPictures.get(key)
    if (!tile) {
      tile = RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE })
      composer.composeFolder(layer, column, row, tile)
      folderPictures.set(key, tile)
    }
    return tile
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
    for (const key of shownMoveTiles) tileSprites.get(key)!.visible = true
    shownMoveTiles.clear()
    for (const { sprite, texture } of exactTiles.values()) {
      sprite.destroy()
      spareTextures.push(texture)
    }
    exactTiles.clear()
    for (const { screen, drawn, copy } of movingTiles.values()) {
      mover.remove(screen)
      for (const texture of [drawn, copy]) if (texture) spareTextures.push(texture)
    }
    movingTiles.clear()
    onlyExact.clear()
    for (const program of programs.values()) if (program) spareTextures.push(...composer.texturesOfMove(program))
    programs.clear()
    movePictures.clear()
    spareTextures.push(...folderPictures.values(), ...moveScratch)
    folderPictures.clear()
    moveScratch.length = 0
    setMoveContent(null)
    for (const part of moveParts) part.visible = false
    ghost.visible = false
    setMoveOffset(0, 0)
    isMoveShown = false
    isMoveHeld = false
    plan = { isExact: false, root: -1, asOne: true }
    movedPlaces = null
    lastShown = ''
    lastTiles = ''
  }

  function applyMoveScaleMode() {
    for (const part of [...moveParts, ghostLeft, ghostMoved]) {
      for (const child of part.children) if (child instanceof Sprite) applyScaleMode(child.texture)
    }
    for (const { texture } of exactTiles.values()) applyScaleMode(texture)
    // What the tiles worked out on the screen read (the pictures that move are in the ghost too)
    for (const program of programs.values()) {
      if (program) for (const texture of [program.under, ...composer.texturesOfMove(program)]) applyScaleMode(texture)
    }
    for (const { drawn, copy } of movingTiles.values())
      for (const texture of [drawn, copy]) if (texture) applyScaleMode(texture)
    for (const texture of folderPictures.values()) applyScaleMode(texture)
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

  // The visible layers put together at this tile, without the paper, as the fill bucket's "All layers" sees them when
  // they have blend modes, clipping or folders that change something (see allLayersReference in engine.ts): each pixel
  // of the tile's part on the paper as one number (red, green, blue and alpha, the color multiplied by the alpha, as in
  // RAM), or one number for all of them when they are all the same. They are put together on the graphics card like a
  // projection tile, and read back from it, which makes the processor wait for it. "isOneColor": every layer is a
  // single color there (or has nothing), so all of it is too, whatever the blend modes, and one pixel is read
  let readTile: RenderTexture | null = null
  function readLayers(column: number, row: number, isOneColor: boolean) {
    readTile ??= RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE })
    composeLayers(emptyBase, 0, stack.layers.length, column, row, readTile)
    const { width, height } = isOneColor ? { width: 1, height: 1 } : tileSize(grid, column, row)
    const pixels = new Uint8Array(width * height * 4)
    const renderTarget = renderer.renderTarget.getRenderTarget(readTile)
    const glRenderTarget = renderer.renderTarget.getGpuRenderTarget(renderTarget) as GlRenderTarget
    ;(renderer.renderTarget.adaptor as GlRenderTargetAdaptor).bindFramebuffer(glRenderTarget.resolveTargetFramebuffer)
    const gl = renderer.gl
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    const colors = new Uint32Array(pixels.buffer)
    return colors.every(color => color === colors[0]) ? colors[0] : colors
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
  container.addChild(liveContainer, exactContainer, moveRoot)
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
    mover.destroy()
    ghost.destroy({ children: true })
    composer.destroy()
    withStrokeRoot.destroy({ children: true })
    withStrokeTexture?.destroy(true)
    readTile?.destroy(true)
    paperTile.destroy()
    emptyBase.destroy()
    drawRoot.destroy()
    for (const sprite of drawSprites) sprite.destroy()
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
    // How many tiles wait to be put together again (see composeLayerTiles)
    waitingCount: () => waiting.size,
    // How many tiles show live now (see showOpacityLive), for the tests of the app
    liveShown: () => [...live.values()].filter(tile => tile.screen.visible).length,
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
    planMove,
    prepareMoveTile,
    showMove,
    setMoveOffset,
    setMoveContent,
    moveChanged,
    holdMove,
    endMove,
    colorAt,
    readLayers,
    setZoom,
    destroy,
  }
}

export type Projection = ReturnType<typeof createProjection>
