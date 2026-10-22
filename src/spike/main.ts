import { Application, BufferImageSource, Container, Graphics, RenderTexture, Sprite, Texture } from 'pixi.js'

const PROJECT_WIDTH = 10000
const PROJECT_HEIGHT = 10000
const MIN_ZOOM = 0.01 // 1% (zoomed far out)
const MAX_ZOOM = 32 // 3200% (each project pixel is 32 screen pixels)
const TILE_SIZE = 256 // each layer is a grid of tiles of this size, created only where there is paint
const BRUSH_HARDNESS = 0.5 // 0 = very soft edge, 1 = hard edge
const BRUSH_SPACING = 0.1 // distance between dabs, as a fraction of the brush size

// The brush tip: a white circle that fades out at the edge. Every dab is this image, tinted and resized
function createBrushTip(hardness: number) {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(hardness, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return Texture.from(canvas)
}

type Dab = { x: number; y: number; size: number }

async function main() {
  const app = new Application()
  await app.init({
    resizeTo: window,
    background: '#808080',
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  })
  document.body.appendChild(app.canvas)

  // Everything that belongs to the drawing lives inside "world"; zoom and pan move this container
  const world = new Container()
  app.stage.addChild(world)

  // Show the whole project, centered, with a small margin around it
  function fitToScreen() {
    const scale = Math.min(app.screen.width / PROJECT_WIDTH, app.screen.height / PROJECT_HEIGHT) * 0.9
    world.scale.set(scale)
    world.position.set((app.screen.width - PROJECT_WIDTH * scale) / 2, (app.screen.height - PROJECT_HEIGHT * scale) / 2)
  }
  fitToScreen()

  // Zoom keeping the point under the cursor in the same place on the screen
  function zoomAt(screenX: number, screenY: number, factor: number) {
    const oldScale = world.scale.x
    const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldScale * factor))

    // Which point of the project is under the cursor right now
    const projectX = (screenX - world.position.x) / oldScale
    const projectY = (screenY - world.position.y) / oldScale

    // After scaling, move the world so that the same project point is under the cursor again
    world.scale.set(newScale)
    world.position.set(screenX - projectX * newScale, screenY - projectY * newScale)
  }

  // Mouse wheel / trackpad: Ctrl + wheel (or pinch on a trackpad) zooms, the wheel alone moves the view
  app.canvas.addEventListener(
    'wheel',
    e => {
      e.preventDefault() // stop the browser from scrolling or zooming the page itself
      const pixels = e.deltaMode === 1 ? 16 : 1 // some browsers report the wheel in lines instead of pixels
      if (e.ctrlKey) {
        zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * pixels * 0.002))
      } else {
        world.position.x -= e.deltaX * pixels
        world.position.y -= e.deltaY * pixels
      }
    },
    { passive: false },
  )

  // Pan by dragging with the middle mouse button, or with the left button while holding Space
  let isSpaceDown = false
  let panStart: { x: number; y: number } | null = null

  window.addEventListener('keydown', e => {
    if (e.code === 'Space') isSpaceDown = true
    // Ctrl/Cmd + 0 shows the whole project again, like in Photoshop
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault()
      fitToScreen()
    }
  })
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') isSpaceDown = false
  })

  app.canvas.addEventListener('pointerdown', e => {
    const isPan = e.button === 1 || (e.button === 0 && isSpaceDown)
    if (!isPan) return
    e.preventDefault() // the middle button would otherwise start the browser's auto-scroll
    panStart = { x: e.clientX - world.position.x, y: e.clientY - world.position.y }
    app.canvas.setPointerCapture(e.pointerId) // keep receiving the moves even if the pointer leaves the canvas
  })
  app.canvas.addEventListener('pointermove', e => {
    if (!panStart) return
    world.position.set(e.clientX - panStart.x, e.clientY - panStart.y)
  })
  app.canvas.addEventListener('pointerup', () => {
    panStart = null
  })

  // ----- Layers: pixels in RAM, with a cache on the graphics card -----

  // The pixels of every layer live in RAM (the "shelf"), which is much bigger than the graphics card's memory. The
  // graphics card (the "desk") only keeps copies of the tiles it needs right now, up to GPU_CACHE_TILES. A tile painted
  // on the graphics card is "dirty" until its pixels are read back into RAM
  const GPU_CACHE_TILES = 2000 // about 500 MB of graphics card memory for layer tiles
  const COLUMNS = Math.ceil(PROJECT_WIDTH / TILE_SIZE)
  const ROWS = Math.ceil(PROJECT_HEIGHT / TILE_SIZE)

  type Layer = {
    id: number
    // "column,row" -> the tile's pixels in RAM. Pixels are never changed, only replaced by new ones, so the undo
    // history can keep them without copying. Tiles without paint are not stored at all
    tiles: Map<string, Uint8ClampedArray>
    visible: boolean
    opacity: number // from 0 (invisible) to 1
    blendMode: 'normal' | 'multiply'
  }
  const layers: Layer[] = [] // from the bottom to the top
  let nextLayerId = 1

  // Add an empty layer on top of all the others
  function addLayer() {
    const layer: Layer = { id: nextLayerId++, tiles: new Map(), visible: true, opacity: 1, blendMode: 'normal' }
    layers.push(layer)
    return layer
  }
  let activeLayer = addLayer() // the layer the brush paints on

  // Call "callback" for every tile of the paper
  function forEachTile(callback: (column: number, row: number) => void) {
    for (let column = 0; column < COLUMNS; column++) {
      for (let row = 0; row < ROWS; row++) callback(column, row)
    }
  }

  const emptyContainer = new Container()
  function clearTexture(texture: RenderTexture) {
    app.renderer.render({ container: emptyContainer, target: texture, clear: true })
  }

  // Create a transparent texture on the graphics card for the tile at this column and row. The last column and row are
  // cut at the edge of the paper (10000 is not a multiple of 256)
  function createTexture(column: number, row: number) {
    const width = Math.min(TILE_SIZE, PROJECT_WIDTH - column * TILE_SIZE)
    const height = Math.min(TILE_SIZE, PROJECT_HEIGHT - row * TILE_SIZE)
    const texture = RenderTexture.create({ width, height })
    clearTexture(texture)
    return texture
  }

  // ----- Moving pixels between RAM and the graphics card -----

  const copySprite = new Sprite() // reused to draw one texture into another
  const stagingTextures = new Map<string, Texture>() // one per tile size, reused to send pixels to the graphics card
  let uploadCount = 0
  let readBackCount = 0

  // Draw one texture into another, inside the graphics card
  function copyInto(source: Texture, target: RenderTexture) {
    copySprite.texture = source
    app.renderer.render({ container: copySprite, target, clear: true })
  }

  // Send a tile's pixels from RAM to a texture on the graphics card (fast)
  function upload(pixels: Uint8ClampedArray, target: RenderTexture) {
    const size = `${target.width}x${target.height}`
    let staging = stagingTextures.get(size)
    if (!staging) {
      // The pixels came from the graphics card already multiplied by their alpha ("premultiplied"): send them as they are
      const source = new BufferImageSource({
        resource: pixels,
        width: target.width,
        height: target.height,
        format: 'rgba8unorm',
        alphaMode: 'premultiplied-alpha',
      })
      staging = new Texture({ source })
      stagingTextures.set(size, staging)
    } else {
      staging.source.resource = pixels
      staging.source.update() // tell PixiJS to send the new pixels the next time the texture is used
    }
    copyInto(staging, target)
    uploadCount++
  }

  // Read a tile's pixels back from the graphics card into RAM (slow: the graphics card has to finish its work first).
  // Returns null when the tile is completely transparent, so empty tiles take no memory at all
  function readBack(texture: RenderTexture) {
    const { pixels } = app.renderer.extract.pixels(texture)
    readBackCount++
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] !== 0) return pixels
    }
    return null
  }

  // ----- The graphics card cache -----

  type CachedTile = { layer: Layer; key: string; texture: RenderTexture; dirty: boolean }
  // "layerId/column,row" -> the tile's copy on the graphics card. A Map remembers the order in which keys were added, so
  // moving a tile to the end every time it is used keeps the least recently used tiles at the start
  const gpuTiles = new Map<string, CachedTile>()

  // Get the copy of a layer's tile on the graphics card, sending it from RAM if needed.
  // Returns null when the tile has no paint and "create" is false
  function getGpuTile(layer: Layer, column: number, row: number, create: boolean) {
    const key = `${column},${row}`
    const id = `${layer.id}/${key}`
    let cached = gpuTiles.get(id)
    if (cached) {
      gpuTiles.delete(id) // it goes back in at the end: it is now the most recently used tile
    } else {
      const pixels = layer.tiles.get(key)
      if (!pixels && !create) return null
      const texture = createTexture(column, row)
      if (pixels) upload(pixels, texture)
      cached = { layer, key, texture, dirty: false }
    }
    gpuTiles.set(id, cached)
    return cached.texture
  }

  const dirtyTiles = new Set<CachedTile>() // painted tiles whose latest pixels are only on the graphics card

  // Painting on a tile makes its copy on the graphics card newer than RAM
  function markDirty(layer: Layer, key: string) {
    const cached = gpuTiles.get(`${layer.id}/${key}`)!
    cached.dirty = true
    dirtyTiles.add(cached)
  }

  // Read a painted tile back into RAM, so RAM has its latest pixels
  function saveTile(cached: CachedTile) {
    const pixels = readBack(cached.texture)
    if (pixels) cached.layer.tiles.set(cached.key, pixels)
    else cached.layer.tiles.delete(cached.key)
    cached.dirty = false
    dirtyTiles.delete(cached)
  }

  // Before using a tile's pixels in RAM, make sure they are the latest ones
  function saveIfDirty(layer: Layer, key: string) {
    const cached = gpuTiles.get(`${layer.id}/${key}`)
    if (cached?.dirty) saveTile(cached)
  }

  // Free graphics card memory: remove the least recently used tiles until the cache fits its budget again.
  // Painted tiles are read back into RAM first, so nothing is lost
  function trimGpuCache() {
    for (const [id, cached] of gpuTiles) {
      if (gpuTiles.size <= GPU_CACHE_TILES) break
      if (cached.dirty) saveTile(cached)
      cached.texture.destroy(true)
      gpuTiles.delete(id)
    }
  }

  // ----- Projection -----

  // The projection is the only thing drawn on the screen: one grid of tiles covering the whole paper, with the white
  // paper and all the visible layers already put together, like Krita does. To put a tile together quickly while
  // painting, "below" keeps the paper and every layer under the active one already put together as well, so only the
  // active layer and the layers above it need to be added
  const projection = new Map<string, RenderTexture>() // "column,row" -> the tile's texture
  const below = new Map<string, RenderTexture>()
  const projectionContainer = new Container() // holds one sprite per projection tile
  world.addChild(projectionContainer)

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
      const layer = layers[i]
      if (!layer.visible) continue
      const texture = getGpuTile(layer, column, row, false)
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
    app.renderer.render({ container: composeRoot, target, clear: true })
    trimGpuCache()
  }

  // The projection tile = the "below" tile + the active layer + the layers above it
  function composeTile(column: number, row: number) {
    const key = `${column},${row}`
    if (staleBelow.delete(key)) composeBelowTile(column, row) // delete() returns true if the key was in the set
    belowSprite.texture = below.get(key)!
    composeLayers(belowSprite, layers.indexOf(activeLayer), layers.length, column, row, projection.get(key)!)
  }

  // The "below" tile = the paper + every layer under the active one
  function composeBelowTile(column: number, row: number) {
    composeLayers(paperTile, 0, layers.indexOf(activeLayer), column, row, below.get(`${column},${row}`)!)
  }

  // Put the whole projection together again (after changing the active layer's visibility, opacity or blend mode)
  function composeAll() {
    const start = performance.now()
    const uploadsBefore = uploadCount
    forEachTile(composeTile)
    const uploads = uploadCount - uploadsBefore
    console.log(
      `Composed the whole projection in ${Math.round(performance.now() - start)} ms (${uploads} tiles sent from RAM)`,
    )
  }

  // Create the tiles of the projection (with one sprite each) and of "below", and show the empty paper
  forEachTile((column, row) => {
    const key = `${column},${row}`
    below.set(key, createTexture(column, row))
    staleBelow.add(key)
    const texture = createTexture(column, row)
    projection.set(key, texture)
    const sprite = new Sprite(texture)
    sprite.position.set(column * TILE_SIZE, row * TILE_SIZE)
    projectionContainer.addChild(sprite)
  })
  composeAll()

  // Zoomed in, show each pixel as a sharp square (like Photoshop and Krita); zoomed out, blend pixels smoothly
  let tileScaleMode: 'nearest' | 'linear' = 'linear'
  app.ticker.add(() => {
    const scaleMode = world.scale.x >= 1 ? 'nearest' : 'linear'
    if (scaleMode === tileScaleMode) return
    tileScaleMode = scaleMode
    for (const texture of projection.values()) {
      texture.source.scaleMode = scaleMode
      texture.source.style.update() // tell PixiJS the setting changed, so the graphics card uses it
    }
  })

  // ----- Undo -----

  // Each undo step keeps the layer that was painted on and, for every tile the stroke touched, the tile's pixels in RAM
  // from before the stroke (null = the tile had no paint). Pixels are never changed, so no copy is needed
  type UndoStep = { layer: Layer; tiles: Map<string, Uint8ClampedArray | null> }
  const undoStack: UndoStep[] = []
  const redoStack: UndoStep[] = []
  let strokeBackup: UndoStep | null = null // the step being recorded while the user paints
  const MAX_UNDO_TILES = 2000 // tiles kept for undo and redo: about 500 MB of RAM

  // Before a stroke paints on a tile for the first time, keep its pixels from before the stroke
  function backUpTile(key: string) {
    if (!strokeBackup || strokeBackup.tiles.has(key)) return // not painting, or already saved during this stroke
    saveIfDirty(strokeBackup.layer, key)
    strokeBackup.tiles.set(key, strokeBackup.layer.tiles.get(key) ?? null)
  }

  // How many tiles with pixels a step keeps (tiles that had no paint cost nothing)
  function countCopies(step: UndoStep) {
    let count = 0
    for (const pixels of step.tiles.values()) if (pixels) count++
    return count
  }

  // Put the saved pixels back into the layer, and keep in the step what the layer had instead.
  // That way the same step works in both directions: undo swaps it once, redo swaps it back
  function swapTiles(step: UndoStep) {
    const start = performance.now()
    const isBelowActive = layers.indexOf(step.layer) < layers.indexOf(activeLayer)
    for (const [key, saved] of step.tiles) {
      const [column, row] = key.split(',').map(Number)
      saveIfDirty(step.layer, key)
      const current = step.layer.tiles.get(key) ?? null
      if (saved) step.layer.tiles.set(key, saved)
      else step.layer.tiles.delete(key)
      step.tiles.set(key, current)

      // If the graphics card has a copy of this tile, update it too
      const cached = gpuTiles.get(`${step.layer.id}/${key}`)
      if (cached) {
        if (saved) upload(saved, cached.texture)
        else clearTexture(cached.texture)
      }

      // A layer under the active one is part of "below", so that tile must be put together again too
      if (isBelowActive) staleBelow.add(key)
      composeTile(column, row)
    }
    console.log(`Swapped ${step.tiles.size} tiles in ${Math.round(performance.now() - start)} ms`)
  }

  function undo() {
    const step = undoStack.pop()
    if (!step) return // nothing to undo
    swapTiles(step)
    redoStack.push(step)
  }

  function redo() {
    const step = redoStack.pop()
    if (!step) return // nothing to redo
    swapTiles(step)
    undoStack.push(step)
  }

  // Add a finished stroke to the history
  function addUndoStep(step: UndoStep) {
    undoStack.push(step)

    // After a new stroke, the steps that were undone can't be redone anymore
    redoStack.length = 0

    // When the history takes too much memory, forget the oldest steps (but always keep the newest one)
    let copyCount = 0
    for (const s of undoStack) copyCount += countCopies(s)
    while (copyCount > MAX_UNDO_TILES && undoStack.length > 1) {
      copyCount -= countCopies(undoStack.shift()!)
    }
  }

  // ----- Brush -----

  const brushTip = createBrushTip(BRUSH_HARDNESS)
  let brushSize = 40
  let brushColor = '#000000'
  let isErasing = false

  // The dabs of one pointer event are put in "stamp" and rendered once into each tile they touch
  const stampRoot = new Container()
  const stamp = new Container()
  stampRoot.addChild(stamp)
  const dabSprites: Sprite[] = [] // reused between events instead of creating new sprites every time

  function paintDabs(dabs: Dab[]) {
    stamp.removeChildren()
    const touchedTiles = new Set<string>()

    dabs.forEach((dab, i) => {
      let sprite = dabSprites[i]
      if (!sprite) {
        sprite = new Sprite(brushTip)
        sprite.anchor.set(0.5) // position the dab by its center
        dabSprites[i] = sprite
      }
      sprite.position.set(dab.x, dab.y)
      sprite.width = dab.size
      sprite.height = dab.size
      sprite.tint = brushColor
      sprite.blendMode = isErasing ? 'erase' : 'normal' // the eraser removes paint from the tile instead of adding it
      stamp.addChild(sprite)

      // The part of the dab that is on the paper (the rest is cut off)
      const radius = dab.size / 2
      const left = Math.max(0, dab.x - radius)
      const right = Math.min(PROJECT_WIDTH, dab.x + radius)
      const top = Math.max(0, dab.y - radius)
      const bottom = Math.min(PROJECT_HEIGHT, dab.y + radius)
      if (left >= right || top >= bottom) return // the dab is entirely outside the paper

      // Which tiles does that part cover?
      const firstColumn = Math.floor(left / TILE_SIZE)
      const lastColumn = Math.ceil(right / TILE_SIZE) - 1
      const firstRow = Math.floor(top / TILE_SIZE)
      const lastRow = Math.ceil(bottom / TILE_SIZE) - 1
      for (let column = firstColumn; column <= lastColumn; column++) {
        for (let row = firstRow; row <= lastRow; row++) {
          touchedTiles.add(`${column},${row}`)
        }
      }
    })

    // Render all the dabs into each touched tile, shifted so that the tile's corner is at (0, 0)
    for (const key of touchedTiles) {
      const [column, row] = key.split(',').map(Number)
      backUpTile(key)
      stamp.position.set(-column * TILE_SIZE, -row * TILE_SIZE)
      app.renderer.render({ container: stampRoot, target: getGpuTile(activeLayer, column, row, true)!, clear: false })
      markDirty(activeLayer, key)
      composeTile(column, row)
    }
  }

  // Where the last dab was placed, and how far the pointer moved since then
  let lastPoint: { x: number; y: number } | null = null
  let distanceSinceLastDab = 0
  let drawingPointerId: number | null = null

  // Convert a position on the screen into a position on the project, taking zoom and pan into account
  function toProject(e: PointerEvent) {
    const rect = app.canvas.getBoundingClientRect()
    return world.toLocal({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  // The pen's pressure makes the brush bigger or smaller; the mouse always paints at full size
  function sizeFor(e: PointerEvent) {
    return brushSize * (e.pointerType === 'pen' ? e.pressure : 1)
  }

  // Place dabs along the line from the last point to this one, one every "spacing" pixels
  function strokeTo(x: number, y: number, size: number, dabs: Dab[]) {
    if (!lastPoint) return
    const spacing = Math.max(1, size * BRUSH_SPACING)
    const dx = x - lastPoint.x
    const dy = y - lastPoint.y
    const distance = Math.hypot(dx, dy)
    if (distance === 0) return

    let along = spacing - distanceSinceLastDab // how far along the line the next dab goes
    while (along <= distance) {
      dabs.push({ x: lastPoint.x + (dx * along) / distance, y: lastPoint.y + (dy * along) / distance, size })
      along += spacing
    }
    distanceSinceLastDab = distance - (along - spacing)
    lastPoint = { x, y }
  }

  app.canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 || isSpaceDown || drawingPointerId !== null) return
    drawingPointerId = e.pointerId
    app.canvas.setPointerCapture(e.pointerId)

    const point = toProject(e)
    lastPoint = { x: point.x, y: point.y }
    distanceSinceLastDab = 0
    strokeBackup = { layer: activeLayer, tiles: new Map() } // start recording the tiles this stroke changes
    paintDabs([{ x: point.x, y: point.y, size: sizeFor(e) }])
  })

  app.canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== drawingPointerId) return
    const dabs: Dab[] = []
    for (const ev of e.getCoalescedEvents?.() ?? [e]) {
      const point = toProject(ev)
      strokeTo(point.x, point.y, sizeFor(ev), dabs)
    }
    if (dabs.length > 0) paintDabs(dabs)
  })

  app.canvas.addEventListener('pointerup', e => {
    if (e.pointerId !== drawingPointerId) return
    drawingPointerId = null
    lastPoint = null
    // A click outside the paper changes no tiles: an empty step would make Ctrl+Z seem to do nothing
    if (strokeBackup && strokeBackup.tiles.size > 0) {
      console.log(`Stroke changed ${strokeBackup.tiles.size} tiles, ${undoStack.length + 1} undo steps`)
      addUndoStep(strokeBackup)
    }
    strokeBackup = null
  })

  // Painted tiles are read back into RAM a few at a time between frames, using at most SAVE_BUDGET_MS of each frame,
  // so letting go of the pen doesn't freeze the screen. Nothing is saved while painting
  const SAVE_BUDGET_MS = 4
  let savedCount = 0
  let saveStart = 0
  app.ticker.add(() => {
    if (drawingPointerId !== null || dirtyTiles.size === 0) return
    if (savedCount === 0) saveStart = performance.now()
    const frameStart = performance.now()
    for (const cached of dirtyTiles) {
      if (performance.now() - frameStart > SAVE_BUDGET_MS) break
      saveTile(cached)
      savedCount++
    }
    if (dirtyTiles.size > 0) return
    const time = Math.round(performance.now() - saveStart)
    console.log(`Saved ${savedCount} tiles to RAM in the background, over ${time} ms`)
    savedCount = 0
  })

  // Ctrl/Cmd + Z undoes; Ctrl/Cmd + Shift + Z or Ctrl + Y redoes, like in Photoshop and Krita
  window.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return
    const key = e.key.toLowerCase()
    const isUndo = key === 'z' && !e.shiftKey
    const isRedo = (key === 'z' && e.shiftKey) || key === 'y'
    if (!isUndo && !isRedo) return
    e.preventDefault() // stop the browser from using the shortcut itself
    if (drawingPointerId !== null) return // not in the middle of a stroke
    if (isUndo) undo()
    else redo()
  })

  // ----- Layer controls and stress test -----

  // Show the layers in the console, from the top to the bottom, and how much memory they use.
  // Each tile is 256 × 256 pixels × 4 bytes = 256 KB, so 4 tiles are about 1 MB
  function logLayers() {
    let ramTiles = 0
    const lines = layers.map((layer, i) => {
      ramTiles += layer.tiles.size
      const { opacity, blendMode, visible } = layer
      const marker = layer === activeLayer ? '>' : ' '
      return `${marker} Layer ${i + 1}: ${layer.tiles.size} tiles, opacity ${opacity}, ${blendMode}${visible ? '' : ', hidden'}`
    })
    let undoTiles = 0
    for (const step of [...undoStack, ...redoStack]) undoTiles += countCopies(step)
    const gpuTileCount = gpuTiles.size + projection.size + below.size
    console.log(
      `${lines.reverse().join('\n')}\n` +
        `RAM: ${ramTiles} layer tiles (~${Math.round(ramTiles / 4)} MB) + ${undoTiles} undo tiles (~${Math.round(undoTiles / 4)} MB)\n` +
        `Graphics card: ${gpuTiles.size} cached layer tiles + ${projection.size} projection + ${below.size} below ` +
        `(~${Math.round(gpuTileCount / 4)} MB)\n` +
        `So far: ${uploadCount} tiles sent from RAM, ${readBackCount} read back into RAM`,
    )
  }
  logLayers()

  // Stress test: fill every tile of the active layer with the brush color, as if the whole layer had been painted
  const fillRect = new Graphics().rect(0, 0, TILE_SIZE, TILE_SIZE).fill(0xffffff)
  function fillActiveLayer() {
    if (drawingPointerId !== null) return // not in the middle of a stroke
    const start = performance.now()
    fillRect.tint = brushColor
    strokeBackup = { layer: activeLayer, tiles: new Map() } // filling can be undone like a stroke
    forEachTile((column, row) => {
      const key = `${column},${row}`
      backUpTile(key)
      app.renderer.render({ container: fillRect, target: getGpuTile(activeLayer, column, row, true)!, clear: false })
      markDirty(activeLayer, key)
      composeTile(column, row)
    })
    console.log(`Filled the layer in ${Math.round(performance.now() - start)} ms`)
    addUndoStep(strokeBackup)
    strokeBackup = null
    logLayers()
  }

  // N adds a layer on top; the arrows choose the active layer; H hides or shows it; O changes its opacity;
  // M switches it between normal and multiply; F fills it (to test many full layers)
  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || drawingPointerId !== null) return
    const layer = activeLayer
    if (e.key === 'n') {
      // The new layer goes on top, so everything on the screen is now below it: "below" becomes a copy of the projection
      activeLayer = addLayer()
      for (const [key, texture] of projection) copyInto(texture, below.get(key)!)
      staleBelow.clear()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const index = layers.indexOf(activeLayer) + (e.key === 'ArrowUp' ? 1 : -1)
      if (index < 0 || index >= layers.length) return // already at the top or bottom
      activeLayer = layers[index]
      for (const key of below.keys()) staleBelow.add(key) // "below" now has different layers
    } else if (e.key === 'f') return fillActiveLayer()
    else {
      // These change how the active layer looks, so the whole projection must be put together again
      if (e.key === 'h') layer.visible = !layer.visible
      else if (e.key === 'o') layer.opacity = layer.opacity === 1 ? 0.5 : layer.opacity === 0.5 ? 0.25 : 1
      else if (e.key === 'm') layer.blendMode = layer.blendMode === 'multiply' ? 'normal' : 'multiply'
      else return // not a layer key
      composeAll()
    }
    logLayers()
  })

  // ----- Export -----

  // Put the image together at the full size of the project and encode it as PNG. The projection already has the paper
  // and all the visible layers put together, so only its tiles need to be copied
  async function renderPng() {
    const assembleStart = performance.now()
    const canvas = document.createElement('canvas')
    canvas.width = PROJECT_WIDTH
    canvas.height = PROJECT_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This image is too big for this browser.')

    // Copy each projection tile from the graphics card back to a normal canvas, at its place in the image
    for (const [key, texture] of projection) {
      const [column, row] = key.split(',').map(Number)
      const tileCanvas = app.renderer.extract.canvas(texture) as HTMLCanvasElement
      ctx.drawImage(tileCanvas, column * TILE_SIZE, row * TILE_SIZE)
    }
    const tileCount = projection.size

    const encodeStart = performance.now()
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('This image is too big for this browser.')

    // Spike measurements: how long each part took and how big the file is
    console.log(
      `Export: ${tileCount} tiles, assembled in ${Math.round(encodeStart - assembleStart)} ms, ` +
        `PNG encoded in ${Math.round(performance.now() - encodeStart)} ms, ${(blob.size / 1024 / 1024).toFixed(1)} MB`,
    )
    return blob
  }

  async function exportPng() {
    try {
      const blob = await renderPng()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'lydia-spike.png'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url))
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not export the image.')
    }
  }

  // [ and ] change the brush size, like in Photoshop and Krita; 1, 2 and 3 pick a color
  window.addEventListener('keydown', e => {
    if (e.key === '[') brushSize = Math.max(1, brushSize / 1.25)
    if (e.key === ']') brushSize = Math.min(2000, brushSize * 1.25)
    if (e.key === '1') brushColor = '#000000'
    if (e.key === '2') brushColor = '#e63946'
    if (e.key === '3') brushColor = '#457b9d'
    // B for the brush and E for the eraser, like in Photoshop and Krita
    if (e.key === 'b') isErasing = false
    if (e.key === 'e') isErasing = true
    // P exports the drawing as a PNG image
    if (e.key === 'p') exportPng()
  })
}

main()
