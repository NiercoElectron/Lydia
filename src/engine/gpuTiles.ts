import { BufferImageSource, Container, RenderTexture, Sprite, Texture } from 'pixi.js'
import type { GlRenderTarget, GlRenderTargetAdaptor, WebGLRenderer } from 'pixi.js'
import type { Layer } from './layers'
import { toStoredTile, type StoredTile, type TileMemory } from './memory'
import { tileKey, tileSize, type Grid } from './tiles'

// The pixels of every layer live in RAM (the "shelf"), which is much bigger than the graphics card's memory. The
// graphics card (the "desk") only keeps copies of the tiles it needs right now, up to GPU_CACHE_TILES tiles that are
// not painted. A tile painted on the graphics card is "dirty" until its pixels are read back into RAM
const GPU_CACHE_TILES = 2000 // about 500 MB of graphics card memory
const TRIM_BATCH = 32 // tiles over the budget before trimming, so the cache isn't searched every time
const MAX_SAVING_READS = 64 // reads for the background saving on their way at the same time

export type CachedTile = {
  layer: Layer
  key: string
  texture: RenderTexture
  dirty: boolean // painted since its pixels were last saved in RAM
  version: number // goes up every time the tile changes, to notice reads that finished too late
  reading: PendingRead | null // a read of the tile on its way, if any
}

// Pixels that are on their way from the graphics card, like an IOU: "tile" is filled in when the read finishes
export type PendingPixels = { read: PendingRead; tile?: StoredTile | null }

export type PendingRead = {
  cached: CachedTile
  version: number // the tile's version when the read started
  width: number
  height: number
  buffer: WebGLBuffer
  fence: WebGLSync
  waiters: PendingPixels[] // IOUs to fill in when the read finishes
  isSaving: boolean // started by the background saving
}

