import type { Point, Project, Stroke } from './types'

export const PROJECT_EXTENSION = '.lyd'

const FORMAT = 'lydia'
const VERSION = 1

// What is written inside a .lyd file: the project plus information about the format itself
type ProjectFile = Project & {
  format: typeof FORMAT
  version: typeof VERSION
}

// Turn a project into the text that goes inside a .lyd file
export function serializeProject(project: Project): string {
  const file: ProjectFile = { format: FORMAT, version: VERSION, ...project }
  return JSON.stringify(file)
}

// Read the text of a .lyd file back into a project. Throws an Error with a user-friendly message if the file is not valid
export function parseProject(text: string): Project {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('This file is not a Lydia project.')
  }

  if (!isObject(data) || data.format !== FORMAT) {
    throw new Error('This file is not a Lydia project.')
  }
  if (data.version !== VERSION) {
    throw new Error(`This project uses an unsupported format version (${String(data.version)}).`)
  }
  if (!isNumber(data.width) || !isNumber(data.height) || !Array.isArray(data.strokes) || !data.strokes.every(isStroke)) {
    throw new Error('This project file is damaged.')
  }

  return { width: data.width, height: data.height, strokes: data.strokes }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPoint(value: unknown): value is Point {
  return isObject(value) && isNumber(value.x) && isNumber(value.y)
}

function isStroke(value: unknown): value is Stroke {
  return isObject(value) && typeof value.color === 'string' && isNumber(value.width) && Array.isArray(value.points) && value.points.every(isPoint)
}
