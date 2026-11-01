import { LydiaError } from '../errors'

// Reading a ZIP file, which is what a Krita .bundle is: the list at its end says where each file is, and each one is
// stored as it is or compressed with "deflate". Browsers can undo that by themselves, with DecompressionStream

const END_SIGNATURE = 0x06054b50
const ENTRY_SIGNATURE = 0x02014b50
const FILE_SIGNATURE = 0x04034b50
const STORED = 0
const DEFLATED = 8
const MAX_COMMENT = 0xffff
const MAX_FILE_BYTES = 128 * 1024 ** 2 // a file that says it unpacks to more than this isn't one of a bundle's

export type ZipEntry = { name: string; read: () => Promise<Uint8Array> }

// Undo "deflate", which is what PNG and ZIP compress with: "deflate" has a small header and "deflate-raw" none
export async function inflate(bytes: Uint8Array, format: 'deflate' | 'deflate-raw') {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream(format))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// The files of a ZIP file, with nothing unpacked until it is read
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  const first = Math.max(0, end - MAX_COMMENT)
  while (end >= first && view.getUint32(end, true) !== END_SIGNATURE) end--
  if (end < first) throw new LydiaError('LYD-218')

  const entries: ZipEntry[] = []
  const decoder = new TextDecoder()
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== ENTRY_SIGNATURE) throw new LydiaError('LYD-218')
    const method = view.getUint16(at + 10, true)
    const packedSize = view.getUint32(at + 20, true)
    const size = view.getUint32(at + 24, true)
    const nameSize = view.getUint16(at + 28, true)
    const extraSize = view.getUint16(at + 30, true)
    const commentSize = view.getUint16(at + 32, true)
    const place = view.getUint32(at + 42, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameSize))
    at += 46 + nameSize + extraSize + commentSize
    entries.push({
      name,
      read: async () => {
        if (size > MAX_FILE_BYTES || view.getUint32(place, true) !== FILE_SIGNATURE) throw new LydiaError('LYD-218')
        const start = place + 30 + view.getUint16(place + 26, true) + view.getUint16(place + 28, true)
        const packed = bytes.subarray(start, start + packedSize)
        if (method === STORED) return packed
        if (method !== DEFLATED) throw new LydiaError('LYD-218')
        return inflate(packed, 'deflate-raw')
      },
    })
  }
  return entries
}
