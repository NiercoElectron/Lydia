import { translate } from '../i18n'
import { LydiaError } from '../errors'
import { Application, CanvasSource, Container, RenderTexture, Sprite, Texture, TilingSprite } from 'pixi.js'
import type { WebGLRenderer } from 'pixi.js'
import softRound from '../brushes/soft-round.lydbrush?raw'
import { createLayerBlender } from './blendModes'
import { createBrush, type BrushSettings } from './brush'
import { parseBrushFile, type BrushShape } from './brushFile'
import { decodeTip, type BrushTip } from './brushTip'
import {
  createPacer,
  DEFAULT_FILL,
  fillTile,
  findFillRegion,
  layersReference,
  type FillSettings,
  type TileReference,
} from './fill'
import { createGpuTiles } from './gpuTiles'
import { createHistory, propsOf, type LayerProps } from './history'
import {
  activeIndex,
  blockStart,
  clipBaseIndex,
  createFolder,
  createLayer,
  isClipped,
  isFolder,
  isInside,
  isShown,
  LOCKED_ALPHA,
  siblingBelow,
  type BlendMode,
  type Layer,
  type LayerStack,
} from './layers'
import { createTileMemory, toStoredTile, type StoredTile } from './memory'
import { movedKeys, movedTile, shiftSelection } from './move'
import { createOutsideView } from './outsideView'
import { createPixelGrid } from './pixelGrid'
import { createProjection } from './projection'
import {
  EXPORT_SCALES,
  fitsExport,
  MAX_SIZE,
  serializeProject,
  type LayerToSave,
  type ProjectData,
} from './projectFile'
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
import type { StabilizerSettings } from './stabilizer'
import {
  createGrid,
  isOnPaper,
  paperPart,
  parseTileKey,
  TILE_SIZE,
  tilesInGigabytes,
  tileSize,
  wholeTileMask,
  type Grid,
} from './tiles'
import { isPaintTool, type Tool } from './tools'
import { createView } from './view'

