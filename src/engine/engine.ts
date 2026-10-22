import { Application, Container } from 'pixi.js'
import type { WebGLRenderer } from 'pixi.js'
import { createBrush, type BrushSettings } from './brush'
import { createGpuTiles } from './gpuTiles'
import { createHistory } from './history'
import { activeIndex, createLayer, type Layer, type LayerStack } from './layers'
import { createTileMemory, type StoredTile } from './memory'
import { createProjection } from './projection'
import { serializeProject, type LayerToSave, type ProjectData } from './projectFile'
import { createGrid, parseTileKey, TILE_SIZE } from './tiles'
import { createView } from './view'

// What the screen needs to know about the drawing. A new object every time something changes, so React can tell
export type EngineSnapshot = {
  layers: { id: number; name: string; visible: boolean; opacity: number }[] // from the bottom to the top
  activeLayerId: number
  canUndo: boolean
  canRedo: boolean
  isModified: boolean // changed since it was opened or last saved
}

// Browsers only tell roughly how much RAM the computer has (Chrome says at most 8 GB, others say nothing), so the
// budget for uncompressed tiles is a quarter of that guess
const ramGigabytes = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
const RAW_BUDGET = Math.max(0.5, ramGigabytes / 4) * 1024 ** 3

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

// The drawing engine: shows the drawing inside "host" and lets the user paint on it. Everything that touches the
// graphics card lives here; React only shows the controls around it
export async function createEngine(host: HTMLElement, project: ProjectData) {
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
  const gpu = createGpuTiles(renderer, grid, memory)
  const projection = createProjection(renderer, grid, stack, gpu)
  const history = createHistory(stack, gpu, projection)
  const brush = createBrush(renderer, grid, stack, gpu, projection, history)

  const world = new Container() // everything that belongs to the drawing; zoom and pan move this container
  world.addChild(projection.container)
  app.stage.addChild(world)
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
    }
  }

  // Something changed: make a new snapshot and tell whoever is listening. "modified" = the drawing itself changed
  function changed(modified = true) {
    if (modified) isModified = true
    snapshot = makeSnapshot()
    for (const listener of listeners) listener()
  }

  // ----- Work done in the background, every frame -----

  // Painted tiles are read back into RAM without waiting, a few per frame (fewer while painting, skipping the tiles of
  // the stroke, which will change again in a moment). Once a second, the tiles in RAM are kept within their budget
  let lastBudgetCheck = 0
  function backgroundWork() {
    const isPainting = view.isPainting()
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

  // The tiles where a layer has paint, in RAM or still only on the graphics card
  function tilesWithPaint(layer: Layer) {
    return new Set([...layer.tiles.keys(), ...gpu.dirtyKeysOf(layer)])
  }

  // Put together again the tiles a layer changes, after it was hidden, shown, or got another opacity
  function recomposeLayer(layer: Layer) {
    const isBelowActive = stack.layers.indexOf(layer) < activeIndex(stack)
    for (const key of tilesWithPaint(layer)) {
      if (isBelowActive) projection.markBelowStale(key)
      const { column, row } = parseTileKey(key)
      projection.composeTile(column, row)
    }
  }

  // A new empty layer above the active one, which becomes the active layer
  function addLayer() {
    if (view.isPainting()) return
    const layer = createLayer(`Layer ${++layersCreated}`)
    stack.layers.splice(activeIndex(stack) + 1, 0, layer)
    stack.active = layer
    projection.markAllBelowStale() // "below" now has one more layer
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
    layer.visible = visible
    recomposeLayer(layer)
    changed()
  }

  function setLayerOpacity(id: number, opacity: number) {
    const layer = findLayer(id)
    if (!layer || layer.opacity === opacity || view.isPainting()) return
    layer.opacity = opacity
    recomposeLayer(layer)
    changed()
  }

  // Remove all the paint from the active layer. It can be undone like a stroke
  function clearLayer() {
    if (view.isPainting()) return
    const layer = stack.active
    history.begin(layer)
    for (const key of tilesWithPaint(layer)) {
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
    if (view.isPainting() || !history.canUndo()) return
    history.undo()
    changed()
  }

  function redo() {
    if (view.isPainting() || !history.canRedo()) return
    history.redo()
    changed()
  }

  // ----- Files -----

  // The drawing as a PNG image at its full size. The projection already has the white paper and all the visible
  // layers put together, so only its tiles need to be copied
  async function exportPng() {
    await nextFrame() // let the screen show that the export started before the slow part
    const canvas = document.createElement('canvas')
    canvas.width = grid.width
    canvas.height = grid.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This image is too big for this browser.')
    for (const [key, texture] of projection.tiles) {
      const { column, row } = parseTileKey(key)
      ctx.drawImage(renderer.extract.canvas(texture) as HTMLCanvasElement, column * TILE_SIZE, row * TILE_SIZE)
    }
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('This image is too big for this browser.')
    return blob
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
    const file = serializeProject(grid.width, grid.height, activeIndex(stack), layersToSave)
    isModified = false
    changed(false)
    return file
  }

  // ----- Brush -----

  function setBrush(settings: Partial<BrushSettings>) {
    Object.assign(brush.settings, settings)
  }

  function destroy() {
    resizeObserver.disconnect()
    app.ticker.remove(backgroundWork)
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
    undo,
    redo,
    clearLayer,
    addLayer,
    selectLayer,
    setLayerVisible,
    setLayerOpacity,
    fitToScreen: view.fitToScreen,
    exportPng,
    saveProject,
    destroy,
    // The engine's parts, to inspect them from the browser's console while developing (see DrawSpace)
    inspect: () => ({ app, stack, gpu, projection, history, memory, brush }),
  }

  return engine
}

export type Engine = Awaited<ReturnType<typeof createEngine>>
