import { Application, CanvasSource, Container, Texture, TilingSprite } from 'pixi.js'
import type { WebGLRenderer } from 'pixi.js'
import softRound from '../brushes/soft-round.lydbrush?raw'
import { createBrush, type BrushSettings } from './brush'
import { parseBrushFile, type BrushShape } from './brushFile'
import { decodeTip, type BrushTip } from './brushTip'
import { createGpuTiles } from './gpuTiles'
import { createHistory, propsOf, type LayerProps } from './history'
import { activeIndex, createLayer, type Layer, type LayerStack } from './layers'
import { createTileMemory, type StoredTile } from './memory'
import { createProjection } from './projection'
import { serializeProject, type LayerToSave, type ProjectData } from './projectFile'
import { withResolution } from './resolution'
import { createGrid, parseTileKey, TILE_SIZE, tilesInGigabytes } from './tiles'
import { createView } from './view'

// What the screen needs to know about the drawing. A new object every time something changes, so React can tell
export type EngineSnapshot = {
  layers: { id: number; name: string; visible: boolean; opacity: number }[] // from the bottom to the top
  activeLayerId: number
  canUndo: boolean
  canRedo: boolean
  isModified: boolean // changed since it was opened or last saved
  isUpdating: boolean // putting the picture together again after a layer change (see composeLayerTiles)
}

// Browsers only tell roughly how much RAM the computer has (Chrome says at most 8 GB, others say nothing), so the
// budget for uncompressed tiles is a quarter of that guess
const ramGigabytes = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
const RAW_BUDGET = Math.max(0.5, ramGigabytes / 4) * 1024 ** 3

// PNG keeps every pixel exactly, and the transparency of a transparent background; JPEG makes much smaller files by
// leaving out details the eye hardly notices, and has no transparency (a transparent background becomes white)
export type ImageType = 'png' | 'jpeg'
const JPEG_QUALITY = 0.95 // from 0 to 1; PNG ignores it

// Under a transparent background, the screen shows gray and white squares, like Photoshop and Krita, of this many
// pixels of the screen at any zoom
const CHECKER_SIZE = 8

function createCheckers() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = CHECKER_SIZE * 2
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#cccccc'
  ctx.fillRect(0, 0, CHECKER_SIZE, CHECKER_SIZE)
  ctx.fillRect(CHECKER_SIZE, CHECKER_SIZE, CHECKER_SIZE, CHECKER_SIZE)
  const source = new CanvasSource({ resource: canvas, resolution: 1, scaleMode: 'nearest' })
  return new TilingSprite({ texture: new Texture({ source }) })
}

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

