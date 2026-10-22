import { decompress } from './lz4'

// A tile's pixels in RAM. Each pixel takes 4 bytes (red, green, blue, alpha), with the color already multiplied by
// the alpha ("premultiplied", the way the graphics card works), and the rows go from the top to the bottom.
// The pixels themselves never change, only get replaced by new ones, so the undo history can keep a tile without
// copying it. Only the way they are kept changes:
// - "color": every pixel has this same color (a filled area), so nothing else is kept: 4 bytes instead of 256 KB
// - "pixels": uncompressed, ready to use. Kept while there is RAM to spare
// - "packed": compressed (see lz4.ts). Made when RAM gets short or when the project is saved
// A tile can have both "pixels" and "packed": the pixels are dropped first when RAM is short
export type StoredTile = {
  color?: number
  pixels?: Uint8ClampedArray
  packed?: Uint8Array
  lastUsed: number // when the tile was last needed, so the ones unused for the longest time are compressed first
}

// How much RAM a stored tile takes
export function bytesOf(tile: StoredTile) {
  return (tile.pixels?.length ?? 0) + (tile.packed?.length ?? 0) + (tile.color !== undefined ? 4 : 0)
}

// Turn pixels read back from the graphics card into a stored tile: nothing for a tile without paint (null), just the
// color for a tile of a single color, and the pixels themselves otherwise
export function toStoredTile(pixels: Uint8ClampedArray): StoredTile | null {
  // Look at each pixel as one number (its 4 bytes together), to compare whole pixels at once
  const colors = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length / 4)
  const first = colors[0]
  let isOneColor = true
  let isEmpty = true
  for (let i = 0; i < colors.length && (isOneColor || isEmpty); i++) {
    if (colors[i] !== first) isOneColor = false
    if (pixels[i * 4 + 3] !== 0) isEmpty = false // the pixel's alpha
  }
  const lastUsed = performance.now()
  if (isEmpty) return null
  if (isOneColor) return { color: first, lastUsed }
  return { pixels, lastUsed }
}

// Keeps the tiles in RAM within a budget: tiles stay uncompressed while there is RAM to spare (unpacking costs time
// every time a tile goes back to the graphics card), and the ones unused for the longest time are compressed when the
// uncompressed tiles take more than "rawBudget" bytes. Workers compress them in the background, on other cores of the
// processor, so painting never waits for them
export function createTileMemory(rawBudget: number) {
  type Job = {
    tile: StoredTile
    requestedAt: number
    dropPixels: boolean // compressed because RAM is short: drop the uncompressed pixels afterwards
    waiters: ((packed: Uint8Array) => void)[]
  }
  const queue: Job[] = [] // jobs waiting for their turn
  const jobsByTile = new Map<StoredTile, Job>() // queued or being compressed
  const running = new Map<number, Job>() // job number -> the job a worker is doing
  let nextJob = 0

  // Half of the processor's cores (at most 4), leaving the rest for painting and for the browser
  const workerCount = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2)))
  const MAX_RUNNING_PER_WORKER = 4 // each job sends a copy of the tile to a worker, so only a few are sent at a time
  const workers = Array.from({ length: workerCount }, () => {
    const worker = new Worker(new URL('./compressor.ts', import.meta.url), { type: 'module' })
    const slot = { worker, running: 0 }
    worker.onmessage = (e: MessageEvent<{ job: number; packed: Uint8Array }>) => {
      slot.running--
      finishJob(e.data.job, e.data.packed)
    }
    return slot
  })

  function sendJobs() {
    while (queue.length > 0) {
      const slot = workers.reduce((a, b) => (b.running < a.running ? b : a)) // the least busy worker
      if (slot.running >= MAX_RUNNING_PER_WORKER) return
      const job = queue.shift()!
      running.set(nextJob, job)
      slot.worker.postMessage({ job: nextJob, pixels: job.tile.pixels })
      slot.running++
      nextJob++
    }
  }

  function finishJob(id: number, packed: Uint8Array) {
    const job = running.get(id)!
    running.delete(id)
    jobsByTile.delete(job.tile)
    const { tile } = job
    tile.packed = packed
    // If the tile was needed again while it was being compressed, it is in use: keep it ready
    if (job.dropPixels && tile.lastUsed <= job.requestedAt) tile.pixels = undefined
    for (const waiter of job.waiters) waiter(packed)
    sendJobs()
  }

  function compressLater(tile: StoredTile, dropPixels: boolean) {
    let job = jobsByTile.get(tile)
    if (!job) {
      job = { tile, requestedAt: performance.now(), dropPixels, waiters: [] }
      jobsByTile.set(tile, job)
      queue.push(job)
      sendJobs()
    }
    job.dropPixels ||= dropPixels
    return job
  }

  // The compressed bytes of a tile, compressing it now if needed (for saving the project). The pixels are kept
  function pack(tile: StoredTile) {
    if (tile.packed) return Promise.resolve(tile.packed)
    return new Promise<Uint8Array>(resolve => compressLater(tile, false).waiters.push(resolve))
  }

  const fillBuffers = new Map<string, Uint8ClampedArray>() // one per tile size, reused for tiles of a single color

  // The pixels of a stored tile, for sending it to the graphics card. A compressed tile is unpacked and kept
  // uncompressed for a while, since a tile that was needed once is often needed again soon. The pixels of a tile of a
  // single color go into a buffer that is reused, so they are only valid until the next call
  function unpack(tile: StoredTile, width: number, height: number) {
    tile.lastUsed = performance.now()
    if (tile.pixels) return tile.pixels
    if (tile.packed) {
      const pixels = new Uint8ClampedArray(width * height * 4)
      decompress(tile.packed, pixels) // throws if the bytes are damaged
      tile.pixels = pixels
      return pixels
    }
    const size = `${width}x${height}`
    let buffer = fillBuffers.get(size)
    if (!buffer) {
      buffer = new Uint8ClampedArray(width * height * 4)
      fillBuffers.set(size, buffer)
    }
    new Uint32Array(buffer.buffer).fill(tile.color!) // every pixel gets the same color
    return buffer
  }

  // Keep the uncompressed tiles within the budget. "tiles" are all the tiles still in use (by the layers and by the
  // undo history); a tile may appear more than once
  function enforceBudget(tiles: Iterable<StoredTile>) {
    let rawBytes = 0
    const uncompressed = new Set<StoredTile>()
    for (const tile of tiles) {
      if (!tile.pixels || uncompressed.has(tile)) continue
      uncompressed.add(tile)
      rawBytes += tile.pixels.length
    }
    if (rawBytes <= rawBudget) return

    // The least recently used first
    const oldestFirst = [...uncompressed].sort((a, b) => a.lastUsed - b.lastUsed)
    for (const tile of oldestFirst) {
      if (rawBytes <= rawBudget) break
      rawBytes -= tile.pixels!.length
      if (tile.packed)
        tile.pixels = undefined // already compressed: just drop the uncompressed copy
      else compressLater(tile, true) // the pixels are dropped once the worker has compressed them
    }
  }

  function destroy() {
    for (const { worker } of workers) worker.terminate()
  }

  return { pack, unpack, enforceBudget, destroy, isBusy: () => jobsByTile.size > 0 }
}

export type TileMemory = ReturnType<typeof createTileMemory>
