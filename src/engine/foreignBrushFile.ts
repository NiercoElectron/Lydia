import type { ForeignBrush } from './foreignBrush'
import { readGimpBrush } from './gimpBrush'
import { readKritaBundle, readKritaPreset } from './kritaBrush'
import { readPhotoshopBrushes } from './photoshopBrush'

export const FOREIGN_BRUSH_EXTENSIONS = ['.kpp', '.bundle', '.gbr', '.gih', '.abr']
export const MAX_FOREIGN_FILE_BYTES = 512 * 1024 ** 2 // a set of brushes with big tips, like Krita's own, is well under this

const extensionOf = (name: string) => name.slice(name.lastIndexOf('.')).toLowerCase()

export const isForeignBrushFile = (name: string) => FOREIGN_BRUSH_EXTENSIONS.includes(extensionOf(name))

// The brushes in a file of another app, and the ones in it that couldn't be read. "name" is the file's name, without its
// folder, for a brush with no name of its own
export async function readForeignBrushFile(
  name: string,
  bytes: Uint8Array,
): Promise<{ brushes: ForeignBrush[]; problems: { name: string; error: unknown }[] }> {
  const extension = extensionOf(name)
  const plainName = name.slice(0, -extension.length)
  if (extension === '.bundle') return readKritaBundle(bytes)
  if (extension === '.kpp') return { brushes: [await readKritaPreset(plainName, bytes)], problems: [] }
  if (extension === '.abr') return { brushes: readPhotoshopBrushes(plainName, bytes), problems: [] }
  return { brushes: readGimpBrush(name, bytes), problems: [] }
}
