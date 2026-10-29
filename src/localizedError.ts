// Errors keep their English message for logs and carry the source and values for the interface to translate.
export type TranslationValues = Record<string, string | number>

export function interpolate(source: string, values: TranslationValues = {}) {
  return source.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : placeholder,
  )
}

export class LocalizedError extends Error {
  readonly source: string
  readonly values: TranslationValues

  constructor(source: string, values: TranslationValues = {}) {
    super(interpolate(source, values))
    this.source = source
    this.values = values
  }
}

export type ImportProblem = { name: string; error: unknown }
