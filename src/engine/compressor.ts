// Runs in the background (a Web Worker), on another core of the processor: it compresses the tiles that memory.ts sends
// and sends them back, so painting never waits for compression
import { compress } from './lz4'

self.onmessage = (e: MessageEvent<{ job: number; pixels: Uint8ClampedArray }>) => {
  const packed = compress(e.data.pixels)
  // "transfer" hands the bytes over instead of copying them
  self.postMessage({ job: e.data.job, packed }, { transfer: [packed.buffer] })
}
