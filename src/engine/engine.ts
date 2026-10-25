import { Application, CanvasSource, Container, Texture, TilingSprite } from 'pixi.js'
import type { RenderTexture, WebGLRenderer } from 'pixi.js'
import softRound from '../brushes/soft-round.lydbrush?raw'
import { createBrush, type BrushSettings } from './brush'
import { parseBrushFile, type BrushShape } from './brushFile'
import { decodeTip, type BrushTip } from './brushTip'
import { createPacer, DEFAULT_FILL, fillTile, findFillRegion, type FillSettings } from './fill'
import { createGpuTiles } from './gpuTiles'
import { createHistory, propsOf, type LayerProps } from './history'
import { activeIndex, createLayer, type Layer, type LayerStack } from './layers'
import { createTileMemory, type StoredTile } from './memory'
import { movedKeys, movedTile, shiftSelection } from './move'
import { createPixelGrid } from './pixelGrid'
import { createProjection } from './projection'
import { serializeProject, type LayerToSave, type ProjectData } from './projectFile'
import { withResolution } from './resolution'
import {
  combine,
  cutOut,
  invert,
  polygonTiles,
  selectEverything,
  type Point,
  type Selection,
  type SelectionMode,
} from './selection'
import { createSelectionView } from './selectionView'
import {
  createSmartView,
  imageTiles,
  isValidQuad,
  paintBounds,
  rectQuad,
  selectedPart,
  type Quad,
  type SmartObject,
  type SmartView,
} from './smartObject'
import { createGrid, parseTileKey, TILE_SIZE, tilesInGigabytes, tileSize, type Grid } from './tiles'
import { isPaintTool, type Tool } from './tools'
import { createView } from './view'

// What the screen needs to know about the drawing. A new object every time something changes, so React can tell
export type EngineSnapshot = {
  layers: { id: number; name: string; visible: boolean; opacity: number; isSmart: boolean }[] // from the bottom up
  activeLayerId: number
  canUndo: boolean
  canRedo: boolean
  isModified: boolean // changed since it was opened or last saved
  isUpdating: boolean // putting the picture together again after a layer change (see composeLayerTiles)
  task: string | null // what is being worked out over several frames ("Filling…"), if anything (see runTask)
  hasSelection: boolean
  transform: { smooth: boolean } | null // the transform being made, if any (see smartObject.ts)
}

// Browsers only tell roughly how much RAM the computer has (Chrome says at most 8 GB, others say nothing), so the
// budget for uncompressed tiles is a quarter of that guess
const ramGigabytes = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
const RAW_BUDGET = Math.max(0.5, ramGigabytes / 4) * 1024 ** 3

// PNG keeps every pixel exactly, and the transparency of a transparent background; JPEG makes much smaller files by
// leaving out details the eye hardly notices, and has no transparency (a transparent background becomes white)
export type ImageType = 'png' | 'jpeg'
const JPEG_QUALITY = 0.95 // from 0 to 1; PNG ignores it

// A change of up to this many tiles (a fill, Delete) shows right away; a bigger one is put together out of sight first
// (see changeTiles)
const SHOWN_AT_ONCE = 32

// Under a transparent background, the screen shows gray and white squares, like Photoshop and Krita, of this many
// pixels of the screen at any zoom
const CHECKER_SIZE = 8

