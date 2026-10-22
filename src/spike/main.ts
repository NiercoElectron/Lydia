import { Application, BufferImageSource, Container, Graphics, RenderTexture, Sprite, Texture } from 'pixi.js'
import type { GlRenderTarget, GlRenderTargetAdaptor, WebGLRenderer } from 'pixi.js'
import { decompress } from './lz4'

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

type Dab = { x: number; y: number; size: number; color?: number } // without a color, the dab uses the brush color

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

  // A tile's pixels in RAM, kept in the smallest form that gives back exactly the same pixels. Only one of the three is
  // set. The pixels never change, only get replaced by new ones, so the undo history can keep a tile without copying
  // it; only the form changes, when the compressor finishes
  type StoredTile = {
    color?: number // every pixel has this same color (a filled area): 4 bytes instead of 256 KB
    pixels?: Uint8ClampedArray // not compressed (yet)
    packed?: Uint8Array // compressed (see lz4.ts)
  }

  type Layer = {
    id: number
    // "column,row" -> the tile in RAM. Tiles without paint are not stored at all
    tiles: Map<string, StoredTile>
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

  // Send a tile from RAM to a texture on the graphics card (fast)
  function upload(tile: StoredTile, target: RenderTexture) {
    const pixels = unpack(tile, target.width, target.height)
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

  // ----- Keeping tiles small in RAM -----

  // Open spike.html?raw to keep every tile uncompressed, to compare how painting feels with and without compression
  const COMPRESS_TILES = !new URLSearchParams(location.search).has('raw')

  // Turn pixels read back from the graphics card into a stored tile: nothing for a tile without paint (null), just the
  // color for a tile of a single color, and the pixels themselves otherwise, which are then sent to the compressor
  function toStoredTile(pixels: Uint8ClampedArray): StoredTile | null {
    // Look at each pixel as one number (its 4 bytes together), to compare whole pixels at once
    const colors = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length / 4)
    const first = colors[0]
    let isOneColor = true
    let isEmpty = true
    for (let i = 0; i < colors.length && (isOneColor || isEmpty); i++) {
      if (colors[i] !== first) isOneColor = false
      if (pixels[i * 4 + 3] !== 0) isEmpty = false // the pixel's alpha
    }
    if (isEmpty) return null
    if (isOneColor) return { color: first }
    const tile: StoredTile = { pixels }
    if (COMPRESS_TILES) compressLater(tile)
    return tile
  }

  // How much RAM a stored tile takes
  function bytesOf(tile: StoredTile) {
    return tile.pixels?.length ?? tile.packed?.length ?? 4
  }
  const toMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

  const unpackBuffers = new Map<string, Uint8ClampedArray>() // one per tile size, reused to unpack tiles

  // The pixels of a stored tile. Unpacked pixels go into a buffer that is reused, so they are only valid until the
  // next call
  function unpack(tile: StoredTile, width: number, height: number) {
    if (tile.pixels) return tile.pixels
    const size = `${width}x${height}`
    let buffer = unpackBuffers.get(size)
    if (!buffer) {
      buffer = new Uint8ClampedArray(width * height * 4)
      unpackBuffers.set(size, buffer)
    }
    if (tile.packed) decompress(tile.packed, buffer)
    else new Uint32Array(buffer.buffer).fill(tile.color!) // every pixel gets the same color
    return buffer
  }

  // Most tiles have big areas of one color or of transparency, which can be kept in much less memory (see lz4.ts). A
  // worker compresses them in the background, on another core of the processor, so painting never waits for it. It
  // gets a copy of the pixels, so the tile can still be used while it is being compressed
  const compressor = new Worker(new URL('./compressor.ts', import.meta.url), { type: 'module' })
  const compressQueue: StoredTile[] = [] // tiles waiting for their turn
  const compressing = new Map<number, StoredTile>() // job number -> the tile being compressed
  const MAX_COMPRESSING = 8 // each job holds a copy of the tile, so only a few are sent at a time
  let nextJob = 0
  // Measurements: the tiles compressed since the compressor last had nothing to do, and their size before and after
  let compressedCount = 0
  let compressStart = 0
  let bytesBefore = 0
  let bytesAfter = 0

  function compressLater(tile: StoredTile) {
    compressQueue.push(tile)
    sendToCompressor()
  }

  function sendToCompressor() {
    while (compressing.size < MAX_COMPRESSING && compressQueue.length > 0) {
      if (compressedCount === 0 && compressing.size === 0) compressStart = performance.now()
      const tile = compressQueue.shift()!
      compressing.set(nextJob, tile)
      compressor.postMessage({ job: nextJob, pixels: tile.pixels })
      nextJob++
    }
  }

  compressor.onmessage = (e: MessageEvent<{ job: number; packed: Uint8Array }>) => {
    const { job, packed } = e.data
    const tile = compressing.get(job)!
    compressing.delete(job)
    const pixels = tile.pixels!
    // Keep whichever is smaller (pixels that look like noise don't get smaller)
    if (packed.length < pixels.length) {
      tile.packed = packed
      tile.pixels = undefined
    }
    compressedCount++
    bytesBefore += pixels.length
    bytesAfter += bytesOf(tile)
    sendToCompressor()

    if (compressing.size > 0) return
    const time = Math.round(performance.now() - compressStart)
    console.log(
      `Compressed ${compressedCount} tiles in the background over ${time} ms: ${toMB(bytesBefore)} MB -> ${toMB(bytesAfter)} MB`,
    )
    compressedCount = 0
    bytesBefore = 0
    bytesAfter = 0
  }

  // ----- The graphics card cache -----

  type CachedTile = {
    layer: Layer
    key: string
    texture: RenderTexture
    dirty: boolean // painted since its pixels were last saved in RAM
    version: number // goes up every time the tile is painted, to notice reads that finished too late
    readingVersion: number // the version being read without waiting, or -1 when there is no such read
  }
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
      const tile = layer.tiles.get(key)
      if (!tile && !create) return null
      const texture = createTexture(column, row)
      if (tile) upload(tile, texture)
      cached = { layer, key, texture, dirty: false, version: 0, readingVersion: -1 }
    }
    gpuTiles.set(id, cached)
    return cached.texture
  }

  const dirtyTiles = new Set<CachedTile>() // painted tiles whose latest pixels are only on the graphics card

  // Painting on a tile makes its copy on the graphics card newer than RAM
  function markDirty(layer: Layer, key: string) {
    const cached = gpuTiles.get(`${layer.id}/${key}`)!
    cached.dirty = true
    cached.version++
    dirtyTiles.add(cached)
  }

  // Keep a tile's latest pixels in RAM (null = no paint)
  function keepInRam(cached: CachedTile, tile: StoredTile | null) {
    if (tile) cached.layer.tiles.set(cached.key, tile)
    else cached.layer.tiles.delete(cached.key)
    cached.dirty = false
    dirtyTiles.delete(cached)
  }

  // Free graphics card memory: remove the least recently used tiles until the cache fits its budget again.
  // Painted tiles are skipped and don't count against the budget: reading them back now would make the processor wait
  // for the graphics card, so they stay until the background saving has their pixels in RAM. If they counted, many
  // painted tiles would push out every other tile, and the layers above and below would be sent again and again
  const TRIM_BATCH = 32 // tiles over the budget before trimming, so the cache isn't searched every time
  function trimGpuCache() {
    const cleanCount = () => gpuTiles.size - dirtyTiles.size
    if (cleanCount() <= GPU_CACHE_TILES + TRIM_BATCH) return
    for (const [id, cached] of gpuTiles) {
      if (cleanCount() <= GPU_CACHE_TILES) break
      if (cached.dirty) continue
      cached.texture.destroy(true)
      gpuTiles.delete(id)
    }
  }

  // ----- Reading back without waiting (WebGL2) -----

  // Instead of making the processor wait, ask the graphics card to copy the tile into a buffer of its own (a "pixel
  // buffer object") and to signal when it has done it (a "fence"). A frame or two later the pixels are fetched from
  // the buffer, without waiting for anything. Like leaving an order at a factory and picking it up when it is ready,
  // instead of stopping the production line to inspect one piece
  const renderer = app.renderer as WebGLRenderer
  const gl = renderer.gl as WebGL2RenderingContext
  // Pixels that are on their way from the graphics card, like an IOU: "tile" is filled in when the read finishes
  type PendingPixels = { read: PendingRead; tile?: StoredTile | null }
  type PendingRead = {
    cached: CachedTile
    version: number // the tile's version when the read started
    width: number
    height: number
    buffer: WebGLBuffer
    fence: WebGLSync
    waiters: PendingPixels[] // IOUs to fill in when the read finishes
  }
  const pendingReads: PendingRead[] = []
  const MAX_PENDING_READS = 64

  // Start reading a tile without waiting. The graphics card does its work in the order it was given, so the read gets
  // the tile as it is now, even if something is painted on it right afterwards
  function startRead(cached: CachedTile) {
    // Tell PixiJS which texture to read from, the same way it does when it reads pixels itself
    const renderTarget = renderer.renderTarget.getRenderTarget(cached.texture)
    const glRenderTarget = renderer.renderTarget.getGpuRenderTarget(renderTarget) as GlRenderTarget
    ;(renderer.renderTarget.adaptor as GlRenderTargetAdaptor).bindFramebuffer(glRenderTarget.resolveTargetFramebuffer)

    // A new buffer for every read: Chrome prepares a copy of each read buffer to make fetching it fast, and throws it
    // away (with a warning) when a buffer is reused, so reusing buffers would make fetching slow again
    const { width, height } = cached.texture
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer)
    gl.bufferData(gl.PIXEL_PACK_BUFFER, width * height * 4, gl.STREAM_READ)
    // With a pixel buffer bound, readPixels copies into it instead of into RAM, so it doesn't wait
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, 0)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!
    const read: PendingRead = { cached, version: cached.version, width, height, buffer, fence, waiters: [] }
    pendingReads.push(read)
    cached.readingVersion = cached.version
    return read
  }

  // Fetch the pixels of a read: fill in its IOUs and, if they are still the tile's latest pixels, keep them in RAM.
  // If the read hasn't finished yet, the processor has to wait for it (only for undo right after a stroke)
  function completeRead(read: PendingRead) {
    gl.deleteSync(read.fence)
    pendingReads.splice(pendingReads.indexOf(read), 1)
    const { cached } = read
    if (cached.readingVersion === read.version) cached.readingVersion = -1

    // The pixels are the tile's latest only if it is still on the graphics card, still needs saving, and was not
    // painted again after the read started
    const stillCached = gpuTiles.get(`${cached.layer.id}/${cached.key}`) === cached
    const isLatest = stillCached && cached.dirty && cached.version === read.version
    let saved = false
    if (isLatest || read.waiters.length > 0) {
      const pixels = new Uint8ClampedArray(read.width * read.height * 4)
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, read.buffer)
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels)
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
      readBackCount++
      const tile = toStoredTile(pixels)
      for (const waiter of read.waiters) waiter.tile = tile
      if (isLatest) {
        keepInRam(cached, tile)
        saved = true
      }
    }
    gl.deleteBuffer(read.buffer) // used or not, the buffer is not needed anymore
    return saved
  }

  // Fetch the reads that are ready, using at most "budget" milliseconds. Returns how many tiles were saved
  function finishReads(budget: number) {
    const start = performance.now()
    let saved = 0
    for (let i = 0; i < pendingReads.length && performance.now() - start < budget;) {
      const read = pendingReads[i]
      if (gl.clientWaitSync(read.fence, 0, 0) === gl.TIMEOUT_EXPIRED) {
        i++ // not ready yet: check again in the next frame
        continue
      }
      if (completeRead(read)) saved++ // completeRead removes it from the list, so "i" stays the same
    }
    return saved
  }

  // Get the pixels of an IOU, waiting for its read if it hasn't finished yet
  function redeem(pending: PendingPixels) {
    if (pending.tile === undefined) completeRead(pending.read)
    return pending.tile ?? null
  }

  // Copy the pixels of a read that hasn't been fetched into a texture, straight from the read's buffer: everything
  // stays on the graphics card, so nothing waits
  function restoreFromRead(read: PendingRead, target: RenderTexture) {
    renderer.texture.bind(target.source, 0) // bind it through PixiJS, so PixiJS knows which texture is bound
    // These two must be off when the pixels come from a buffer; they are put back afterwards for PixiJS
    const flipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL)
    const premultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, read.buffer)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, read.width, read.height, gl.RGBA, gl.UNSIGNED_BYTE, 0)
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply)
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

  // Each undo step keeps the layer that was painted on and, for every tile the stroke touched, the tile from before
  // the stroke (null = the tile had no paint). Pixels are never changed, so no copy is needed. If the tile's latest
  // pixels were still only on the graphics card, the step keeps an IOU instead, filled in a frame or two later
  type TileBackup = StoredTile | null | PendingPixels
  type UndoStep = { layer: Layer; tiles: Map<string, TileBackup> }
  const undoStack: UndoStep[] = []
  const redoStack: UndoStep[] = []
  let strokeBackup: UndoStep | null = null // the step being recorded while the user paints
  const MAX_UNDO_BYTES = 500 * 1024 * 1024 // RAM kept for undo and redo

  // What a layer's tile has right now, to keep for undo or redo: the tile in RAM or, if its latest pixels are still
  // only on the graphics card, an IOU, read without waiting. The read gets the tile as it is now, even if something
  // changes it right afterwards, because the graphics card works in order. A read of this same version may already be
  // on its way
  function currentTile(layer: Layer, key: string): TileBackup {
    const cached = gpuTiles.get(`${layer.id}/${key}`)
    if (!cached?.dirty) return layer.tiles.get(key) ?? null
    const read = pendingReads.find(r => r.cached === cached && r.version === cached.version) ?? startRead(cached)
    const pending: PendingPixels = { read }
    read.waiters.push(pending)
    return pending
  }

  // Before a stroke paints on a tile for the first time, keep what the tile had before the stroke
  function backUpTile(key: string) {
    if (!strokeBackup || strokeBackup.tiles.has(key)) return // not painting, or already kept during this stroke
    strokeBackup.tiles.set(key, currentTile(strokeBackup.layer, key))
  }

  // The tile a backup stands for (an IOU is redeemed first)
  function tileOf(backup: TileBackup) {
    return backup && 'read' in backup ? redeem(backup) : backup
  }

  // How much RAM a step keeps (tiles that had no paint cost nothing)
  function stepBytes(step: UndoStep) {
    let bytes = 0
    for (const backup of step.tiles.values()) {
      const tile = backup && 'read' in backup ? backup.tile : backup
      if (tile) bytes += bytesOf(tile)
      else if (tile === undefined) bytes += TILE_SIZE * TILE_SIZE * 4 // an IOU not filled in yet counts as a whole tile
    }
    return bytes
  }

  // Put the saved pixels back into the layer, and keep in the step what the layer had instead.
  // That way the same step works in both directions: undo swaps it once, redo swaps it back
  function swapTiles(step: UndoStep) {
    const start = performance.now()
    const isBelowActive = layers.indexOf(step.layer) < layers.indexOf(activeLayer)
    for (const [key, backup] of step.tiles) {
      const [column, row] = key.split(',').map(Number)
      const current = currentTile(step.layer, key) // what the layer has now, to swap back later

      if (backup && 'read' in backup && backup.tile === undefined) {
        // An IOU whose pixels haven't been fetched: they are still on the graphics card, in the read's buffer, so put
        // them back from there instead of bringing them to RAM and back. The tile is now newer than RAM, like a
        // painted tile, and the background saving takes care of it
        restoreFromRead(backup.read, getGpuTile(step.layer, column, row, true)!)
        markDirty(step.layer, key)
      } else {
        const saved = tileOf(backup) // no waiting: an IOU here already has its pixels
        if (saved) step.layer.tiles.set(key, saved)
        else step.layer.tiles.delete(key)

        // If the graphics card has a copy of this tile, update it too. It now has the same pixels as RAM, so it doesn't
        // need saving anymore, and a read of its old pixels still on its way must not be kept as its latest
        const cached = gpuTiles.get(`${step.layer.id}/${key}`)
        if (cached) {
          if (saved) upload(saved, cached.texture)
          else clearTexture(cached.texture)
          cached.dirty = false
          cached.version++
          dirtyTiles.delete(cached)
        }
      }
      step.tiles.set(key, current)

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
    let bytes = 0
    for (const s of undoStack) bytes += stepBytes(s)
    while (bytes > MAX_UNDO_BYTES && undoStack.length > 1) {
      bytes -= stepBytes(undoStack.shift()!)
    }
  }

  // ----- Brush -----

  const brushTip = createBrushTip(BRUSH_HARDNESS)
  let brushSize = 40
  let brushColor = '#000000'
  let isErasing = false

  // The dabs that touch a tile are put in "stamp" and rendered into that tile at once
  const stampRoot = new Container()
  const stamp = new Container()
  stampRoot.addChild(stamp)
  const dabSprites: Sprite[] = [] // reused between tiles instead of creating new sprites every time

  function paintDabs(dabs: Dab[]) {
    // Which dabs touch each tile ("column,row" -> its dabs, in the order they were placed)
    const dabsByTile = new Map<string, Dab[]>()
    for (const dab of dabs) {
      // The part of the dab that is on the paper (the rest is cut off)
      const radius = dab.size / 2
      const left = Math.max(0, dab.x - radius)
      const right = Math.min(PROJECT_WIDTH, dab.x + radius)
      const top = Math.max(0, dab.y - radius)
      const bottom = Math.min(PROJECT_HEIGHT, dab.y + radius)
      if (left >= right || top >= bottom) continue // the dab is entirely outside the paper

      // Which tiles does that part cover?
      const firstColumn = Math.floor(left / TILE_SIZE)
      const lastColumn = Math.ceil(right / TILE_SIZE) - 1
      const firstRow = Math.floor(top / TILE_SIZE)
      const lastRow = Math.ceil(bottom / TILE_SIZE) - 1
      for (let column = firstColumn; column <= lastColumn; column++) {
        for (let row = firstRow; row <= lastRow; row++) {
          const key = `${column},${row}`
          let tileDabs = dabsByTile.get(key)
          if (!tileDabs) {
            tileDabs = []
            dabsByTile.set(key, tileDabs)
          }
          tileDabs.push(dab)
        }
      }
    }

    // Render into each touched tile only the dabs that touch it, shifted so that the tile's corner is at (0, 0)
    for (const [key, tileDabs] of dabsByTile) {
      const [column, row] = key.split(',').map(Number)
      backUpTile(key)
      stamp.removeChildren()
      tileDabs.forEach((dab, i) => {
        let sprite = dabSprites[i]
        if (!sprite) {
          sprite = new Sprite(brushTip)
          sprite.anchor.set(0.5) // position the dab by its center
          dabSprites[i] = sprite
        }
        sprite.position.set(dab.x, dab.y)
        sprite.width = dab.size
        sprite.height = dab.size
        sprite.tint = dab.color ?? brushColor
        sprite.blendMode = isErasing ? 'erase' : 'normal' // the eraser removes paint from the tile instead of adding it
        stamp.addChild(sprite)
      })
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

  // The first dab of a stroke can cover dozens of tiles at once, and each of them needs every layer at that place on
  // the graphics card, which used to freeze the screen for a moment. So while the pointer moves over the paper without
  // painting, the tiles under the brush are made ready, a few per frame
  const PREPARE_BUDGET_MS = 3 // at most this much of each frame is spent getting tiles ready
  let hoverPoint: { x: number; y: number } | null = null // where the brush is waiting, or null when all is ready

  app.canvas.addEventListener('pointermove', e => {
    if (drawingPointerId === null && !panStart) hoverPoint = toProject(e)
  })

  // Make a tile ready for painting: its "below" up to date, and the active layer and the ones above on the graphics card
  function prepareTile(column: number, row: number) {
    if (staleBelow.delete(`${column},${row}`)) composeBelowTile(column, row)
    for (let i = layers.indexOf(activeLayer); i < layers.length; i++) {
      if (layers[i].visible) getGpuTile(layers[i], column, row, false)
    }
  }

  app.ticker.add(() => {
    if (!hoverPoint || drawingPointerId !== null) return
    const start = performance.now()
    // The tiles under the brush, as in paintDabs
    const radius = brushSize / 2
    const firstColumn = Math.max(0, Math.floor((hoverPoint.x - radius) / TILE_SIZE))
    const lastColumn = Math.min(COLUMNS - 1, Math.floor((hoverPoint.x + radius) / TILE_SIZE))
    const firstRow = Math.max(0, Math.floor((hoverPoint.y - radius) / TILE_SIZE))
    const lastRow = Math.min(ROWS - 1, Math.floor((hoverPoint.y + radius) / TILE_SIZE))
    for (let column = firstColumn; column <= lastColumn; column++) {
      for (let row = firstRow; row <= lastRow; row++) {
        prepareTile(column, row) // tiles that are already ready cost almost nothing
        if (performance.now() - start > PREPARE_BUDGET_MS) return // continue in the next frame
      }
    }
    hoverPoint = null // everything under the brush is ready
    trimGpuCache()
  })

  // Every frame: fetch the reads that are ready, then start reads for the painted tiles. Nothing waits, so letting go of
  // the pen doesn't freeze the screen. While painting, less is done, to leave the frame to the brush, and the tiles the
  // stroke has touched are skipped, since they will change again in a moment
  const SAVE_BUDGET_MS = 4 // at most this much of each frame is spent fetching pixels
  const SAVE_BUDGET_PAINTING_MS = 2
  const MAX_READS_STARTED_PAINTING = 8 // reads started per frame while painting
  let savedCount = 0
  let saveStart = 0
  app.ticker.add(() => {
    if (dirtyTiles.size === 0 && pendingReads.length === 0) return
    if (savedCount === 0) saveStart = performance.now()
    const isPainting = drawingPointerId !== null
    savedCount += finishReads(isPainting ? SAVE_BUDGET_PAINTING_MS : SAVE_BUDGET_MS)
    trimGpuCache() // the tiles saved just now can leave the graphics card, if it is over its budget

    let started = 0
    for (const cached of dirtyTiles) {
      if (pendingReads.length >= MAX_PENDING_READS) break
      if (isPainting && started >= MAX_READS_STARTED_PAINTING) break
      if (cached.readingVersion === cached.version) continue // already being read
      if (strokeBackup?.layer === cached.layer && strokeBackup.tiles.has(cached.key)) continue // part of this stroke
      startRead(cached)
      started++
    }
    gl.flush() // send the reads to the graphics card now, so their fences can be signaled

    if (dirtyTiles.size > 0 || savedCount === 0) return
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
  // An uncompressed tile is 256 × 256 pixels × 4 bytes = 256 KB, so 4 tiles are about 1 MB
  function logLayers() {
    let ramTiles = 0
    let ramBytes = 0
    let oneColor = 0
    let compressed = 0
    const lines = layers.map((layer, i) => {
      let layerBytes = 0
      for (const tile of layer.tiles.values()) {
        layerBytes += bytesOf(tile)
        if (tile.color !== undefined) oneColor++
        else if (tile.packed) compressed++
      }
      ramTiles += layer.tiles.size
      ramBytes += layerBytes
      const { opacity, blendMode, visible } = layer
      const marker = layer === activeLayer ? '>' : ' '
      return (
        `${marker} Layer ${i + 1}: ${layer.tiles.size} tiles, ${toMB(layerBytes)} MB, ` +
        `opacity ${opacity}, ${blendMode}${visible ? '' : ', hidden'}`
      )
    })
    let undoBytes = 0
    for (const step of [...undoStack, ...redoStack]) undoBytes += stepBytes(step)
    const waiting = compressQueue.length + compressing.size
    const gpuTileCount = gpuTiles.size + projection.size + below.size
    console.log(
      `${lines.reverse().join('\n')}\n` +
        `RAM: ${toMB(ramBytes)} MB for ${ramTiles} layer tiles (~${Math.round(ramTiles / 4)} MB uncompressed; ` +
        `${oneColor} of one color, ${compressed} compressed, ${waiting} waiting for the compressor) + ` +
        `${toMB(undoBytes)} MB for undo\n` +
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

  // Stress test with realistic pixels: cover the active layer with thousands of random soft strokes, like a painted
  // background. Unlike F, its tiles don't have a single color, so they show how much compression really saves
  function scribbleActiveLayer() {
    if (drawingPointerId !== null) return // not in the middle of a stroke
    const start = performance.now()
    const dabs: Dab[] = []
    for (let i = 0; i < 3000; i++) {
      let x = Math.random() * PROJECT_WIDTH
      let y = Math.random() * PROJECT_HEIGHT
      let angle = Math.random() * Math.PI * 2
      const size = 20 + Math.random() * 380
      const length = 200 + Math.random() * 1800
      const color = Math.floor(Math.random() * 0x1000000)
      const spacing = size * BRUSH_SPACING
      for (let along = 0; along < length; along += spacing) {
        dabs.push({ x, y, size, color })
        x += Math.cos(angle) * spacing
        y += Math.sin(angle) * spacing
        angle += (Math.random() - 0.5) * 0.1 // a gentle curve
      }
    }
    strokeBackup = { layer: activeLayer, tiles: new Map() } // scribbling can be undone like a stroke
    paintDabs(dabs)
    console.log(`Scribbled ${dabs.length} dabs over the layer in ${Math.round(performance.now() - start)} ms`)
    addUndoStep(strokeBackup)
    strokeBackup = null
    logLayers()
  }

  // N adds a layer on top; the arrows choose the active layer; H hides or shows it; O changes its opacity;
  // M switches it between normal and multiply; F fills it and S scribbles all over it (to test many full layers);
  // L only shows the layers and their memory
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
    else if (e.key === 's') return scribbleActiveLayer()
    else if (e.key !== 'l') {
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
