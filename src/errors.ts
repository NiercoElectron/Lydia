// Lydia's errors (decision 63). Each has a code that never changes, like LYD-201, and a message in English: errors are
// not translated, so a message reads the same for everyone, and its code can be looked up in docs/errors.md or given
// in a report whatever the language of the interface. The first digit says where an error comes from: 0 inside Lydia
// (something that should never happen), 1 projects, 2 brushes, 3 images and the tray, 4 the browser and the
// graphics card. A code is never given to another error, even once its own is no longer used
export const ERRORS = {
  'LYD-001': 'Unpacked {actual} bytes, expected {expected}.',
  'LYD-101': 'This file is not a Lydia project.',
  'LYD-102': 'This project was made with Lydia 0.1, and this version of Lydia can no longer open it.',
  'LYD-103': 'This project was made with a newer version of Lydia. Update Lydia to open it.',
  'LYD-104': 'This project file is damaged.',
  'LYD-105': 'Could not open the project.',
  'LYD-106': 'Could not save the project.',
  'LYD-201': 'This is not a Lydia brush.',
  'LYD-202': 'This brush was made by a newer version of Lydia. Update Lydia to use it.',
  'LYD-203': 'The tip of this brush is not a PNG image.',
  'LYD-204': 'The tip of this brush is too big ({width}×{height} pixels). The biggest is {max}×{max}.',
  'LYD-205': 'The tip of this brush has no paint.',
  'LYD-206': 'Only Lydia brushes ({extension} files) can be added.',
  'LYD-207': 'This file is too big to be a brush.',
  'LYD-208': 'This brush is already in the list.',
  'LYD-209': 'Could not add this brush.',
  'LYD-210': 'Could not use this brush.',
  'LYD-211': 'Could not delete the brush.',
  'LYD-212': 'Could not save the brush in this browser.',
  'LYD-213': 'Could not make a picture of the tip.',
  'LYD-214': 'Lydia has no brush called "{name}".',
  'LYD-301': 'Not an image Lydia can open.',
  'LYD-302': 'Could not add this image.',
  'LYD-303': 'Could not put the image into the drawing.',
  'LYD-304': 'This image is too big for this browser.',
  'LYD-305': 'Could not export the image.',
  'LYD-401': 'Lydia needs WebGL 2, which this browser or graphics card does not support.',
  'LYD-402': 'Could not start the drawing.',
} as const
export type ErrorCode = keyof typeof ERRORS

// One of Lydia's errors: its message is "LYD-201: This is not a Lydia brush.", with the values put in the places
// like {name}
export class LydiaError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, values: Record<string, string | number> = {}) {
    const text = ERRORS[code].replace(/\{(\w+)\}/g, (place, key: string) =>
      Object.hasOwn(values, key) ? String(values[key]) : place,
    )
    super(`${code}: ${text}`)
    this.code = code
  }
}

// What to tell about an error. One of Lydia's is told as it is. Any other (from the browser, or a mistake in Lydia)
// is told under this code, with its own message in parentheses so that it can be reported, and goes to the console
// too
export function errorMessage(error: unknown, code: ErrorCode) {
  if (error instanceof LydiaError) return error.message
  console.error(error)
  const own = error instanceof Error ? error.message : String(error)
  return `${new LydiaError(code).message} (${own})`
}

// A file that couldn't be imported, and why
export type ImportProblem = { name: string; error: unknown }
