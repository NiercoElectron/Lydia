import type { BlendMode } from '../engine/layers'

// The blend modes offered (see blendModes.ts), in groups as in Photoshop: those that darken, those that lighten, those
// that add contrast, the comparison, and those that take part of a color
export const BLEND_MODE_GROUPS: { label: string; modes: [BlendMode, string][] }[] = [
  { label: 'Normal', modes: [['normal', 'Normal']] },
  {
    label: 'Darken',
    modes: [
      ['darken', 'Darken'],
      ['multiply', 'Multiply'],
      ['color-burn', 'Color Burn'],
    ],
  },
  {
    label: 'Lighten',
    modes: [
      ['lighten', 'Lighten'],
      ['screen', 'Screen'],
      ['color-dodge', 'Color Dodge'],
      ['add', 'Add (Linear Dodge)'],
    ],
  },
  {
    label: 'Contrast',
    modes: [
      ['overlay', 'Overlay'],
      ['soft-light', 'Soft Light'],
      ['hard-light', 'Hard Light'],
    ],
  },
  { label: 'Comparison', modes: [['difference', 'Difference']] },
  {
    label: 'Color',
    modes: [
      ['hue', 'Hue'],
      ['saturation', 'Saturation'],
      ['color', 'Color'],
      ['luminosity', 'Luminosity'],
    ],
  },
]
