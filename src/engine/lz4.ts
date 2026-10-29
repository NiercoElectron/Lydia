import { LocalizedError } from '../localizedError'
// LZ4, a very fast way to compress bytes. When some bytes already appeared a little earlier (a row of pixels of the
// same color, a transparent area), it stores "copy N bytes from D bytes back" instead of the bytes themselves.
// Unpacking is little more than copying, which matters because tiles are unpacked while the user paints. The bytes
// follow the official LZ4 block format (https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md), so this file
// could be replaced by a library later

type Bytes = Uint8Array | Uint8ClampedArray

const MIN_MATCH = 4 // repeats shorter than this are kept as they are
const MAX_OFFSET = 65535 // how far back a repeat can be (the distance is stored in 2 bytes)
const HASH_BITS = 14
// Where each group of 4 bytes was last seen, found by a "hash" of the 4 bytes (a number from 0 to 16383)
const lastSeen = new Int32Array(1 << HASH_BITS)

// The packed bytes are a list of "sequences": a token byte (how many new bytes, how long the repeat), the new bytes
// ("literals") as they are, the distance back to the repeat (2 bytes), and, for lengths of 15 or more, extra bytes
export function compress(source: Bytes) {
  const length = source.length
  const packed = new Uint8Array(length + Math.ceil(length / 255) + 16) // big enough even if nothing repeats
  let out = 0 // where we are in "packed"

  // The part of a length beyond 15 goes in extra bytes: 255 means "keep adding"
  function writeLength(n: number) {
    for (n -= 15; n >= 255; n -= 255) packed[out++] = 255
    packed[out++] = n
  }

  // Write the bytes from "literalStart" to "literalEnd" as they are, followed by a repeat (if "matchLength" > 0)
  function writeSequence(literalStart: number, literalEnd: number, matchLength: number, offset: number) {
    const literalLength = literalEnd - literalStart
    const token = out++ // filled in at the end, when both lengths are known
    if (literalLength >= 15) writeLength(literalLength)
    packed.set(source.subarray(literalStart, literalEnd), out)
    out += literalLength
    let matchBits = 0
    if (matchLength > 0) {
      packed[out++] = offset & 255
      packed[out++] = offset >> 8
      if (matchLength - MIN_MATCH >= 15) writeLength(matchLength - MIN_MATCH)
      matchBits = Math.min(matchLength - MIN_MATCH, 15)
    }
    packed[token] = (Math.min(literalLength, 15) << 4) | matchBits
  }

  const read32 = (p: number) => source[p] | (source[p + 1] << 8) | (source[p + 2] << 16) | (source[p + 3] << 24)

  // The format wants the last repeat to start at least 12 bytes before the end, and the last 5 bytes as literals
  const lastMatchStart = length - 12
  const matchEnd = length - 5
  lastSeen.fill(-1)
  let position = 0 // where we are in "source"
  let literalStart = 0 // the first byte that is not written yet
  while (position < lastMatchStart) {
    const sequence = read32(position)
    const hash = Math.imul(sequence, 2654435761) >>> (32 - HASH_BITS)
    const candidate = lastSeen[hash]
    lastSeen[hash] = position
    if (candidate < 0 || position - candidate > MAX_OFFSET || read32(candidate) !== sequence) {
      position++ // these 4 bytes were not seen recently
      continue
    }
    // Found a repeat: see how far it goes
    let matchLength = MIN_MATCH
    while (position + matchLength < matchEnd && source[candidate + matchLength] === source[position + matchLength]) {
      matchLength++
    }
    writeSequence(literalStart, position, matchLength, position - candidate)
    position += matchLength
    literalStart = position
  }
  writeSequence(literalStart, length, 0, 0) // the rest, as it is
  return packed.slice(0, out)
}

// Unpack "packed" into "target", which must be exactly as long as the original bytes
export function decompress(packed: Uint8Array, target: Bytes) {
  let position = 0 // where we are in "packed"
  let out = 0 // where we are in "target"
  while (position < packed.length) {
    const token = packed[position++]
    let literalLength = token >> 4
    if (literalLength === 15) {
      let extra
      do {
        extra = packed[position++]
        literalLength += extra
      } while (extra === 255)
    }
    // New bytes: copy them as they are (one by one when there are few, which is faster than starting a bulk copy)
    if (literalLength < 64) {
      for (const end = position + literalLength; position < end;) target[out++] = packed[position++]
    } else {
      target.set(packed.subarray(position, position + literalLength), out)
      position += literalLength
      out += literalLength
    }
    if (position >= packed.length) break // the last sequence has no repeat

    const offset = packed[position] | (packed[position + 1] << 8)
    position += 2
    let matchLength = token & 15
    if (matchLength === 15) {
      let extra
      do {
        extra = packed[position++]
        matchLength += extra
      } while (extra === 255)
    }
    matchLength += MIN_MATCH

    // A repeat: copy bytes from "offset" back. It can overlap what it writes (a run of one color repeats the same pixel
    // over and over), so long repeats are copied in chunks that double in size and never overlap
    const from = out - offset
    if (matchLength < 64) {
      for (let source = from, end = out + matchLength; out < end;) target[out++] = target[source++]
    } else {
      for (let done = 0; done < matchLength;) {
        const chunk = Math.min(offset + done, matchLength - done)
        target.copyWithin(out + done, from, from + chunk)
        done += chunk
      }
      out += matchLength
    }
  }
  if (out !== target.length)
    throw new LocalizedError('Unpacked {actual} bytes, expected {expected}', { actual: out, expected: target.length })
}