// The drawing engine: shows the drawing inside "host" and lets the user paint on it. Everything that touches the
// graphics card lives here; React only shows the controls around it. "gpuMemory": how many GB of the graphics card's
// memory to use for keeping layers ready (see settings.ts)
export async function createEngine(host: HTMLElement, project: ProjectData, gpuMemory: number) {
  const app = new Application()
  await app.init({
    resizeTo: host,
    background: '#808080',
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    preference: 'webgl',
  })
  const renderer = app.renderer as WebGLRenderer
  if (!(renderer.gl instanceof WebGL2RenderingContext)) {
    app.destroy(true)
    throw new Error('Lydia needs WebGL 2, which this browser or graphics card does not support.')
  }
  app.canvas.style.display = 'block'
  app.canvas.style.touchAction = 'none' // the pen and the fingers paint instead of scrolling the page
  app.canvas.style.cursor = 'crosshair'
  host.appendChild(app.canvas)
  // PixiJS only follows the size of the window; follow the host's own size too (when panels around it change)
  const resizeObserver = new ResizeObserver(() => app.resize())
  resizeObserver.observe(host)

  // ----- The drawing -----

  const grid = createGrid(project.width, project.height)
  const layers =
    project.layers.length > 0
      ? project.layers.map(data => ({ ...createLayer(data.name, data.tiles), ...data, tiles: data.tiles }))
      : [createLayer('Layer 1')]
  const stack: LayerStack = { layers, active: layers[project.activeLayer] ?? layers[layers.length - 1] }
  let layersCreated = layers.length // for naming new layers

  const memory = createTileMemory(RAW_BUDGET)
  const gpu = createGpuTiles(renderer, grid, memory, tilesInGigabytes(gpuMemory))
  const projection = createProjection(renderer, grid, stack, gpu, project.background)
  const history = createHistory(stack, gpu, projection)
  // The brush starts as the Soft round brush, until the screen chooses one
  const startBrush = parseBrushFile(softRound, 'Soft round')
  const brush = createBrush(
    renderer,
    grid,
    stack,
    gpu,
    projection,
    history,
    await decodeTip(startBrush.tip),
    startBrush,
  )

  const world = new Container() // everything that belongs to the drawing; zoom and pan move this container
  world.addChild(projection.container)
  // The squares under a transparent background keep their size on the screen, so instead of zooming with the
  // drawing they follow where the paper is on the screen, every frame
  const checkers = project.background === null ? createCheckers() : null
  const followPaper = () => {
    if (!checkers) return
    checkers.position.copyFrom(world.position)
    checkers.width = grid.width * world.scale.x
    checkers.height = grid.height * world.scale.y
  }
  if (checkers) app.stage.addChild(checkers)
  app.stage.addChild(world)
  app.ticker.add(followPaper)
  const view = createView(app, world, grid, brush, projection, gpu, () => changed())

  // ----- Telling React about changes -----

  const listeners = new Set<() => void>()
  let isModified = false
  let snapshot = makeSnapshot()

  function makeSnapshot(): EngineSnapshot {
    return {
      layers: stack.layers.map(({ id, name, visible, opacity }) => ({ id, name, visible, opacity })),
      activeLayerId: stack.active.id,
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
      isModified,
      isUpdating: projection.isUpdating(),
    }
  }

  // Something changed: make a new snapshot and tell whoever is listening. "modified" = the drawing itself changed
  function changed(modified = true) {
    if (modified) isModified = true
    snapshot = makeSnapshot()
    for (const listener of listeners) listener()
  }

  // ----- Work done in the background, every frame -----

  // Tiles waiting after a layer change are put together a few every frame (a frame lasts 7 ms at 144 Hz). Painted
  // tiles are read back into RAM without waiting, a few per frame (fewer while painting, skipping the tiles of the
  // stroke, which will change again in a moment). Once a second, the tiles in RAM are kept within their budget
  let lastBudgetCheck = 0
  function backgroundWork() {
    const isPainting = view.isPainting()
    projection.composeWaiting(isPainting ? 2 : 5)
    if (projection.isUpdating() !== snapshot.isUpdating) changed(false) // show or hide "Updating…"
    if (gpu.hasUnsaved()) {
      gpu.finishReads(isPainting ? 2 : 4)
      gpu.trim() // the tiles saved just now can leave the graphics card, if it is over its budget
      gpu.startSaving(isPainting ? 8 : Infinity, cached => history.isRecording(cached.layer, cached.key))
    }
    const now = performance.now()
    if (!isPainting && now - lastBudgetCheck > 1000) {
      lastBudgetCheck = now
      memory.enforceBudget(storedTiles())
    }
  }
  app.ticker.add(backgroundWork)

  // Every tile in RAM that is still in use, by the layers or by the undo history
  function* storedTiles(): Generator<StoredTile> {
    for (const layer of stack.layers) yield* layer.tiles.values()
    yield* history.storedTiles()
  }

  // ----- Layers -----

  function findLayer(id: number) {
    return stack.layers.find(layer => layer.id === id)
  }

  // A new empty layer above the active one, which becomes the active layer
  function addLayer() {
    if (view.isPainting()) return
    const layer = createLayer(`Layer ${++layersCreated}`)
    history.recordOrder(layer)
    stack.layers.splice(activeIndex(stack) + 1, 0, layer)
    stack.active = layer
    projection.markAllBelowStale() // "below" now has one more layer
    changed()
  }

  // Delete the active layer; the one under it becomes the active layer, like in Photoshop. The last layer can't be
  // deleted
  function deleteLayer() {
    if (view.isPainting() || stack.layers.length === 1) return
    const layer = stack.active
    const index = activeIndex(stack)
    history.recordOrder(layer) // the layer stays in the undo step, with its tiles, so it can come back
    stack.layers.splice(index, 1)
    stack.active = stack.layers[Math.max(0, index - 1)]
    projection.markAllBelowStale() // "below" now has other layers
    if (layer.visible) projection.composeLayerTiles(layer)
    changed()
  }

  // Move a layer to another place in the list. "index" counts from the bottom (0 = the bottom layer)
  function moveLayer(id: number, index: number) {
    const layer = findLayer(id)
    if (!layer || view.isPainting() || index < 0 || index >= stack.layers.length) return
    const from = stack.layers.indexOf(layer)
    if (from === index) return
    history.recordOrder(layer)
    stack.layers.splice(from, 1)
    stack.layers.splice(index, 0, layer)
    projection.markAllBelowStale() // "below" may have other layers now
    if (layer.visible) projection.composeLayerTiles(layer)
    changed()
  }

  function renameLayer(id: number, name: string) {
    const layer = findLayer(id)
    const newName = name.trim()
    if (!layer || !newName || newName === layer.name) return
    history.recordLayer(layer, propsOf(layer))
    layer.name = newName
    changed()
  }

  function selectLayer(id: number) {
    const layer = findLayer(id)
    if (!layer || layer === stack.active || view.isPainting()) return
    stack.active = layer
    projection.markAllBelowStale() // "below" now has different layers
    changed(false) // the drawing itself didn't change
  }

  function setLayerVisible(id: number, visible: boolean) {
    const layer = findLayer(id)
    if (!layer || layer.visible === visible || view.isPainting()) return
    history.recordLayer(layer, propsOf(layer))
    layer.visible = visible
    projection.composeLayerTiles(layer)
    changed()
  }

  // The layer whose opacity the slider is changing, and its values from before, so the whole drag becomes one undo step
  let opacityChange: { layer: Layer; before: LayerProps } | null = null

  // While the opacity slider moves, the active layer shows each new opacity right away (see showOpacityLive in
  // projection.ts); its tiles are put together for good once the slider is let go (finishLayerOpacity)
  function setLayerOpacity(id: number, opacity: number) {
    const layer = findLayer(id)
    if (!layer || layer.opacity === opacity || view.isPainting()) return
    if (opacityChange?.layer !== layer) {
      finishLayerOpacity()
      opacityChange = { layer, before: propsOf(layer) }
    }
    layer.opacity = opacity
    // A hidden layer changes nothing on the screen: it is put together with its new opacity when it is shown again
    if (layer.visible && !projection.showOpacityLive(layer, gpu.tilesWithPaint(layer))) {
      projection.composeLayerTiles(layer)
    }
    changed()
  }

  function finishLayerOpacity() {
    projection.finishLiveLater()
    if (!opacityChange) return
    const { layer, before } = opacityChange
    opacityChange = null
    // Dragged back to where it started: nothing to undo
    if (layer.opacity !== before.opacity) {
      history.recordLayer(layer, before)
      changed()
    }
  }

  // Remove all the paint from the active layer. It can be undone like a stroke
  function clearLayer() {
    if (view.isPainting()) return
    const layer = stack.active
    history.begin(layer)
    for (const key of gpu.tilesWithPaint(layer)) {
      history.backUpTile(key) // before the tile changes: the graphics card works in order
      layer.tiles.delete(key)
      const cached = gpu.getCached(layer, key)
      if (cached) {
        gpu.clearTexture(cached.texture)
        gpu.markClean(cached) // empty on the graphics card and in RAM
      }
      const { column, row } = parseTileKey(key)
      projection.composeTile(column, row)
    }
    if (history.end()) changed()
  }

  // ----- Undo -----

  function undo() {
    if (view.isPainting()) return
    finishLayerOpacity() // an opacity change still on its way (Ctrl+Z while dragging) becomes a step first
    if (!history.canUndo()) return
    history.undo()
    changed()
  }

  function redo() {
    if (view.isPainting()) return
    finishLayerOpacity()
    if (!history.canRedo()) return
    history.redo()
    changed()
  }

  // ----- Files -----

  // The drawing as an image at its full size. The projection already has the paper and all the visible layers put
  // together, so only its tiles need to be copied
  async function exportImage(type: ImageType) {
    await nextFrame() // let the screen show that the export started before the slow part
    // Tiles still shown live, or waiting after a layer change, are not in the projection yet
    projection.finishLive()
    projection.finishWaiting()
    const canvas = document.createElement('canvas')
    canvas.width = grid.width
    canvas.height = grid.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This image is too big for this browser.')
    if (project.background === null && type === 'jpeg') {
      // Where a JPEG would be transparent, browsers make it black
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    const tileCanvas = document.createElement('canvas') // for one tile at a time, on a transparent background
    const tileCtx = tileCanvas.getContext('2d')!
    for (const [key, texture] of projection.tiles) {
      const { column, row } = parseTileKey(key)
      if (project.background !== null) {
        ctx.drawImage(renderer.extract.canvas(texture) as HTMLCanvasElement, column * TILE_SIZE, row * TILE_SIZE)
        continue
      }
      // The graphics card keeps colors already multiplied by their alpha, and an image needs them as they are: copied
      // directly, half see-through red (128, 0, 0, 128) would come out as dark red, and every soft edge would get a
      // dark rim. With a colored paper every pixel is opaque, so nothing changes there
      const { pixels, width, height } = renderer.extract.pixels(texture)
      for (let i = 0; i < pixels.length; i += 4) {
        const alpha = pixels[i + 3]
        if (alpha === 0 || alpha === 255) continue
        pixels[i] = (pixels[i] * 255) / alpha // Uint8ClampedArray rounds and keeps it within 0–255
        pixels[i + 1] = (pixels[i + 1] * 255) / alpha
        pixels[i + 2] = (pixels[i + 2] * 255) / alpha
      }
      tileCanvas.width = width
      tileCanvas.height = height
      tileCtx.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0)
      ctx.drawImage(tileCanvas, column * TILE_SIZE, row * TILE_SIZE) // over white paper for a JPEG
    }
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, `image/${type}`, JPEG_QUALITY))
    if (!blob) throw new Error('This image is too big for this browser.')
    return withResolution(blob, project.dpi)
  }

  // The drawing as the contents of a .lyd file
  async function saveProject() {
    // Every painted tile must be in RAM first
    while (gpu.hasUnsaved()) await nextFrame()
    const layersToSave: LayerToSave[] = await Promise.all(
      stack.layers.map(async ({ name, visible, opacity, blendMode, tiles }) => ({
        name,
        visible,
        opacity,
        blendMode,
        tiles: await Promise.all(
          [...tiles].map(async ([key, tile]) => {
            const { column, row } = parseTileKey(key)
            if (tile.color !== undefined) return { column, row, color: tile.color }
            return { column, row, packed: await memory.pack(tile) }
          }),
        ),
      })),
    )
    const file = serializeProject(project, activeIndex(stack), layersToSave)
    isModified = false
    changed(false)
    return file
  }

  // ----- Brush -----

  function setBrush(settings: Partial<BrushSettings>) {
    Object.assign(brush.settings, settings)
  }

  // Paint with another brush: its tip (see brushTip.ts) and how the tip is placed along the strokes
  function setBrushTip(tip: BrushTip, shape: BrushShape) {
    brush.setTip(tip, shape)
  }

  function destroy() {
    resizeObserver.disconnect()
    app.ticker.remove(backgroundWork)
    app.ticker.remove(followPaper)
    checkers?.texture.destroy(true)
    view.destroy()
    brush.destroy()
    projection.destroy()
    gpu.destroy()
    memory.destroy()
    app.destroy(true, { children: true })
    listeners.clear()
  }

  const engine = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setBrush,
    setBrushTip,
    undo,
    redo,
    clearLayer,
    addLayer,
    deleteLayer,
    moveLayer,
    renameLayer,
    selectLayer,
    setLayerVisible,
    setLayerOpacity,
    finishLayerOpacity,
    fitToScreen: view.fitToScreen,
    exportImage,
    saveProject,
    destroy,
    // The engine's parts, to inspect them from the browser's console while developing (see DrawSpace)
    inspect: () => ({ app, stack, gpu, projection, history, memory, brush }),
  }

  return engine
}

export type Engine = Awaited<ReturnType<typeof createEngine>>
