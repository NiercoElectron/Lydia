export type Point = {
  x: number
  y: number
}

export type Tool = 'brush' | 'eraser'

export type Stroke = {
  tool: Tool
  color: string
  width: number
  points: Point[]
}

export type Project = {
  width: number
  height: number
  strokes: Stroke[]
}