function createCheckers(grid: Grid) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = CHECKER_SIZE * 2
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#cccccc'
  ctx.fillRect(0, 0, CHECKER_SIZE, CHECKER_SIZE)
  ctx.fillRect(CHECKER_SIZE, CHECKER_SIZE, CHECKER_SIZE, CHECKER_SIZE)
  const source = new CanvasSource({ resource: canvas, resolution: 1, scaleMode: 'nearest' })
  return new TilingSprite({ texture: new Texture({ source }), width: grid.width, height: grid.height })
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
  host.appendChild(app.canvas)
  // PixiJS only follows the size of the window; follow the host's own size too (when panels around it change)
  const resizeObserver = new ResizeObserver(() => app.resize())
  resizeObserver.observe(host)

  // ----- The drawing -----

  const grid = createGrid(project.width, project.height)
  const layers =
    project.layers.length > 0
      ? project.layers.map(({ smart, ...data }) => {
          const layer: Layer = { ...createLayer(data.name, data.tiles), ...data }
          if (smart) {
            const { tiles, bounds, corners, smooth } = smart
            layer.smart = { source: createLayer(`${data.name} (source)`, tiles), bounds, corners, smooth }
          }
          return layer
        })
      : [createLayer('Layer 1')]
  const stack: LayerStack = { layers, active: layers[project.activeLayer] ?? layers[layers.length - 1] }
  let layersCreated = layers.length // for naming new layers
  let selection: Selection | null = null // see selection.ts

  const memory = createTileMemory(RAW_BUDGET)
  const gpu = createGpuTiles(renderer, grid, memory, tilesInGigabytes(gpuMemory))
  const projection = createProjection(renderer, grid, stack, gpu, project.background)
  const history = createHistory(stack, gpu, projection, {
    get: () => selection,
    set: kept => {
      selection = kept
    },
  })

  // Everything that belongs to the drawing: zooming, moving, turning and flipping the view change this container (see
  // view.ts). Under a transparent background, the squares go first: they move, turn and flip with the drawing, but
  // keep their size on the screen, so they get smaller as the view zooms in, every frame
  const world = new Container()
  const checkers = project.background === null ? createCheckers(grid) : null
  if (checkers) world.addChild(checkers)
  world.addChild(projection.container)
  const followZoom = () => checkers?.tileScale.set(1 / world.scale.y) // the zoom (see view.ts)
  // Everything the screen shows of the drawing. The pixel grid goes over it, and the selection's edge over both
  const scene = new Container()
  scene.addChild(world)
  app.stage.addChild(scene)
  app.ticker.add(followZoom)
  const pixelGrid = createPixelGrid(renderer, app.ticker, app.stage, scene, world, grid, app.screen)
  const selectionView = createSelectionView(renderer, app.ticker, app.stage, world, grid, app.screen, () => selection)

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
    selectionView,
  )
  const fillSettings: FillSettings = { ...DEFAULT_FILL }
  let hasHardSelectionEdges = false
  let task: string | null = null // see runTask
  let isMoveEnding = false // a move waits for the tiles it changed to be put together (see endLift)
  let transform: Transform | null = null // see startTransform

  // Whoever wants the colors picked with the eyedropper (the editor's color). The Brush Designer paints in grays of
  // its own and doesn't listen, so there holding Alt doesn't pick colors
  const colorListeners = new Set<(color: string) => void>()
  const view = createView(app, world, grid, brush, projection, gpu, {
    onStrokeEnd: () => changed(),
    onColorPick: color => {
      for (const listener of colorListeners) listener(color)
    },
    canPickColors: () => colorListeners.size > 0,
    onFill: (x, y) => void fillAt(x, y),
    onSelect: (points, mode) => selectPolygon(points, mode),
    onMoveStart: () => startMove(),
    onMove: (dx, dy) => dragMove(dx, dy),
    onMoveEnd: keep => releaseMove(keep),
    isWorking: () => task !== null,
    // Smart objects can't be painted on (see smartObject.ts)
    canUse: tool => !(stack.active.smart && (isPaintTool(tool) || tool === 'fill')),
    getTransform: () => (transform ? { bounds: transform.object.bounds, corners: transform.corners } : null),
    onTransform: corners => setTransformCorners(corners),
  })
  // A saved drawing opens as it was shown when it was saved; a new one shows the whole paper
  if (project.view) view.showSaved(project.view)
  // Painting, filling, undoing, transforming and changing the layers wait for each other
  const isBusy = () => view.isPainting() || task !== null || transform !== null

  // ----- Telling React about changes -----

  const listeners = new Set<() => void>()
  let isModified = false
  let snapshot = makeSnapshot()

  function makeSnapshot(): EngineSnapshot {
    return {
      layers: stack.layers.map(({ id, name, visible, opacity, smart }) => ({
        id,
        name,
        visible,
        opacity,
        isSmart: smart !== undefined,
      })),
      activeLayerId: stack.active.id,
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
      isModified,
      isUpdating: projection.isUpdating(),
      task,
      hasSelection: selection !== null,
      transform: transform ? { smooth: transform.smooth } : null,
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
    // A move or a transform stops showing once the tiles it changed are put together, in the same frame (see endLift)
    if (isMoveEnding && !projection.isUpdating()) {
      projection.endMove()
      isMoveEnding = false
    }
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

  // Every tile in RAM that is still in use, by the layers (and their smart objects' sources) or by the undo history
  function* storedTiles(): Generator<StoredTile> {
    for (const layer of stack.layers) {
      yield* layer.tiles.values()
      if (layer.smart) yield* layer.smart.source.tiles.values()
    }
    yield* history.storedTiles()
  }

  // ----- Work over several frames -----

  // Do some work that takes several frames on big drawings (filling, Delete), working from the tiles in RAM. The tiles
  // just painted must get there first, so this waits for them. Meanwhile the bar shows "label", and painting, undoing
  // and changing the layers wait. "work" says whether it changed the drawing
  async function runTask(label: string, work: () => Promise<boolean>) {
    if (isBusy()) return
    task = label
    changed(false)
    let didChange = false
    try {
      while (gpu.hasUnsaved()) await nextFrame()
      didChange = await work()
    } finally {
      task = null
      changed(didChange)
    }
  }

  // Change tiles of a layer in RAM, a few every frame, as one undo step: "change" gives a tile's new pixels (null = no
  // paint), or undefined to leave it as it is. The new tiles are sent to the graphics card where it has a copy of
  // them, so nothing has to be read back from it. "withSelection": the selection changes too, right afterwards, as part
  // of the same step (a move). Returns whether anything changed
  async function changeTiles(
    layer: Layer,
    keys: Iterable<string>,
    change: (key: string, tile: StoredTile | undefined, width: number, height: number) => StoredTile | null | undefined,
    withSelection = false,
  ) {
    while (gpu.hasUnsaved()) await nextFrame() // every tile in RAM (nothing could paint since runTask waited)
    const pace = createPacer()
    const changedKeys: string[] = []
    history.begin(layer, { selection: withSelection })
    for (const key of keys) {
      await pace()
      const { column, row } = parseTileKey(key)
      const { width, height } = tileSize(grid, column, row)
      const tile = change(key, layer.tiles.get(key), width, height)
      if (tile === undefined) continue
      history.backUpTile(key)
      if (tile) layer.tiles.set(key, tile)
      else layer.tiles.delete(key)
      const cached = gpu.getCached(layer, key)
      if (cached) {
        if (tile) gpu.upload(tile, cached.texture)
        else gpu.clearTexture(cached.texture)
        gpu.markClean(cached)
      }
      changedKeys.push(key)
    }
    const didChange = history.end()
    // A small change shows right away. A big one is put together out of sight and shown all at once, like a layer
    // change, instead of spreading over the screen
    if (changedKeys.length <= SHOWN_AT_ONCE) {
      for (const key of changedKeys) {
        const { column, row } = parseTileKey(key)
        projection.composeTile(column, row)
      }
    } else {
      projection.composeLater(changedKeys)
    }
    return didChange
  }

  // ----- Layers -----

  function findLayer(id: number) {
    return stack.layers.find(layer => layer.id === id)
  }

  // A new empty layer above the active one, which becomes the active layer
  function addLayer() {
    if (isBusy()) return
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
    if (isBusy() || stack.layers.length === 1) return
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
    if (!layer || isBusy() || index < 0 || index >= stack.layers.length) return
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
    if (!layer || layer === stack.active || isBusy()) return
    stack.active = layer
    projection.markAllBelowStale() // "below" now has different layers
    changed(false) // the drawing itself didn't change
  }

  function setLayerVisible(id: number, visible: boolean) {
    const layer = findLayer(id)
    if (!layer || layer.visible === visible || isBusy()) return
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
    if (!layer || layer.opacity === opacity || isBusy()) return
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
    if (isBusy() || stack.active.smart) return
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
    if (isBusy()) return
    finishLayerOpacity() // an opacity change still on its way (Ctrl+Z while dragging) becomes a step first
    if (!history.canUndo()) return
    history.undo()
    changed()
  }

  function redo() {
    if (isBusy()) return
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
    const pack = (tiles: Map<string, StoredTile>) =>
      Promise.all(
        [...tiles].map(async ([key, tile]) => {
          const { column, row } = parseTileKey(key)
          if (tile.color !== undefined) return { column, row, color: tile.color }
          return { column, row, packed: await memory.pack(tile) }
        }),
      )
    // A smart object also keeps its source (see smartObject.ts)
    const layersToSave: LayerToSave[] = await Promise.all(
      stack.layers.map(async ({ name, visible, opacity, blendMode, tiles, smart }) => ({
        name,
        visible,
        opacity,
        blendMode,
        tiles: await pack(tiles),
        smart: smart && {
          tiles: await pack(smart.source.tiles),
          bounds: smart.bounds,
          corners: smart.corners,
          smooth: smart.smooth,
        },
      })),
    )
    const file = serializeProject(project, activeIndex(stack), view.getSaved(), layersToSave)
    isModified = false
    changed(false)
    return file
  }

  // ----- Tools and brush -----

  // Choose what the left button does on the paper (see tools.ts)
  function setTool(tool: Tool) {
    view.setTool(tool)
    if (isPaintTool(tool)) brush.settings.tool = tool
  }

  // Tell "listener" every color picked with the eyedropper. Returns a function that stops it
  function onColorPick(listener: (color: string) => void) {
    colorListeners.add(listener)
    return () => {
      colorListeners.delete(listener)
    }
  }

  function setBrush(settings: Partial<BrushSettings>) {
    Object.assign(brush.settings, settings)
  }

  function setFill(settings: Partial<FillSettings>) {
    Object.assign(fillSettings, settings)
  }

  // Fill the region around this point of the paper with the brush's color and opacity (see fill.ts), only where it is
  // selected when there is a selection
  function fillAt(x: number, y: number) {
    const seedX = Math.floor(x)
    const seedY = Math.floor(y)
    if (seedX < 0 || seedY < 0 || seedX >= grid.width || seedY >= grid.height) return
    return runTask('Filling…', async () => {
      const layer = stack.active
      const reference =
        fillSettings.reference === 'layer'
          ? [{ tiles: layer.tiles, opacity: 1 }]
          : stack.layers.filter(other => other.visible).map(({ tiles, opacity }) => ({ tiles, opacity }))
      const { tolerance, expand } = fillSettings
      const region = await findFillRegion(grid, reference, memory, seedX, seedY, tolerance, expand)
      const { color, opacity } = brush.settings
      return changeTiles(layer, region.keys(), (key, tile, width, height) => {
        const selected = selection ? selection.get(key) : 'full'
        if (!selected) return undefined // not selected at all
        const amounts = selected === 'full' ? undefined : selected
        return fillTile(tile, region.get(key)!, color, opacity, width, height, memory, amounts)
      })
    })
  }

  // Paint with another brush: its tip (see brushTip.ts) and how the tip is placed along the strokes
  function setBrushTip(tip: BrushTip, shape: BrushShape) {
    brush.setTip(tip, shape)
  }

  // ----- Selection -----

  // Change the selection, as a step that can be undone (null: nothing selected)
  function setSelection(next: Selection | null) {
    if (isBusy() || next === selection) return
    history.recordSelection()
    selection = next
    changed(false)
  }

  // Select inside a polygon drawn on the paper (see view.ts), or take it away from the selection, or add it. Fewer
  // than 3 points is a click: in place of the selection, that selects nothing
  function selectPolygon(points: Point[], mode: SelectionMode) {
    if (points.length < 3) {
      if (mode === 'replace') setSelection(null)
      return
    }
    setSelection(combine(selection, polygonTiles(grid, points, hasHardSelectionEdges), mode))
  }

  // New selections get soft edges, or hard ones (whole pixels, for pixel art)
  function setSelectionEdges(hard: boolean) {
    hasHardSelectionEdges = hard
  }

  // Take the paint out of the selected part of the active layer (Delete)
  function deleteSelected() {
    const cut = selection
    if (!cut || stack.active.smart) return
    return runTask('Deleting…', () => {
      const layer = stack.active
      const keys = [...cut.keys()].filter(key => layer.tiles.has(key))
      return changeTiles(layer, keys, (key, tile, width, height) =>
        tile ? cutOut(tile, cut.get(key)!, width, height, memory) : undefined,
      )
    })
  }

  // ----- Moving -----

  // The move tool's drag, from when the pointer goes down: how far it has gone on the paper, what follows it once the
  // move shows, and, once the pointer has moved, how to tell the move that it came up
  type MoveDrag = {
    dx: number
    dy: number
    follow: ((dx: number, dy: number) => void) | null
    release: ((keep: boolean) => void) | null
  }
  let moveDrag: MoveDrag | null = null

  // A hidden layer doesn't show, so it isn't moved
  function startMove() {
    if (isBusy() || !stack.active.visible) return
    moveDrag = { dx: 0, dy: 0, follow: null, release: null }
  }

  // The move starts the first time the pointer moves, so a click with the move tool does nothing. On a smart object,
  // the move tool moves the whole object
  function dragMove(dx: number, dy: number) {
    const drag = moveDrag
    if (!drag) return
    drag.dx = dx
    drag.dy = dy
    drag.follow?.(dx, dy)
    if (!drag.release && (dx !== 0 || dy !== 0)) {
      const released = new Promise<boolean>(resolve => {
        drag.release = resolve
      })
      if (stack.active.smart) void moveObject(drag, released)
      else void runTask('Moving…', () => moveLifted(drag, released))
    }
  }

  function releaseMove(keep: boolean) {
    moveDrag?.release?.(keep)
    moveDrag = null
  }

  // Get the projection ready to show a part of the active layer on its own (see showMove in projection.ts), a few
  // tiles every frame: what is left of the layer where it loses paint ("lifted"), and the layers above where they have
  // paint. With "withPictures", also pictures of the part it loses there, to move along; a smart object being
  // transformed draws itself instead. Tiles shown live would show through all that
  async function prepareLift(layer: Layer, cut: Selection | null, lifted: string[], withPictures: boolean) {
    projection.finishLive()
    const isLifted = new Set(lifted)
    const pace = createPacer()
    for (const key of new Set([...lifted, ...projection.paintedAbove()])) {
      await pace()
      const { column, row } = parseTileKey(key)
      const texture = layer.visible ? gpu.getTexture(layer, column, row, false) : null
      const selected = !isLifted.has(key) ? undefined : cut ? cut.get(key) : 'full'
      let moving: RenderTexture | null = null
      let left: RenderTexture | null = null
      if (texture && selected && withPictures) {
        moving = projection.moveTexture(column, row)
        gpu.copyInto(texture, moving)
        selectionView.cut(moving, key)
      }
      if (texture && selected !== 'full') {
        left = projection.moveTexture(column, row)
        gpu.copyInto(texture, left)
        if (selected) selectionView.cutAway(left, key)
      }
      projection.prepareMoveTile(key, moving, left)
    }
  }

  // Lift the selected part of the active layer, or all of it when nothing is selected, show it on its own while it is
  // dragged, and put it down where the pointer comes up (see move.ts), as one undo step together with the selection,
  // which moves along
  async function moveLifted(drag: MoveDrag, released: Promise<boolean>) {
    const layer = stack.active
    const cut = selection
    const lifted = [...gpu.tilesWithPaint(layer)].filter(key => !cut || cut.has(key))
    if (lifted.length === 0) return released.then(() => false) // nothing to move
    try {
      await prepareLift(layer, cut, lifted, true)
      const follow = (dx: number, dy: number) => {
        projection.setMoveOffset(dx, dy)
        selectionView.setOffset(dx, dy)
      }
      projection.showMove(drag.dx, drag.dy)
      follow(drag.dx, drag.dy)
      drag.follow = follow

      const keep = await released
      const { dx, dy } = drag
      if (!keep || (dx === 0 && dy === 0)) return false
      const before = new Map(layer.tiles) // the tiles change one by one, and each new one needs the old ones
      const keys = movedKeys(grid, lifted, dx, dy)
      const didChange = await changeTiles(layer, keys, key => movedTile(grid, before, cut, key, dx, dy, memory), true)
      if (didChange && cut) selection = shiftSelection(grid, cut, dx, dy)
      return didChange
    } finally {
      // The move stays on the screen until the tiles it changed are put together (see backgroundWork)
      selectionView.setOffset(0, 0)
      await endLift()
    }
  }

  // Keep showing a move or a transform until the tiles it changed are put together, then stop, in the same frame (see
  // backgroundWork)
  async function endLift() {
    isMoveEnding = true
    while (isMoveEnding) await nextFrame()
  }

  // On a smart object, the move tool moves the whole object, without losing anything: a transform that only moves it.
  // The selection is left alone
  async function moveObject(drag: MoveDrag, released: Promise<boolean>) {
    await startTransform()
    const started = transform
    if (!started) return
    const { corners } = started
    const follow = (dx: number, dy: number) =>
      setTransformCorners(corners.map(p => ({ x: p.x + dx, y: p.y + dy })) as Quad)
    follow(drag.dx, drag.dy)
    drag.follow = follow
    const keep = await released
    if (keep && (drag.dx !== 0 || drag.dy !== 0)) await applyTransform()
    else cancelTransform()
  }

  // ----- Transforming: smart objects -----

  // The transform being made (see smartObject.ts): the layer, and what it transforms: its smart object; the whole
  // layer, which becomes one; the selected part of it, which goes into a new layer above as one; or an image being put
  // into the drawing, which goes into a new layer above as one too (see placeImage). "corners" are where the handles
  // have it now (see view.ts)
  type Transform = {
    layer: Layer
    kind: 'object' | 'layer' | 'part' | 'image'
    object: SmartObject // as it was when the transform started
    corners: Quad
    smooth: boolean
    view: SmartView
    cut: Selection | null
    name?: string // the new layer's name, for an image
  }
  let smoothTransforms = true // smooth or whole pixels, as chosen last, for new smart objects

  // Start transforming the active layer (Ctrl+T). On big layers, getting it ready takes a few frames, with
  // "Transforming…" in the bar; the handles show once it is ready
  function startTransform() {
    const layer = stack.active
    if (isBusy() || !layer.visible) return
    const cut = layer.smart ? null : selection
    return runTask('Transforming…', async () => {
      const pace = createPacer()
      let object = layer.smart
      if (!object) {
        // Its source: the layer's tiles as they are now, or their selected part
        const tiles = new Map<string, StoredTile>()
        for (const [key, tile] of layer.tiles) {
          const selected = cut ? cut.get(key) : 'full'
          if (!selected) continue
          await pace()
          const { column, row } = parseTileKey(key)
          const { width, height } = tileSize(grid, column, row)
          const part = selectedPart(tile, selected, width, height, memory)
          if (part) tiles.set(key, part)
        }
        const bounds = paintBounds(grid, tiles, memory)
        if (!bounds) return false // nothing to transform
        const source = createLayer(`${layer.name} (source)`, tiles)
        object = { source, bounds, corners: rectQuad(bounds), smooth: smoothTransforms }
      }
      const lifted = [...layer.tiles.keys()].filter(key => !cut || cut.has(key))
      await showTransform({ layer, kind: layer.smart ? 'object' : cut ? 'part' : 'layer', object, cut }, lifted, pace)
      return false
    })
  }

  // Put an image into the drawing as a smart object, centered at this point of the paper, with the handles showing:
  // Enter puts it into a new layer above the active one, named after it, and Esc leaves it out. An image bigger than
  // the paper is made smaller to fit it, since a source is on the paper's grid. The image is closed afterwards
  function placeImage(image: ImageBitmap, name: string, at: Point) {
    if (isBusy()) {
      image.close()
      return
    }
    const layer = stack.active
    return runTask('Placing…', async () => {
      let fitted = image
      try {
        const scale = Math.min(1, grid.width / image.width, grid.height / image.height)
        if (scale < 1) {
          fitted = await createImageBitmap(image, {
            resizeWidth: Math.max(1, Math.min(grid.width, Math.round(image.width * scale))),
            resizeHeight: Math.max(1, Math.min(grid.height, Math.round(image.height * scale))),
            resizeQuality: 'high',
          })
        }
        const pace = createPacer()
        const tiles = await imageTiles(grid, fitted, pace)
        const { width, height } = fitted
        // On whole pixels, so that at 100% its pixels are the image's own
        const x = Math.round(at.x - width / 2)
        const y = Math.round(at.y - height / 2)
        const object: SmartObject = {
          source: createLayer(`${name} (source)`, tiles),
          bounds: { x: 0, y: 0, width, height },
          corners: rectQuad({ x, y, width, height }),
          smooth: smoothTransforms,
        }
        await showTransform({ layer, kind: 'image', object, cut: null, name }, [], pace)
      } finally {
        image.close()
        fitted.close()
      }
      return false
    })
  }

  // Show a smart object with the handles, in place of the tiles of its layer that it takes the paint of ("lifted"), a
  // few blocks every frame ("pace": the caller's, so the frame it is in isn't given a new share of time)
  async function showTransform(
    started: Omit<Transform, 'corners' | 'smooth' | 'view'>,
    lifted: string[],
    pace: () => Promise<void>,
  ) {
    const { object } = started
    const view = createSmartView(renderer, grid, gpu, object)
    for (const key of view.blocks) {
      await pace()
      view.addBlock(key)
    }
    await prepareLift(started.layer, started.cut, lifted, false)
    projection.setMoveContent(view.container)
    projection.showMove(0, 0)
    transform = { ...started, corners: object.corners, smooth: object.smooth, view }
  }

  // The handles moved (see view.ts). Corners that would fold the object over itself are left out
  function setTransformCorners(corners: Quad) {
    if (!transform || !isValidQuad(corners)) return
    transform.corners = corners
    transform.view.setCorners(corners)
  }

  function setTransformSmooth(smooth: boolean) {
    if (!transform) return
    transform.smooth = smooth
    smoothTransforms = smooth
    transform.view.setSmooth(smooth)
    changed(false)
  }

  // Esc: everything stays as it was
  function cancelTransform() {
    const ended = transform
    if (!ended) return
    transform = null
    projection.endMove()
    ended.view.destroy()
    changed(false)
  }

  // Enter: draw the object at its new corners into its layer, as one undo step. A layer becomes a smart object; a
  // selected part leaves its layer and goes into a new layer above it as one, which becomes the active layer, and so
  // does an image
  function applyTransform() {
    const done = transform
    if (!done) return
    transform = null // the handles go, and the work can start
    const { layer, kind, view, cut } = done
    const object: SmartObject = { ...done.object, corners: done.corners, smooth: done.smooth }
    return runTask('Transforming…', async () => {
      let target = layer
      history.startGroup()
      try {
        if (kind === 'part' && cut) {
          const keys = [...cut.keys()].filter(key => layer.tiles.has(key))
          await changeTiles(layer, keys, (key, tile, width, height) =>
            tile ? cutOut(tile, cut.get(key)!, width, height, memory) : undefined,
          )
          history.recordSelection()
          selection = null
        }
        if (kind === 'part' || kind === 'image') {
          // The new layer goes above, and becomes the active layer only once the transform stops showing: until then
          // the projection keeps putting tiles together with the same layers under the active one as what it shows
          target = createLayer(done.name ?? `Layer ${++layersCreated}`)
          history.recordOrder(target)
          stack.layers.splice(stack.layers.indexOf(layer) + 1, 0, target)
        }
        await drawObject(target, object, view)
        return true
      } finally {
        history.endGroup()
        await endLift()
        view.destroy()
        if (target !== layer && stack.layers.includes(target)) {
          stack.active = target
          projection.markAllBelowStale()
        }
      }
    })
  }

  // Draw a smart object at its corners into a layer's tiles, a few every frame, as an undo step that also keeps the
  // layer's smart object from before. Like strokes, the tiles are drawn on the graphics card and read back into RAM in
  // the background. They are put together out of sight and shown all at once
  async function drawObject(layer: Layer, object: SmartObject, view: SmartView) {
    const covered = view.coveredKeys()
    const keys = new Set([...gpu.tilesWithPaint(layer), ...covered])
    const pace = createPacer()
    history.begin(layer, { smart: true })
    for (const key of keys) {
      await pace()
      const { column, row } = parseTileKey(key)
      history.backUpTile(key) // before the tile changes: the graphics card works in order
      if (covered.has(key)) {
        view.drawTile(column, row, gpu.getTextureToReplace(layer, column, row))
        gpu.markDirty(layer, key)
        continue
      }
      layer.tiles.delete(key)
      const cached = gpu.getCached(layer, key)
      if (cached) {
        gpu.clearTexture(cached.texture)
        gpu.markClean(cached) // empty on the graphics card and in RAM
      }
    }
    layer.smart = object
    history.end()
    projection.composeLater(keys)
  }

  // Turn the active smart object into a normal layer: its pixels stay as they are and can be painted on, but its
  // original is gone (it can be undone)
  function convertToPixels() {
    const layer = stack.active
    if (isBusy() || !layer.smart) return
    history.recordLayer(layer, propsOf(layer))
    layer.smart = undefined
    changed()
  }

  // ----- The color around the paper -----

  // It follows the interface's colors (see theme.ts)
  function setBackdrop(color: string) {
    app.renderer.background.color = color
  }

  // ----- Pixel grid -----

  // Turn the pixel grid on or off. When on, it shows from 800% zoom (see pixelGrid.ts)
  function setPixelGrid(on: boolean) {
    pixelGrid.setOn(on)
  }

  function destroy() {
    resizeObserver.disconnect()
    app.ticker.remove(backgroundWork)
    app.ticker.remove(followZoom)
    pixelGrid.destroy()
    transform?.view.destroy()
    selectionView.destroy()
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
    setTool,
    onColorPick,
    setBrush,
    setFill,
    setBrushTip,
    setPixelGrid,
    setBackdrop,
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
    // The selection (see selection.ts)
    getSelection: () => selection,
    selectAll: () => setSelection(selectEverything(grid)),
    deselect: () => setSelection(null),
    invertSelection: () => setSelection(invert(grid, selection)),
    setSelectionEdges,
    deleteSelected,
    // Transforms and smart objects (see smartObject.ts)
    startTransform,
    placeImage,
    applyTransform,
    cancelTransform,
    setTransformSmooth,
    convertToPixels,
    // The view: its zoom, rotation and flip (see view.ts)
    getView: view.getState,
    paperAtWindow: view.paperAtWindow,
    subscribeView: view.subscribe,
    fitToScreen: view.fitToScreen,
    zoomView: view.zoomTo,
    turnView: view.turnTo,
    straightenView: view.straighten,
    flipView: view.flip,
    exportImage,
    saveProject,
    destroy,
    // The engine's parts, to inspect them from the browser's console while developing (see DrawSpace)
    inspect: () => ({ app, stack, gpu, projection, history, memory, brush, world, pixelGrid, selectionView }),
  }

  return engine
}

export type Engine = Awaited<ReturnType<typeof createEngine>>