// What the screen needs to know about the drawing. A new object every time something changes, so React can tell
export type EngineSnapshot = {
  // From the bottom up. "hasOffPaper": the layer has paint off the paper; "showsOffPaper": it shows it (see
  // outsideView.ts)
  layers: {
    id: number
    name: string
    visible: boolean
    opacity: number
    blendMode: BlendMode
    isSmart: boolean
    hasOffPaper: boolean
    showsOffPaper: boolean
    alphaLocked: boolean
    clipped: boolean // clipped to the layers under it (see isClipped in layers.ts)
    canClip: boolean // it has a layer or folder under it in the same folder, to be clipped to
    isFolder: boolean // see isFolder in layers.ts
    isOpen: boolean // a folder that shows what is in it in the layers panel
    parentId: number | null // the folder it is in
    depth: number // how many folders it is in
  }[]
  activeLayerId: number
  canDelete: boolean // deleting the active layer or folder leaves a layer to paint on
  canUndo: boolean
  canRedo: boolean
  isModified: boolean // changed since it was opened or last saved
  isUpdating: boolean // putting the picture together again after a layer change (see composeLayerTiles)
  task: string | null // what is being worked out over several frames ("Filling…"), if anything (see runTask)
  progress: number | null // how far the task is, from 0 to 1, when it can tell (see setProgress)
  hasSelection: boolean
  transform: { smooth: boolean } | null // the transform being made, if any (see smartObject.ts)
  canMergeDown: boolean // the active layer can be merged into the one under it (see mergeDown)
  exportScale: number // how many times bigger images are exported
  exportScales: number[] // the ones this drawing's images fit at
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

// Destroying the engine's PixiJS application takes its canvas off the page, but leaves PixiJS's global resources
// alone ("true" would release them too): the brush previews' own renderer (see previewSurface.ts) keeps using them,
// and released, they broke the next preview drawn (decision 30)
const KEEP_GLOBAL_RESOURCES = { removeView: true, releaseGlobalResources: false }

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
  // The blend mode for layers whose transparency is locked (see layers.ts): the color of the paint goes where the
  // layer has paint, as much as it covers, and the layer's transparency stays. PixiJS keeps its blend modes in a map
  // it doesn't let others reach, and uses any mode found in it
  const gl = renderer.gl
  const blendModes = (renderer.state as unknown as { blendModesMap: Record<string, number[]> }).blendModesMap
  blendModes[LOCKED_ALPHA] = [gl.DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE]
  if (!(renderer.gl instanceof WebGL2RenderingContext)) {
    app.destroy(KEEP_GLOBAL_RESOURCES)
    throw new LydiaError('LYD-401')
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
          const layer: Layer = { ...createLayer(data.name, data.tiles), ...data, parent: null } // set below
          if (smart) {
            const { tiles, bounds, corners, smooth } = smart
            layer.smart = { source: createLayer(`${data.name} (source)`, tiles), bounds, corners, smooth }
          }
          return layer
        })
      : [createLayer(translate('Layer {number}', { number: 1 }))]
  // Each layer's folder, from its position (see projectFile.ts)
  project.layers.forEach(({ parent }, index) => {
    if (parent !== undefined) layers[index].parent = layers[parent]
  })
  const stack: LayerStack = { layers, active: layers[project.activeLayer] ?? layers[layers.length - 1] }
  let layersCreated = layers.filter(layer => !isFolder(layer)).length // for naming new layers
  let foldersCreated = layers.length - layersCreated // and folders
  let exportScale = project.exportScale ?? 1
  let selection: Selection | null = null // see selection.ts

  const memory = createTileMemory(RAW_BUDGET)
  const gpu = createGpuTiles(renderer, memory, tilesInGigabytes(gpuMemory))
  const blender = createLayerBlender(renderer)
  const projection = createProjection(renderer, grid, stack, gpu, blender, project.background)
  const history = createHistory(stack, gpu, projection, {
    get: () => selection,
    set: kept => {
      selection = kept
    },
  })

  // Everything that belongs to the drawing: zooming, moving, turning and flipping the view change this container (see
  // view.ts). Under a transparent background, the squares go first: they move, turn and flip with the drawing, but
  // keep their size on the screen, so they get smaller as the view zooms in, every frame. Under everything, the paint
  // off the paper, faded: the layers' that show it (see outsideView.ts), then what a move or a transform moves (the
  // ghost, see projection.ts). The paper hides it where it is on the paper
  const world = new Container()
  const outside = createOutsideView(grid, stack, gpu)
  world.addChild(outside.container, projection.ghost)
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
  // The layer a move or a transform shows on its own, with its paint off the paper (see prepareLift), left out of the
  // layers' paint off the paper meanwhile
  let outsideHidden: Layer | null = null
  // A transform drew tiles that are only on the graphics card for now: whether they have paint off the paper is told
  // again once they are in RAM (see hasPaintOff and backgroundWork)
  let offPaperStale = false
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
    // A smart object (see smartObject.ts) or a folder can't be painted on, and the eraser can't take paint out of a layer
    // whose transparency is locked
    canUse: tool =>
      !((stack.active.smart || isFolder(stack.active)) && (isPaintTool(tool) || tool === 'fill')) &&
      !(tool === 'eraser' && stack.active.alphaLocked),
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

  // Whether a layer's tile has paint off the paper: off it, or in its part past the paper's right or bottom edge.
  // Tiles never change (see memory.ts), so the answer for each edge tile is kept. A tile whose latest pixels are still
  // only on the graphics card is looked at as it is in RAM (see offPaperStale)
  const paintOffEdge = new WeakMap<StoredTile, boolean>()
  function hasPaintOff(key: string, tile: StoredTile | undefined) {
    const { column, row } = parseTileKey(key)
    if (!isOnPaper(grid, column, row)) return true
    const { width, height } = tileSize(grid, column, row)
    if ((width === TILE_SIZE && height === TILE_SIZE) || !tile) return false
    let found = paintOffEdge.get(tile)
    if (found === undefined) {
      found = false
      const pixels = memory.unpack(tile, TILE_SIZE, TILE_SIZE)
      for (let y = 0; y < TILE_SIZE && !found; y++) {
        for (let x = y < height ? width : 0; x < TILE_SIZE; x++) {
          if (pixels[(y * TILE_SIZE + x) * 4 + 3] !== 0) {
            found = true
            break
          }
        }
      }
      paintOffEdge.set(tile, found)
    }
    return found
  }

  const hasPaintOffPaper = (layer: Layer) =>
    [...gpu.tilesWithPaint(layer)].some(key => hasPaintOff(key, layer.tiles.get(key)))

  // How many folders a layer is in
  function depthOf(layer: Layer) {
    let depth = 0
    for (let folder = layer.parent; folder; folder = folder.parent) depth++
    return depth
  }

  // The layers in a folder, and in the folders in it
  const layersIn = (folder: Layer) => stack.layers.filter(layer => !isFolder(layer) && isInside(layer, folder))

  let snapshot = makeSnapshot()
  outside.update() // a drawing opened from a file may have layers that show their paint off the paper

  function makeSnapshot(): EngineSnapshot {
    return {
      layers: stack.layers.map((layer, index) => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        isSmart: layer.smart !== undefined,
        hasOffPaper: hasPaintOffPaper(layer),
        showsOffPaper: layer.showOffPaper,
        alphaLocked: layer.alphaLocked,
        clipped: isClipped(stack, index),
        canClip: siblingBelow(stack, index) >= 0,
        isFolder: isFolder(layer),
        isOpen: layer.folder?.open === true,
        parentId: layer.parent?.id ?? null,
        depth: depthOf(layer),
      })),
      activeLayerId: stack.active.id,
      canDelete: canDelete(),
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
      isModified,
      isUpdating: projection.isUpdating(),
      task,
      progress: task ? taskProgress : null,
      hasSelection: selection !== null,
      transform: transform ? { smooth: transform.smooth } : null,
      canMergeDown: canMergeDown(),
      exportScale,
      exportScales: EXPORT_SCALES.filter(scale => fitsExport(grid.width, grid.height, scale)),
    }
  }

  // Something changed: make a new snapshot and tell whoever is listening. "modified" = the drawing itself changed
  function changed(modified = true) {
    if (modified) isModified = true
    outside.update(outsideHidden)
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
    if (offPaperStale && !gpu.hasUnsaved()) {
      offPaperStale = false
      changed(false)
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
    taskProgress = null
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

  // How far the task is, from 0 to 1 (null: it can't tell), shown as a bar next to its name. The screen is told only
  // when it moves by a hundredth, not on every frame
  let taskProgress: number | null = null
  function setProgress(value: number | null) {
    const rounded = value === null ? null : Math.min(1, Math.floor(value * 100) / 100)
    if (rounded === taskProgress) return
    taskProgress = rounded
    changed(false)
  }

  // Change tiles of a layer in RAM, a few every frame, as one undo step: "change" gives a tile's new pixels (null = no
  // paint, and the tile is whole: see tiles.ts), or undefined to leave it as it is. The new tiles are sent to the graphics card where it has a copy of
  // them, so nothing has to be read back from it. "withSelection": the selection changes too, right afterwards, as part
  // of the same step (a move). Returns whether anything changed
  async function changeTiles(
    layer: Layer,
    keys: Iterable<string>,
    change: (key: string, tile: StoredTile | undefined) => StoredTile | null | undefined,
    keep: { selection?: boolean; smart?: boolean } = {}, // what the undo step keeps too (see history.ts)
    onTile?: () => void, // called for each tile, to show how far the work is
  ) {
    while (gpu.hasUnsaved()) await nextFrame() // every tile in RAM (nothing could paint since runTask waited)
    const pace = createPacer()
    const changedKeys: string[] = []
    history.begin(layer, keep)
    for (const key of keys) {
      await pace()
      onTile?.()
      const tile = change(key, layer.tiles.get(key))
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
    addItem(createLayer(translate('Layer {number}', { number: ++layersCreated })))
  }

  // Add a layer right above the folder the active layer is in, or above the active folder: out of it, in the folder
  // around it (if any), and make it the active one
  function addLayerOutside() {
    const active = stack.active
    const folder = isFolder(active) ? active : active.parent
    if (isBusy() || !folder) return
    addItem(
      createLayer(translate('Layer {number}', { number: ++layersCreated })),
      stack.layers.indexOf(folder) + 1,
      folder.parent,
    )
  }

  // Add an empty folder (see isFolder in layers.ts), like a new layer
  function addFolder() {
    if (isBusy()) return
    addItem(createFolder(translate('Folder {number}', { number: ++foldersCreated })))
  }

  // Put a new layer or folder at this position, in this folder (null: none), and make it the active one. By default,
  // above the active one, in the same folder, or on top of what is in the active folder when it is open. It is empty,
  // so the picture doesn't change
  function addItem(item: Layer, index?: number, parent?: Layer | null) {
    const active = stack.active
    const isInto = active.folder?.open === true
    index ??= isInto ? activeIndex(stack) : activeIndex(stack) + 1
    item.parent = parent !== undefined ? parent : isInto ? active : active.parent
    insideClipped(item, index)
    history.recordOrder(item)
    stack.layers.splice(index, 0, item)
    stack.active = item
    projection.markAllBelowStale() // "below" now has one more layer
    changed()
  }

  // A new layer or folder put at this position, between clipped ones (see isClipped in layers.ts), is clipped too, so
  // that they keep their base, as in Photoshop
  function insideClipped(item: Layer, index: number) {
    const above = stack.layers[index]
    item.clipped = above?.parent === item.parent && above.clipped
  }

  // Put the active layer, or folder, into a new folder at its place, which becomes the active one (Ctrl+G, as in
  // Photoshop). A folder that lets what is in it pass through changes nothing in the picture
  function groupActive() {
    if (isBusy()) return
    const item = stack.active
    const folder = createFolder(translate('Folder {number}', { number: ++foldersCreated }))
    folder.parent = item.parent
    folder.clipped = item.clipped
    history.recordOrder(folder)
    stack.layers.splice(activeIndex(stack) + 1, 0, folder)
    item.parent = folder
    stack.active = folder
    projection.markAllBelowStale()
    if (folder.clipped) projection.composeLayerTiles(folder) // it is clipped in place of the layer now
    changed()
  }

  // Deleting the active layer, or folder with all that is in it, must leave a layer to paint on
  function canDelete() {
    const active = stack.active
    return stack.layers.some(layer => !isFolder(layer) && layer !== active && !isInside(layer, active))
  }

  // Delete the active layer, or the active folder with all that is in it; the one under it becomes the active one, like
  // in Photoshop. The last layer can't be deleted
  function deleteLayer() {
    if (isBusy() || !canDelete()) return
    const item = stack.active
    const index = activeIndex(stack)
    const start = blockStart(stack, index)
    const before = [...stack.layers]
    history.recordOrder(item) // what is deleted stays in the undo step, with its tiles, so it can come back
    stack.layers.splice(start, index + 1 - start)
    stack.active = stack.layers[Math.max(0, start - 1)]
    projection.markAllBelowStale() // "below" now has other layers
    if (item.visible) projection.composeLayerTiles(item, before)
    projection.composeClippedTiles() // the layers clipped to it are clipped to another one now
    changed()
  }

  // Move a layer, or a folder with all that is in it, into the folder "parentId" (null: none), right above the layer
  // or folder "aboveId" in it, or at its bottom when "aboveId" is null
  function moveLayer(id: number, parentId: number | null, aboveId: number | null) {
    const item = findLayer(id)
    const parent = parentId === null ? null : findLayer(parentId)
    const above = aboveId === null ? null : findLayer(aboveId)
    if (!item || isBusy() || parent === undefined || above === undefined) return
    if (parent && (!isFolder(parent) || parent === item || isInside(parent, item))) return // not into itself
    if (above && (above.parent !== parent || above === item)) return
    const index = stack.layers.indexOf(item)
    const block = stack.layers.slice(blockStart(stack, index), index + 1)
    const rest = { layers: stack.layers.filter(layer => !block.includes(layer)), active: stack.active }
    const at = above ? rest.layers.indexOf(above) + 1 : parent ? blockStart(rest, rest.layers.indexOf(parent)) : 0
    const moved = [...rest.layers.slice(0, at), ...block, ...rest.layers.slice(at)]
    if (item.parent === parent && moved.every((layer, i) => layer === stack.layers[i])) return // already there
    history.recordOrder(item)
    stack.layers.splice(0, stack.layers.length, ...moved)
    item.parent = parent
    projection.markAllBelowStale() // "below" may have other layers now
    if (item.visible) projection.composeLayerTiles(item)
    projection.composeClippedTiles() // clipped layers may have another base now
    changed()
  }

  // Show what is in a folder in the layers panel, or not. It is no step of undo, but it is saved with the drawing
  function setFolderOpen(id: number, open: boolean) {
    const folder = findLayer(id)
    if (!folder?.folder || folder.folder.open === open) return
    folder.folder.open = open
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

  // Put a copy of the active layer above it, and make the copy the active layer. The copy shares the tiles in RAM,
  // which never change (a change makes new ones), so it costs no memory until one of them is painted. A smart object's
  // copy is a smart object too, with a source of its own sharing the same tiles. A folder's copy has copies of all
  // that is in it
  function duplicateLayer() {
    return runTask('Duplicating…', async () => {
      const original = stack.active // every tile in RAM now (see runTask)
      const index = activeIndex(stack)
      const copies = new Map<Layer, Layer>()
      for (const layer of stack.layers.slice(blockStart(stack, index), index + 1)) {
        copies.set(
          layer,
          copyOf(layer, layer === original ? translate('{name} copy', { name: layer.name }) : layer.name),
        )
      }
      for (const [layer, each] of copies) each.parent = layer === original ? layer.parent : copies.get(layer.parent!)!
      const copy = copies.get(original)!
      history.recordOrder(copy)
      stack.layers.splice(index + 1, 0, ...copies.values())
      stack.active = copy
      projection.markAllBelowStale() // "below" now has one more layer
      if (copy.visible) projection.composeLayerTiles(copy)
      return true
    })
  }

  // A copy of a layer or folder, named "name", in no folder yet
  function copyOf(layer: Layer, name: string) {
    const copy = createLayer(name, new Map(layer.tiles))
    copy.visible = layer.visible
    copy.opacity = layer.opacity
    copy.blendMode = layer.blendMode
    copy.showOffPaper = layer.showOffPaper
    copy.alphaLocked = layer.alphaLocked
    copy.clipped = layer.clipped
    if (layer.folder) copy.folder = { ...layer.folder }
    if (layer.smart) {
      const { source, bounds, corners, smooth } = layer.smart
      const ownSource = createLayer(source.name, new Map(source.tiles))
      copy.smart = { source: ownSource, bounds: { ...bounds }, corners: corners.map(p => ({ ...p })) as Quad, smooth }
    }
    return copy
  }

  // The active layer can be merged down when there is a layer under it in the same folder, both are shown (a hidden
  // layer's paint would appear or be lost), and the one under it isn't a smart object (it can't be painted on). A
  // folder that shows can always be merged into one layer
  function canMergeDown() {
    const active = stack.active
    if (isFolder(active)) return isShown(active)
    const below = siblingBelow(stack, activeIndex(stack))
    const lower = stack.layers[below]
    return below >= 0 && !isFolder(lower) && isShown(active) && lower.visible && !lower.smart
  }

  // Merge the active layer into the one under it, which becomes the active layer, as one step of undo. Its paint goes
  // on top of that layer's as it shows, at its opacity and with its blend mode (with the formulas the picture is put
  // together with, see blendModes.ts), only where its base has paint when it is clipped; the layer under keeps its own
  // opacity, blend mode and clipping, as in Photoshop. Tile by tile on the graphics card, a few every frame
  const mergeRoot = new Container() // PixiJS ignores the blend mode of what it is asked to render
  const mergeSprite = new Sprite()
  mergeRoot.addChild(mergeSprite)
  let folderPaint: RenderTexture | null = null // a folder's layers put together, as the base of a clipped layer
  function mergeDown() {
    if (!canMergeDown()) return
    if (isFolder(stack.active)) return mergeFolder()
    return runTask('Merging…', async () => {
      const upper = stack.active
      const index = activeIndex(stack)
      const lowerIndex = siblingBelow(stack, index)
      const lower = stack.layers[lowerIndex]
      const clipped = isClipped(stack, index)
      const base = clipped ? stack.layers[clipBaseIndex(stack, index)] : null
      const lowerClipped = isClipped(stack, lowerIndex)
      const hasClippedAbove = !clipped && isClipped(stack, index + 1) // it is the base of clipped layers
      const pace = createPacer()
      mergeSprite.alpha = upper.opacity
      history.startGroup()
      history.begin(lower)
      for (const key of gpu.tilesWithPaint(upper)) {
        const { column, row } = parseTileKey(key)
        const paint = gpu.getTexture(upper, column, row, false)
        if (!paint) continue
        // Clipped to a base without paint here, or hidden: none of it shows
        let mask: Texture | null | undefined
        if (base && !base.visible) mask = null
        else if (base && isFolder(base)) {
          folderPaint ??= RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE })
          projection.composeFolder(base, column, row, folderPaint)
          mask = folderPaint
        } else if (base) mask = gpu.getTexture(base, column, row, false)
        if (mask === null) continue
        history.backUpTile(key)
        const target = gpu.getTexture(lower, column, row, true)!
        if (upper.blendMode === 'normal' && !mask) {
          mergeSprite.texture = paint
          renderer.render({ container: mergeRoot, target, clear: false })
        } else {
          blender.blendOnto(target, paint, upper.opacity, upper.blendMode, mask)
        }
        gpu.markDirty(lower, key)
        await pace()
      }
      history.end()
      history.recordOrder(upper) // the merged layer stays in this step, so undo brings it back
      history.endGroup()
      stack.layers.splice(index, 1)
      stack.active = lower
      projection.markAllBelowStale() // "below" now has other layers
      // With Normal the picture looks the same. Another blend mode mixed the paint with the layer under only, and
      // where that layer doesn't cover fully, what was under it no longer takes part, as in Photoshop
      if (upper.blendMode !== 'normal') projection.composeLayerTiles(lower)
      // Paint put into a clipped layer shows only where its base has paint
      if (lowerClipped && !clipped) projection.composeLayerTiles(lower)
      if (hasClippedAbove) projection.composeClippedTiles() // the layers clipped to it are clipped to another one now
      return true
    })
  }

  // Merge the active folder into one layer in its place, as it shows when put together on its own (Ctrl+E, like
  // Photoshop's Merge Group), as one step of undo. The layer gets the folder's name, opacity, blend mode (Normal for
  // one that lets what is in it pass through) and clipping; hidden layers in it are left out
  function mergeFolder() {
    return runTask('Merging…', async () => {
      const folder = stack.active
      const index = activeIndex(stack)
      const start = blockStart(stack, index)
      const layer = createLayer(folder.name)
      layer.parent = folder.parent
      layer.opacity = folder.opacity
      layer.blendMode = folder.blendMode === 'pass-through' ? 'normal' : folder.blendMode
      layer.clipped = folder.clipped
      const keys = new Set(layersIn(folder).flatMap(inside => [...gpu.tilesWithPaint(inside)]))
      const pace = createPacer()
      history.startGroup()
      history.begin(layer)
      for (const key of keys) {
        const { column, row } = parseTileKey(key)
        history.backUpTile(key)
        projection.composeFolder(folder, column, row, gpu.getTexture(layer, column, row, true)!)
        gpu.markDirty(layer, key)
        await pace()
      }
      history.end()
      history.recordOrder(layer) // the folder and all that was in it stay in this step, so undo brings them back
      history.endGroup()
      stack.layers.splice(start, index + 1 - start, layer)
      stack.active = layer
      projection.markAllBelowStale() // "below" now has other layers
      projection.composeLayerTiles(layer) // put together on its own, the folder may look a little different
      projection.composeClippedTiles()
      return true
    })
  }

  function selectLayer(id: number) {
    const layer = findLayer(id)
    if (!layer || layer === stack.active || isBusy()) return
    stack.active = layer
    projection.markAllBelowStale() // "below" now has different layers
    changed(false) // the drawing itself didn't change
  }

  // Lock a layer's transparency, or unlock it (see layers.ts). It changes how the layer takes paint, not the drawing,
  // so it is no step of undo, but it is saved with the drawing. A folder has no paint to lock
  function setLayerAlphaLock(id: number, locked: boolean) {
    const layer = findLayer(id)
    if (!layer || isFolder(layer) || layer.alphaLocked === locked) return
    layer.alphaLocked = locked
    changed()
  }

  // Show a layer's paint off the paper, faded around the paper, or not (see outsideView.ts). It is only a way of
  // looking at the drawing, so it is no step of undo, but it is saved with the drawing
  function setLayerOffPaper(id: number, show: boolean) {
    const layer = findLayer(id)
    if (!layer || layer.showOffPaper === show) return
    layer.showOffPaper = show
    changed()
  }

  function setLayerVisible(id: number, visible: boolean) {
    const layer = findLayer(id)
    if (!layer || layer.visible === visible || isBusy()) return
    history.recordLayer(layer, propsOf(layer))
    layer.visible = visible
    projection.composeLayerTiles(layer)
    changed()
  }

  // Clip a layer or folder to the ones under it, or unclip it (see isClipped in layers.ts), as one step of undo. The
  // bottom one in a folder (or in none) has nothing to be clipped to
  function setLayerClipped(id: number, clipped: boolean) {
    const layer = findLayer(id)
    if (!layer || layer.clipped === clipped || siblingBelow(stack, stack.layers.indexOf(layer)) < 0 || isBusy()) return
    history.recordLayer(layer, propsOf(layer))
    layer.clipped = clipped
    if (layer.visible) projection.composeLayerTiles(layer)
    projection.composeClippedTiles() // the layers clipped to it may have another base now
    changed()
  }

  // Clip the active layer to the layers under it, or unclip it (Ctrl+Alt+G, as in Photoshop)
  function toggleClipped() {
    setLayerClipped(stack.active.id, !stack.active.clipped)
  }

  // Put a layer's paint onto what is under it in another way (see blendModes.ts), as one step of undo
  function setLayerBlendMode(id: number, mode: BlendMode) {
    const layer = findLayer(id)
    if (!layer || layer.blendMode === mode || isBusy()) return
    if (mode === 'pass-through' && !isFolder(layer)) return // only a folder lets what is in it pass through
    history.recordLayer(layer, propsOf(layer))
    layer.blendMode = mode
    if (layer.visible) projection.composeLayerTiles(layer)
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
    if (isShown(layer) && !projection.showOpacityLive(layer)) {
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
    if (isBusy() || stack.active.smart || isFolder(stack.active)) return
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

  // Export images this many times bigger from now on (see EXPORT_SCALES). It is kept with the drawing, but isn't a step
  // of undo
  function setExportScale(scale: number) {
    if (scale === exportScale || !EXPORT_SCALES.includes(scale)) return
    exportScale = scale
    changed()
  }

  // The drawing as an image at its full size, or enlarged (see setExportScale): each pixel a square of whole pixels,
  // with nothing blended between them, so pixel art stays sharp. The projection already has the paper and all the
  // visible layers put together, so only its tiles need to be copied
  async function exportImage(type: ImageType) {
    await nextFrame() // let the screen show that the export started before the slow part
    // Tiles still shown live, or waiting after a layer change, are not in the projection yet
    projection.finishLive()
    projection.finishWaiting()
    const scale = fitsExport(grid.width, grid.height, exportScale) ? exportScale : 1
    const canvas = document.createElement('canvas')
    canvas.width = grid.width * scale
    canvas.height = grid.height * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new LydiaError('LYD-304')
    ctx.imageSmoothingEnabled = false // enlarged, each pixel copied as a square, not blended with its neighbors
    // A tile's place and size in the image
    const drawTile = (picture: CanvasImageSource, column: number, row: number, width: number, height: number) =>
      ctx.drawImage(picture, column * TILE_SIZE * scale, row * TILE_SIZE * scale, width * scale, height * scale)
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
        const picture = renderer.extract.canvas(texture) as HTMLCanvasElement
        drawTile(picture, column, row, picture.width, picture.height)
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
      drawTile(tileCanvas, column, row, width, height) // over white paper for a JPEG
    }
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, `image/${type}`, JPEG_QUALITY))
    if (!blob) throw new LydiaError('LYD-304')
    // As many times more pixels in an inch, so that on paper it is as big as before, only sharper
    return withResolution(blob, project.dpi * scale)
  }

  // The drawing as the contents of a .lyd file. A drawing with nothing off the paper is saved the way it was before
  // layers could go off it, its tiles at the paper's edges cut there, so versions of Lydia before 0.10 can open it
  // (see projectFile.ts)
  async function saveProject() {
    // Every painted tile must be in RAM first
    while (gpu.hasUnsaved()) await nextFrame()
    const allTiles = stack.layers.flatMap(({ tiles, smart }) => (smart ? [tiles, smart.source.tiles] : [tiles]))
    const wholeTiles = allTiles.some(tiles => [...tiles].some(([key, tile]) => hasPaintOff(key, tile)))
    // A tile as it is saved: whole, or its part on the paper (null: none)
    const savedTile = (key: string, tile: StoredTile) => {
      const { column, row } = parseTileKey(key)
      const { width, height } = tileSize(grid, column, row)
      if (wholeTiles || (width === TILE_SIZE && height === TILE_SIZE)) return tile
      return toStoredTile(paperPart(memory.unpack(tile, TILE_SIZE, TILE_SIZE), width, height))
    }
    const pack = async (tiles: Map<string, StoredTile>) => {
      const packed = await Promise.all(
        [...tiles].map(async ([key, whole]) => {
          const { column, row } = parseTileKey(key)
          const tile = savedTile(key, whole)
          if (!tile) return null
          if (tile.color !== undefined) return { column, row, color: tile.color }
          return { column, row, packed: await memory.pack(tile) }
        }),
      )
      return packed.filter(tile => tile !== null)
    }
    // A smart object also keeps its source (see smartObject.ts)
    // A folder is saved with "folder", and what is in a folder with the position of the folder (see projectFile.ts)
    const layersToSave: LayerToSave[] = await Promise.all(
      stack.layers.map(async layer => ({
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        showOffPaper: layer.showOffPaper,
        alphaLocked: layer.alphaLocked,
        clipped: layer.clipped,
        folder: layer.folder && { ...layer.folder },
        parent: layer.parent ? stack.layers.indexOf(layer.parent) : undefined,
        tiles: await pack(layer.tiles),
        smart: layer.smart && {
          tiles: await pack(layer.smart.source.tiles),
          bounds: layer.smart.bounds,
          corners: layer.smart.corners,
          smooth: layer.smart.smooth,
        },
      })),
    )
    const paper = { ...project, exportScale }
    const file = serializeProject(paper, activeIndex(stack), view.getSaved(), layersToSave, wholeTiles)
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
          ? layersReference([{ tiles: layer.tiles, opacity: 1 }], memory)
          : allLayersReference()
      const { tolerance, expand } = fillSettings
      const region = await findFillRegion(grid, reference, seedX, seedY, tolerance, expand)
      const { color, opacity } = brush.settings
      return changeTiles(layer, region.keys(), (key, tile) => {
        const selected = selection ? selection.get(key) : 'full'
        if (!selected) return undefined // not selected at all
        if (layer.alphaLocked && !tile) return undefined // no paint to take the color
        const amounts = selected === 'full' ? undefined : selected
        return fillTile(grid, key, tile, region.get(key)!, color, opacity, memory, amounts, layer.alphaLocked)
      })
    })
  }

  // What the fill bucket's "All layers" looks at: the visible layers put together, without the paper, as the screen
  // puts them together. When they all go on as Normal layers (Normal, not clipped, in folders that let what is in them
  // pass through at full opacity, or in none), the processor puts them together from RAM. Otherwise blend modes,
  // clipping and folders change how they look, so the graphics card puts each tile the fill reaches together, as it
  // does for the screen, and it is read back from it (see readLayers in projection.ts); a tile where no visible layer
  // has paint is transparent, with nothing to read
  function allLayersReference(): TileReference {
    const shown = stack.layers.filter(other => !isFolder(other) && isShown(other))
    const isPlain = stack.layers.every((item, index) => {
      if (!isShown(item)) return true
      if (isClipped(stack, index)) return false
      return isFolder(item) ? item.blendMode === 'pass-through' && item.opacity === 1 : item.blendMode === 'normal'
    })
    if (isPlain) return layersReference(shown, memory)
    // Where every layer is a single color (or has nothing), all of the tile is one color, the same wherever the
    // layers have the same colors: it is read once for each such set of colors
    const colors = new Map<string, number>()
    return key => {
      const here = shown.map(other => other.tiles.get(key))
      if (here.every(tile => !tile)) return 0
      const { column, row } = parseTileKey(key)
      if (!here.every(tile => !tile || tile.color !== undefined)) return projection.readLayers(column, row, false)
      const set = here.map(tile => tile?.color ?? '').join(' ')
      let color = colors.get(set)
      if (color === undefined) {
        color = projection.readLayers(column, row, true) as number
        colors.set(set, color)
      }
      return color
    }
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
      return changeTiles(layer, keys, (key, tile) =>
        tile ? cutOut(tile, wholeTileMask(grid, key, cut.get(key)!, 255), memory) : undefined,
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
    if (isBusy() || !isShown(stack.active)) return
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
  // transformed draws itself instead. What the layer keeps off the paper shows faded meanwhile (see the ghost in
  // projection.ts). Tiles shown live would show through all that. For a folder, the pictures are of all its layers put
  // together, or of each of its layers that moves ("movers") when they can't move as one picture (see planMove in
  // projection.ts)
  async function prepareLift(
    layer: Layer,
    cut: Selection | null,
    lifted: string[],
    withPictures: boolean,
    movers: Layer[] = [layer],
  ) {
    projection.finishLive()
    outsideHidden = layer
    outside.update(layer)
    const { asOne } = projection.planMove()
    const pictured = asOne ? [layer] : movers
    const isLifted = new Set(lifted)
    const painted = new Set(isFolder(layer) ? layersIn(layer).flatMap(inside => [...gpu.tilesWithPaint(inside)]) : [])
    const offPaper = [...(isFolder(layer) ? painted : gpu.tilesWithPaint(layer))].filter(key => {
      const { column, row } = parseTileKey(key)
      return !isOnPaper(grid, column, row)
    })
    const pace = createPacer()
    for (const key of new Set([...lifted, ...(lifted.length > 0 ? offPaper : []), ...projection.paintedAbove()])) {
      for (const each of pictured) {
        await pace()
        const { column, row } = parseTileKey(key)
        const shows = isShown(each) && (!isFolder(each) || painted.has(key))
        const texture = !shows
          ? null
          : isFolder(each)
            ? folderTexture(each, column, row)
            : gpu.getTexture(each, column, row, false)
        const selected = !isLifted.has(key) ? undefined : cut ? cut.get(key) : 'full'
        // All of the tile moves when it is selected whole, and, with a selection (which is only on the paper), all of
        // it is on the paper
        const { width, height } = tileSize(grid, column, row)
        const movesWhole = selected === 'full' && (!cut || (width === TILE_SIZE && height === TILE_SIZE))
        let moving: RenderTexture | null = null
        let left: RenderTexture | null = null
        if (texture && selected && withPictures) {
          // Without a selection, a layer's tile moves whole: its texture itself is taken, which costs the graphics card
          // nothing, where a copy of each tile would make it lag behind for a few frames with a big layer. A selected
          // part, or a folder's layers put together, is a copy
          if (!cut && !isFolder(each)) moving = gpu.detach(each, column, row)
          if (!moving) {
            moving = projection.moveTexture()
            gpu.copyInto(texture, moving)
            if (cut) selectionView.cut(moving, key)
          }
        }
        if (texture && !movesWhole) {
          left = projection.moveTexture()
          gpu.copyInto(texture, left)
          if (selected && cut) selectionView.cutAway(left, key)
        }
        projection.prepareMoveTile(key, moving, left, texture !== null && selected !== undefined, each)
      }
    }
  }

  // A folder's layers put together at a tile (see composeFolder in projection.ts), in a texture reused for each tile:
  // it is copied right away
  let liftedFolder: RenderTexture | null = null
  function folderTexture(folder: Layer, column: number, row: number) {
    liftedFolder ??= RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE })
    projection.composeFolder(folder, column, row, liftedFolder)
    return liftedFolder
  }

  // Lift the selected part of the active layer, or all of it when nothing is selected, show it on its own while it is
  // dragged, and put it down where the pointer comes up (see move.ts), as one undo step together with the selection,
  // which moves along. A folder moves all its layers together, hidden ones too, as in Photoshop; the smart objects in
  // it move whole, so only when nothing is selected
  async function moveLifted(drag: MoveDrag, released: Promise<boolean>) {
    const item = stack.active
    const cut = selection
    const movers = isFolder(item) ? layersIn(item).filter(layer => !cut || !layer.smart) : [item]
    const liftedOf = (layer: Layer) => [...gpu.tilesWithPaint(layer)].filter(key => !cut || cut.has(key))
    const lifted = [...new Set(movers.flatMap(liftedOf))]
    if (lifted.length === 0) return released.then(() => false) // nothing to move
    try {
      await prepareLift(item, cut, lifted, true, movers)
      const follow = (dx: number, dy: number) => {
        projection.setMoveOffset(dx, dy)
        selectionView.setOffset(dx, dy)
      }
      projection.showMove(drag.dx, drag.dy)
      follow(drag.dx, drag.dy)
      drag.follow = follow

      const keep = await released
      projection.holdMove() // the layers change now: the screen keeps showing the move until they are put together
      const { dx, dy } = drag
      if (!keep || (dx === 0 && dy === 0)) return false
      let didChange = false
      history.startGroup()
      // The bar shows the tiles worked out in RAM as the first half of the work, and the tiles put together again as
      // the second (see endLift)
      const keysOf = movers.map(layer => movedKeys(grid, liftedOf(layer), dx, dy))
      const total = keysOf.reduce((sum, keys) => sum + keys.size, 0)
      let done = 0
      const counted = () => setProgress(++done / total / 2)
      for (const [i, layer] of movers.entries()) {
        const before = new Map(layer.tiles) // the tiles change one by one, and each new one needs the old ones
        const move = (key: string) => movedTile(grid, before, cut, key, dx, dy, memory)
        // The selection is kept once, with the first layer; a smart object keeps its corners from before
        const keep = { selection: i === 0, smart: layer.smart !== undefined }
        const moved = await changeTiles(layer, keysOf[i], move, keep, counted)
        // Moved by whole pixels, a smart object's tiles are its source drawn at its corners moved as much
        if (moved && layer.smart) {
          const corners = layer.smart.corners.map(p => ({ x: p.x + dx, y: p.y + dy })) as Quad
          layer.smart = { ...layer.smart, corners }
        }
        didChange ||= moved
      }
      history.endGroup()
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
  // The bar goes on from where the task's own work left it, as the tiles are put together
  async function endLift() {
    isMoveEnding = true
    const from = taskProgress ?? 0
    const waiting = projection.waitingCount()
    while (isMoveEnding) {
      if (waiting > 0) setProgress(from + (1 - from) * (1 - projection.waitingCount() / waiting))
      await nextFrame()
    }
    outsideHidden = null
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
    if (isBusy() || !isShown(layer) || isFolder(layer)) return
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
          const part = selectedPart(tile, cut ? wholeTileMask(grid, key, selected, 255) : selected, memory)
          if (part) tiles.set(key, part)
        }
        const bounds = paintBounds(tiles, memory)
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
  // the paper keeps its size, going past the paper (decision 49); only one bigger than the biggest paper is made
  // smaller, to fit in it. The image is closed afterwards
  function placeImage(image: ImageBitmap, name: string, at: Point) {
    if (isBusy()) {
      image.close()
      return
    }
    const layer = stack.active
    return runTask('Placing…', async () => {
      let fitted = image
      try {
        const scale = Math.min(1, MAX_SIZE / image.width, MAX_SIZE / image.height)
        if (scale < 1) {
          fitted = await createImageBitmap(image, {
            resizeWidth: Math.max(1, Math.min(MAX_SIZE, Math.round(image.width * scale))),
            resizeHeight: Math.max(1, Math.min(MAX_SIZE, Math.round(image.height * scale))),
            resizeQuality: 'high',
          })
        }
        const pace = createPacer()
        const tiles = await imageTiles(fitted, pace)
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
    const view = createSmartView(renderer, gpu, object)
    for (const key of view.blocks) {
      await pace()
      view.addBlock(key)
    }
    await prepareLift(started.layer, started.cut, lifted, false)
    // A selected part, or an image, goes into a new layer above (see applyTransform)
    const isNewLayer = started.kind === 'part' || started.kind === 'image'
    projection.setMoveContent(view.container, view.faded, view, isNewLayer)
    projection.showMove(0, 0)
    transform = { ...started, corners: object.corners, smooth: object.smooth, view }
  }

  // The handles moved (see view.ts). Corners that would fold the object over itself are left out
  function setTransformCorners(corners: Quad) {
    if (!transform || !isValidQuad(corners)) return
    transform.corners = corners
    transform.view.setCorners(corners)
    projection.moveChanged()
  }

  function setTransformSmooth(smooth: boolean) {
    if (!transform) return
    transform.smooth = smooth
    smoothTransforms = smooth
    transform.view.setSmooth(smooth)
    projection.moveChanged()
    changed(false)
  }

  // Esc: everything stays as it was
  function cancelTransform() {
    const ended = transform
    if (!ended) return
    transform = null
    projection.endMove()
    ended.view.destroy()
    outsideHidden = null
    changed(false)
  }

  // Enter: draw the object at its new corners into its layer, as one undo step. A layer becomes a smart object; a
  // selected part leaves its layer and goes into a new layer above it as one, which becomes the active layer, and so
  // does an image
  function applyTransform() {
    const done = transform
    if (!done) return
    transform = null // the handles go, and the work can start
    projection.holdMove()
    const { layer, kind, view, cut } = done
    const object: SmartObject = { ...done.object, corners: done.corners, smooth: done.smooth }
    return runTask('Transforming…', async () => {
      let target = layer
      history.startGroup()
      try {
        if (kind === 'part' && cut) {
          const keys = [...cut.keys()].filter(key => layer.tiles.has(key))
          await changeTiles(layer, keys, (key, tile) =>
            tile ? cutOut(tile, wholeTileMask(grid, key, cut.get(key)!, 255), memory) : undefined,
          )
          history.recordSelection()
          selection = null
        }
        if (kind === 'part' || kind === 'image') {
          // The new layer goes above, and becomes the active layer only once the transform stops showing: until then
          // the projection keeps putting tiles together with the same layers under the active one as what it shows
          target = createLayer(done.name ?? translate('Layer {number}', { number: ++layersCreated }))
          target.parent = layer.parent
          insideClipped(target, stack.layers.indexOf(layer) + 1)
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
    offPaperStale = true
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

  // ----- The brush's outline -----

  // Show the outline of the brush's tip under the pointer, or the cursor's cross (see view.ts)
  function setBrushOutline(on: boolean) {
    view.setBrushOutline(on)
  }

  // ----- The stabilizer -----

  // How strokes are smoothed (see stabilizer.ts)
  function setStabilizer(settings: StabilizerSettings) {
    view.setStabilizer(settings)
  }

  function destroy() {
    resizeObserver.disconnect()
    app.ticker.remove(backgroundWork)
    app.ticker.remove(followZoom)
    pixelGrid.destroy()
    outside.destroy()
    transform?.view.destroy()
    selectionView.destroy()
    checkers?.texture.destroy(true)
    view.destroy()
    brush.destroy()
    projection.destroy()
    blender.destroy()
    gpu.destroy()
    memory.destroy()
    app.destroy(KEEP_GLOBAL_RESOURCES, { children: true })
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
    setBrushOutline,
    setStabilizer,
    setBackdrop,
    undo,
    redo,
    clearLayer,
    addLayer,
    addFolder,
    addLayerOutside,
    groupActive,
    deleteLayer,
    moveLayer,
    setFolderOpen,
    renameLayer,
    selectLayer,
    setLayerVisible,
    setLayerOffPaper,
    setLayerAlphaLock,
    setLayerBlendMode,
    setLayerClipped,
    toggleClipped,
    duplicateLayer,
    mergeDown,
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
    setExportScale,
    exportImage,
    saveProject,
    destroy,
    // The engine's parts, to inspect them from the browser's console while developing (see DrawSpace)
    inspect: () => ({ app, stack, gpu, projection, history, memory, brush, world, pixelGrid, selectionView }),
  }

  return engine
}

export type Engine = Awaited<ReturnType<typeof createEngine>>
