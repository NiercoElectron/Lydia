// Exported images say how many of their pixels make an inch (their resolution, in DPI), so that printers and other
// programs know their size on paper: 2480×3508 pixels at 300 DPI is an A4 sheet. Browsers write images without it,
// and programs then guess 72 or 96 DPI, which turns an A4 drawing into a poster of 66×93 cm (decision 32)

export async function withResolution(image: Blob, dpi: number): Promise<Blob> {
  const bytes = new Uint8Array(await image.arrayBuffer())
  if (image.type === 'image/png') return new Blob([pngWithResolution(bytes, dpi)], { type: image.type })
  if (image.type === 'image/jpeg') return new Blob([jpegWithResolution(bytes, dpi)], { type: image.type })
  return image
}

// ----- PNG -----
//
// A PNG is a signature of 8 bytes, then parts called chunks: the length of the data (4 bytes), the type (4 letters),
// the data, and a checksum of the type and the data (4 bytes). The first chunk is "IHDR", with the size of the image.
// The resolution goes in a "pHYs" chunk, in pixels per meter, before the image data

const PNG_SIGNATURE_LENGTH = 8

function pngWithResolution(png: Uint8Array, dpi: number) {
  const perMeter = Math.round(dpi / 0.0254)
  const data = new Uint8Array(9)
  const view = new DataView(data.buffer)
  view.setUint32(0, perMeter) // across
  view.setUint32(4, perMeter) // down
  data[8] = 1 // the unit: the meter
  const chunk = makeChunk('pHYs', data)

  // Where the chunks are; a pHYs chunk that is already there is replaced
  const input = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const afterHeader = PNG_SIGNATURE_LENGTH + 12 + input.getUint32(PNG_SIGNATURE_LENGTH)
  for (let at = PNG_SIGNATURE_LENGTH; at + 12 <= png.length;) {
    const length = input.getUint32(at)
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8))
    if (type === 'pHYs') return join(png.subarray(0, at), chunk, png.subarray(at + 12 + length))
    if (type === 'IDAT') break // the image data: a pHYs chunk can't come after it
    at += 12 + length
  }
  return join(png.subarray(0, afterHeader), chunk, png.subarray(afterHeader))
}

function makeChunk(type: string, data: Uint8Array) {
  const chunk = new Uint8Array(12 + data.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i)
  chunk.set(data, 8)
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)))
  return chunk
}

// The checksum PNG uses (CRC-32)
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ----- JPEG -----
//
// A JPEG starts with the bytes FF D8, usually followed by a part called "APP0" that starts with "JFIF". It has the
// resolution: a unit (1 = dots per inch) and two numbers of 2 bytes, across and down. Without it, one is added

function jpegWithResolution(jpeg: Uint8Array, dpi: number) {
  const hasJfif =
    jpeg[2] === 0xff &&
    jpeg[3] === 0xe0 &&
    String.fromCharCode(...jpeg.subarray(6, 11)) === 'JFIF\0' &&
    jpeg.length > 18
  if (hasJfif) {
    const copy = jpeg.slice()
    const view = new DataView(copy.buffer)
    copy[13] = 1 // dots per inch
    view.setUint16(14, dpi)
    view.setUint16(16, dpi)
    return copy
  }
  const [high, low] = [dpi >> 8, dpi & 0xff]
  // FF E0, its length (16), "JFIF" and a zero, version 1.1, the unit and the resolution, and no small preview picture
  const app0 = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, high, low, high, low, 0, 0])
  return join(jpeg.subarray(0, 2), app0, jpeg.subarray(2))
}

function join(...parts: Uint8Array[]) {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    joined.set(part, at)
    at += part.length
  }
  return joined
}