export function createGpuTiles(renderer: WebGLRenderer, grid: Grid, memory: TileMemory) {
  const gl = renderer.gl as WebGL2RenderingContext

  // ----- Textures -----

  const emptyContainer = new Container()
  function clearTexture(texture: RenderTexture) {
    renderer.render({ container: emptyContainer, target: texture, clear: true })
  }

  // A transparent texture for the tile at this column and row
  function createTexture(column: number, row: number) {
    const texture = RenderTexture.create(tileSize(grid, column, row))
    clearTexture(texture)
    return texture
  }

  const copySprite = new Sprite() // reused to draw one texture into another

  // Draw one texture into another, inside the graphics card
  function copyInto(source: Texture, target: RenderTexture) {
    copySprite.texture = source
    renderer.render({ container: copySprite, target, clear: true })
  }

  const stagingTextures = new Map<string, Texture>() // one per tile size, reused to send pixels to the graphics card
  let uploadCount = 0

  // Send a tile from RAM to a texture on the graphics card
  function upload(tile: StoredTile, target: RenderTexture) {
    let pixels: Uint8ClampedArray
    try {
      pixels = memory.unpack(tile, target.width, target.height)
    } catch (error) {
      // Damaged bytes (from a damaged file): show the tile as empty rather than stopping everything
      console.error('Could not unpack a tile:', error)
      clearTexture(target)
      return
    }
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

  // ----- The cache -----

  // "layerId/column,row" -> the tile's copy on the graphics card. A Map remembers the order in which keys were added, so
  // moving a tile to the end every time it is used keeps the least recently used tiles at the start
  const cache = new Map<string, CachedTile>()
  const dirtyTiles = new Set<CachedTile>() // painted tiles whose latest pixels are only on the graphics card

  function getCached(layer: Layer, key: string) {
    return cache.get(`${layer.id}/${key}`)
  }

  // Get the copy of a layer's tile on the graphics card, sending it from RAM if needed.
  // Returns null when the tile has no paint and "create" is false
  function getTexture(layer: Layer, column: number, row: number, create: boolean) {
    const key = tileKey(column, row)
    const id = `${layer.id}/${key}`
    let cached = cache.get(id)
    if (cached) {
      cache.delete(id) // it goes back in at the end: it is now the most recently used tile
    } else {
      const tile = layer.tiles.get(key)
      if (!tile && !create) return null
      const texture = createTexture(column, row)
      if (tile) upload(tile, texture)
      cached = { layer, key, texture, dirty: false, version: 0, reading: null }
    }
    cache.set(id, cached)
    return cached.texture
  }

  // Painting on a tile makes its copy on the graphics card newer than RAM
  function markDirty(layer: Layer, key: string) {
    const cached = getCached(layer, key)!
    cached.dirty = true
    cached.version++
    dirtyTiles.add(cached)
  }

  // The tile's copy on the graphics card has the same pixels as RAM again (after undo, for example). A read of older
  // pixels still on its way must not be kept as the tile's latest
  function markClean(cached: CachedTile) {
    cached.dirty = false
    cached.version++
    dirtyTiles.delete(cached)
  }

  // Keep a tile's latest pixels in RAM (null = no paint)
  function keepInRam(cached: CachedTile, tile: StoredTile | null) {
    if (tile) cached.layer.tiles.set(cached.key, tile)
    else cached.layer.tiles.delete(cached.key)
    cached.dirty = false
    dirtyTiles.delete(cached)
  }

  // A layer whose tiles must stay on the graphics card, because sprites on the screen show them (see showOpacityLive
  // in projection.ts). A layer has at most 1600 tiles (10000 / 256 = 40 columns and rows), fewer than the budget, so
  // there is always room left for the other layers
  let keptLayer: Layer | null = null

  function keep(layer: Layer | null) {
    keptLayer = layer
  }

  // Free graphics card memory: remove the least recently used tiles until the cache fits its budget again.
  // Painted tiles are skipped and don't count against the budget: reading them back now would make the processor wait
  // for the graphics card, so they stay until the background saving has their pixels in RAM. If they counted, many
  // painted tiles would push out every other tile, and the layers above and below would be sent again and again
  function trim() {
    const cleanCount = () => cache.size - dirtyTiles.size
    if (cleanCount() <= GPU_CACHE_TILES + TRIM_BATCH) return
    for (const [id, cached] of cache) {
      if (cleanCount() <= GPU_CACHE_TILES) break
      if (cached.dirty || cached.layer === keptLayer) continue
      cached.texture.destroy(true)
      cache.delete(id)
    }
  }

  // The tiles of a layer whose latest pixels are only on the graphics card
  function dirtyKeysOf(layer: Layer) {
    const keys: string[] = []
    for (const cached of dirtyTiles) if (cached.layer === layer) keys.push(cached.key)
    return keys
  }

  // ----- Reading back without waiting (WebGL2) -----

  // Instead of making the processor wait, ask the graphics card to copy the tile into a buffer of its own (a "pixel
  // buffer object") and to signal when it has done it (a "fence"). A frame or two later the pixels are fetched from
  // the buffer, without waiting for anything. Like leaving an order at a factory and picking it up when it is ready,
  // instead of stopping the production line to inspect one piece
  const pendingReads = new Set<PendingRead>() // in the order they started
  let savingReads = 0
  let readBackCount = 0

  // Start reading a tile without waiting. The graphics card does its work in the order it was given, so the read gets
  // the tile as it is now, even if something is painted on it right afterwards
  function startRead(cached: CachedTile, isSaving: boolean) {
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
    const read: PendingRead = { cached, version: cached.version, width, height, buffer, fence, waiters: [], isSaving }
    pendingReads.add(read)
    if (isSaving) savingReads++
    cached.reading = read
    return read
  }

  // Fetch the pixels of a read: fill in its IOUs and, if they are still the tile's latest pixels, keep them in RAM.
  // If the read hasn't finished yet, the processor has to wait for it
  function completeRead(read: PendingRead) {
    gl.deleteSync(read.fence)
    pendingReads.delete(read)
    if (read.isSaving) savingReads--
    const { cached } = read
    if (cached.reading === read) cached.reading = null

    // The pixels are the tile's latest only if it is still on the graphics card, still needs saving, and was not
    // painted again after the read started
    const isCached = getCached(cached.layer, cached.key) === cached
    const isLatest = isCached && cached.dirty && cached.version === read.version
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
    for (const read of pendingReads) {
      if (performance.now() - start >= budget) break
      if (gl.clientWaitSync(read.fence, 0, 0) === gl.TIMEOUT_EXPIRED) continue // not ready yet: next frame
      if (completeRead(read)) saved++
    }
    return saved
  }

  // Start reads for painted tiles, at most "max" of them. "skip" tells which tiles to leave for later
  function startSaving(max: number, skip: (cached: CachedTile) => boolean) {
    let started = 0
    for (const cached of dirtyTiles) {
      if (savingReads >= MAX_SAVING_READS || started >= max) break
      if (cached.reading?.version === cached.version) continue // already being read
      if (skip(cached)) continue
      startRead(cached, true)
      started++
    }
    gl.flush() // send the reads to the graphics card now, so their fences can be signaled
  }

  // An IOU for the tile's pixels as they are now. A read of this same version may already be on its way
  function readLater(cached: CachedTile): PendingPixels {
    const read = cached.reading?.version === cached.version ? cached.reading : startRead(cached, false)
    const pending: PendingPixels = { read }
    read.waiters.push(pending)
    return pending
  }

  // An IOU that is no longer needed (its undo step was forgotten). A read with no IOUs left that isn't saving the tile
  // is just thrown away when it finishes, without fetching its pixels
  function cancel(pending: PendingPixels) {
    const waiters = pending.read.waiters
    const index = waiters.indexOf(pending)
    if (index >= 0) waiters.splice(index, 1)
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

  function destroy() {
    for (const read of pendingReads) {
      gl.deleteSync(read.fence)
      gl.deleteBuffer(read.buffer)
    }
    pendingReads.clear()
    for (const cached of cache.values()) cached.texture.destroy(true)
    cache.clear()
    dirtyTiles.clear()
    for (const texture of stagingTextures.values()) texture.destroy(true)
  }

  return {
    createTexture,
    clearTexture,
    copyInto,
    upload,
    getCached,
    getTexture,
    markDirty,
    markClean,
    keep,
    trim,
    dirtyKeysOf,
    finishReads,
    startSaving,
    readLater,
    cancel,
    redeem,
    restoreFromRead,
    destroy,
    hasUnsaved: () => dirtyTiles.size > 0 || pendingReads.size > 0,
    stats: () => ({ cached: cache.size, dirty: dirtyTiles.size, uploads: uploadCount, readBacks: readBackCount }),
  }
}

export type GpuTiles = ReturnType<typeof createGpuTiles>
