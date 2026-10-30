import { LydiaError } from './errors'

// The paper grains that come with Lydia (the PNG images in src/grains, made by scripts/make-brushes.mjs), offered in
// the Brush Designer. A brush keeps its grain's picture in its own file, so these are only where pictures start from

const grainFiles = import.meta.glob<string>('./grains/*.png', { query: '?url', import: 'default', eager: true })

// In the order they are offered
export const GRAINS = ['paper', 'rough', 'canvas', 'noise'] as const
export type GrainId = (typeof GRAINS)[number]

// The picture of one of them, as a PNG
export async function grainPicture(id: GrainId) {
  const url = grainFiles[`./grains/${id}.png`]
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return new Uint8Array(await response.arrayBuffer())
  } catch {
    throw new LydiaError('LYD-217')
  }
}
