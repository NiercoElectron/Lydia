import { Application, Container, Graphics, RenderTexture, Sprite, Texture } from 'pixi.js'

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

  // ----- Layers made of tiles -----

  // A layer is a transparent sheet made of tiles that are created only where there is paint.
  // Layers are not drawn on the screen directly: they are put together into the projection (below)
  type Layer = {
    tiles: Map<string, RenderTexture> // "column,row" -> the tile's texture
    visible: boolean
    opacity: number // from 0 (invisible) to 1
    blendMode: 'normal' | 'multiply'
  }
  const layers: Layer[] = [] // from the bottom to the top

  // Add an empty layer on top of all the others
  function addLayer() {
    const layer: Layer = { tiles: new Map(), visible: true, opacity: 1, blendMode: 'normal' }
    layers.push(layer)
    return layer
  }
  let activeLayer = addLayer() // the layer the brush paints on

  // Create a transparent tile, cut at the edge of the paper (10000 is not a multiple of 256)
  function createTile(column: number, row: number) {
    const width = Math.min(TILE_SIZE, PROJECT_WIDTH - column * TILE_SIZE)
    const height = Math.min(TILE_SIZE, PROJECT_HEIGHT - row * TILE_SIZE)
    const texture = RenderTexture.create({ width, height })
    app.renderer.render({ container: new Container(), target: texture, clear: true }) // start fully transparent
    return texture
  }

  // Get the tile of this layer at this column and row, creating it the first time it is painted on
  function getTile(layer: Layer, column: number, row: number) {
    const key = `${column},${row}`
    let texture = layer.tiles.get(key)
    if (!texture) {
      texture = createTile(column, row)
      layer.tiles.set(key, texture)
    }
    return texture
  }

  // ----- Projection -----

  // The projection is the only thing drawn on the screen: one grid of tiles covering the whole paper, with the white
  // paper and all the visible layers already put together, like Krita does. The screen draws the same 1600 tiles
  // every frame no matter how many layers there are, and only the tiles that change are put together again
  const COLUMNS = Math.ceil(PROJECT_WIDTH / TILE_SIZE)
  const ROWS = Math.ceil(PROJECT_HEIGHT / TILE_SIZE)
  const projection = new Map<string, RenderTexture>() // "column,row" -> the tile's texture
  const projectionContainer = new Container() // holds one sprite per projection tile
  world.addChild(projectionContainer)

  // A tile is put together in "composeRoot": the white paper, then the tile of each visible layer, bottom to top
  const composeRoot = new Container()
  const paperTile = new Graphics().rect(0, 0, TILE_SIZE, TILE_SIZE).fill(0xffffff)
  const layerSprites: Sprite[] = [] // reused between tiles instead of creating new sprites every time

  function composeTile(column: number, row: number) {
    const key = `${column},${row}`
    composeRoot.removeChildren()
    composeRoot.addChild(paperTile)
    let count = 0
    for (const layer of layers) {
      const texture = layer.tiles.get(key)
      if (!layer.visible || !texture) continue
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
    app.renderer.render({ container: composeRoot, target: projection.get(key)!, clear: true })
  }

  // Put the whole projection together again (after changing a layer's visibility, opacity or blend mode)
  function composeAll() {
    const start = performance.now()
    for (let column = 0; column < COLUMNS; column++) {
      for (let row = 0; row < ROWS; row++) composeTile(column, row)
    }
    console.log(`Composed the whole projection in ${Math.round(performance.now() - start)} ms`)
  }

  // Create the projection's tiles with one sprite each, and show the empty paper
  for (let column = 0; column < COLUMNS; column++) {
    for (let row = 0; row < ROWS; row++) {
      const texture = createTile(column, row)
      projection.set(`${column},${row}`, texture)
      const sprite = new Sprite(texture)
      sprite.position.set(column * TILE_SIZE, row * TILE_SIZE)
      projectionContainer.addChild(sprite)
    }
  }
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

  // Each undo step keeps the layer that was painted on and, for every tile the stroke touched, a copy of the tile
  // from before the stroke (null = the tile didn't exist yet)
  type UndoStep = { layer: Layer; tiles: Map<string, RenderTexture | null> }
  const undoStack: UndoStep[] = []
  let strokeBackup: UndoStep | null = null // the step being recorded while the user paints

  const copySprite = new Sprite() // reused to draw one texture into another

  // Copy a texture inside the graphics card, without bringing it back to the CPU (that would be slow)
  function copyTexture(texture: RenderTexture) {
    const copy = RenderTexture.create({ width: texture.width, height: texture.height })
    copySprite.texture = texture
    app.renderer.render({ container: copySprite, target: copy, clear: true })
    return copy
  }

  // Before a stroke paints on a tile for the first time, keep a copy of how the tile was
  function backUpTile(key: string) {
    if (!strokeBackup || strokeBackup.tiles.has(key)) return // not painting, or already saved during this stroke
    const texture = strokeBackup.layer.tiles.get(key)
    strokeBackup.tiles.set(key, texture ? copyTexture(texture) : null)
  }

  const MAX_UNDO_TILES = 2000 // tile copies kept for undo and redo: about 500 MB of graphics card memory
  const redoStack: UndoStep[] = []

  // Free the graphics card memory used by the copies of a step
  function destroyStep(step: UndoStep) {
    for (const copy of step.tiles.values()) copy?.destroy(true)
  }

  // How many copies a step really keeps on the graphics card (tiles that didn't exist cost nothing)
  function countCopies(step: UndoStep) {
    let count = 0
    for (const copy of step.tiles.values()) if (copy) count++
    return count
  }

  // Put the saved copies back into the tiles, and keep in the step what the tiles had instead.
  // That way the same step works in both directions: undo swaps it once, redo swaps it back
  function swapTiles(step: UndoStep) {
    const start = performance.now()
    for (const [key, saved] of step.tiles) {
      const [column, row] = key.split(',').map(Number)
      const tile = getTile(step.layer, column, row)
      const current = copyTexture(tile)
      if (saved) {
        copySprite.texture = saved
        app.renderer.render({ container: copySprite, target: tile, clear: true })
        saved.destroy(true)
      } else {
        app.renderer.render({ container: new Container(), target: tile, clear: true }) // the tile didn't exist: empty it
      }
      step.tiles.set(key, current)
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
    for (const undone of redoStack) destroyStep(undone)
    redoStack.length = 0

    // When the copies take too much memory, forget the oldest steps (but always keep the newest one)
    let copyCount = 0
    for (const s of undoStack) copyCount += countCopies(s)
    while (copyCount > MAX_UNDO_TILES && undoStack.length > 1) {
      const oldest = undoStack.shift()!
      copyCount -= countCopies(oldest)
      destroyStep(oldest)
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
      backUpTile(key) // must come before getTile, which would create the tile and hide that it didn't exist
      stamp.position.set(-column * TILE_SIZE, -row * TILE_SIZE)
      app.renderer.render({ container: stampRoot, target: getTile(activeLayer, column, row), clear: false })
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

  // Show the layers in the console, from the top to the bottom, and how much graphics card memory they use
  function logLayers() {
    let tileCount = 0
    const lines = layers.map((layer, i) => {
      tileCount += layer.tiles.size
      const { opacity, blendMode, visible } = layer
      const marker = layer === activeLayer ? '>' : ' '
      return `${marker} Layer ${i + 1}: ${layer.tiles.size} tiles, opacity ${opacity}, ${blendMode}${visible ? '' : ', hidden'}`
    })
    let copyCount = 0
    for (const step of [...undoStack, ...redoStack]) copyCount += countCopies(step)
    // Each tile is 256 × 256 pixels × 4 bytes = 256 KB, so 4 tiles are about 1 MB
    console.log(
      `${lines.reverse().join('\n')}\n` +
        `Tiles: ${tileCount} (~${Math.round(tileCount / 4)} MB), undo copies: ${copyCount} (~${Math.round(copyCount / 4)} MB), ` +
        `projection: ${projection.size} (~${Math.round(projection.size / 4)} MB)`,
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
    for (let column = 0; column < COLUMNS; column++) {
      for (let row = 0; row < ROWS; row++) {
        backUpTile(`${column},${row}`)
        app.renderer.render({ container: fillRect, target: getTile(activeLayer, column, row), clear: false })
        composeTile(column, row)
      }
    }
    addUndoStep(strokeBackup)
    strokeBackup = null
    console.log(`Filled the layer in ${Math.round(performance.now() - start)} ms`)
    logLayers()
  }

  // N adds a layer on top; the arrows choose the active layer; H hides or shows it; O changes its opacity;
  // M switches it between normal and multiply; F fills it (to test many full layers)
  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || drawingPointerId !== null) return
    const layer = activeLayer
    if (e.key === 'n') activeLayer = addLayer()
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const index = layers.indexOf(activeLayer) + (e.key === 'ArrowUp' ? 1 : -1)
      if (index < 0 || index >= layers.length) return // already at the top or bottom
      activeLayer = layers[index]
    } else if (e.key === 'f') return fillActiveLayer()
    else {
      // These change how the layer looks, so the whole projection must be put together again
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
