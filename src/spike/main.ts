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

  // The paper: a white rectangle the size of the project
  const paper = new Graphics().rect(0, 0, PROJECT_WIDTH, PROJECT_HEIGHT).fill(0xffffff)
  world.addChild(paper)

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

  // ----- Layer made of tiles -----

  const layer = new Container() // holds one sprite per tile, on top of the paper
  world.addChild(layer)
  const tiles = new Map<string, RenderTexture>() // "column,row" -> the tile's texture

  // Zoomed in, show each pixel as a sharp square (like Photoshop and Krita); zoomed out, blend pixels smoothly
  let tileScaleMode: 'nearest' | 'linear' = 'linear'
  app.ticker.add(() => {
    const scaleMode = world.scale.x >= 1 ? 'nearest' : 'linear'
    if (scaleMode === tileScaleMode) return
    tileScaleMode = scaleMode
    for (const texture of tiles.values()) {
      texture.source.scaleMode = scaleMode
      texture.source.style.update() // tell PixiJS the setting changed, so the graphics card uses it
    }
  })

  // Get the tile at this column and row, creating it (transparent) the first time it is painted on
  function getTile(column: number, row: number) {
    const key = `${column},${row}`
    let texture = tiles.get(key)
    if (!texture) {
      // The last column and row are cut at the edge of the paper (10000 is not a multiple of 256)
      const width = Math.min(TILE_SIZE, PROJECT_WIDTH - column * TILE_SIZE)
      const height = Math.min(TILE_SIZE, PROJECT_HEIGHT - row * TILE_SIZE)
      texture = RenderTexture.create({ width, height, scaleMode: tileScaleMode })
      app.renderer.render({ container: new Container(), target: texture, clear: true }) // start fully transparent
      const sprite = new Sprite(texture)
      sprite.position.set(column * TILE_SIZE, row * TILE_SIZE)
      layer.addChild(sprite)
      tiles.set(key, texture)
    }
    return texture
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

      // Which tiles does this dab cover?
      const radius = dab.size / 2
      const firstColumn = Math.max(0, Math.floor((dab.x - radius) / TILE_SIZE))
      const lastColumn = Math.min(Math.ceil(PROJECT_WIDTH / TILE_SIZE) - 1, Math.floor((dab.x + radius) / TILE_SIZE))
      const firstRow = Math.max(0, Math.floor((dab.y - radius) / TILE_SIZE))
      const lastRow = Math.min(Math.ceil(PROJECT_HEIGHT / TILE_SIZE) - 1, Math.floor((dab.y + radius) / TILE_SIZE))
      for (let column = firstColumn; column <= lastColumn; column++) {
        for (let row = firstRow; row <= lastRow; row++) {
          touchedTiles.add(`${column},${row}`)
        }
      }
    })

    // Render all the dabs into each touched tile, shifted so that the tile's corner is at (0, 0)
    for (const key of touchedTiles) {
      const [column, row] = key.split(',').map(Number)
      stamp.position.set(-column * TILE_SIZE, -row * TILE_SIZE)
      app.renderer.render({ container: stampRoot, target: getTile(column, row), clear: false })
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
  })

  // ----- Export -----

  // Put all the tiles together on a white background, at the full size of the project, and encode it as PNG
  async function renderPng() {
    const assembleStart = performance.now()
    const canvas = document.createElement('canvas')
    canvas.width = PROJECT_WIDTH
    canvas.height = PROJECT_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This image is too big for this browser.')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, PROJECT_WIDTH, PROJECT_HEIGHT)

    // Copy each tile from the graphics card back to a normal canvas, at its place in the image
    for (const [key, texture] of tiles) {
      const [column, row] = key.split(',').map(Number)
      const tileCanvas = app.renderer.extract.canvas(texture) as HTMLCanvasElement
      ctx.drawImage(tileCanvas, column * TILE_SIZE, row * TILE_SIZE)
    }

    const encodeStart = performance.now()
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('This image is too big for this browser.')

    // Spike measurements: how long each part took and how big the file is
    console.log(
      `Export: ${tiles.size} tiles, assembled in ${Math.round(encodeStart - assembleStart)} ms, ` +
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
