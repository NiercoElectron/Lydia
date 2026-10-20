export type Point = {
    x: number
    y: number
}

export type Stroke = {
    color: string
    width: number
    points: Point[]
}

export type Project = {
  width: number
  height: number
  strokes: Stroke[]
}