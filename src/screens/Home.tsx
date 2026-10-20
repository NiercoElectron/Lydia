import { useState } from 'react'
import type { Project } from '../drawing/types'

const MIN_SIZE = 16
const MAX_SIZE = 4096

// Input values are text; a valid size is a whole number within the limits
function isValidSize(value: string) {
  const n = Number(value)
  return Number.isInteger(n) && n >= MIN_SIZE && n <= MAX_SIZE
}

type Props = {
  onNewProject: (project: Project) => void
}

export function Home({ onNewProject }: Props) {
  const [width, setWidth] = useState('800')
  const [height, setHeight] = useState('600')

  const isValid = isValidSize(width) && isValidSize(height)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault() // stop the browser from reloading the page
    if (!isValid) return
    onNewProject({ width: Number(width), height: Number(height), strokes: [] })
  }

  return (
    <main>
      <h1>Lydia</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Width
          <input type="number" min={MIN_SIZE} max={MAX_SIZE} value={width} onChange={e => setWidth(e.target.value)} />
        </label>
        <label>
          Height
          <input type="number" min={MIN_SIZE} max={MAX_SIZE} value={height} onChange={e => setHeight(e.target.value)} />
        </label>
        <button type="submit" disabled={!isValid}>New project</button>
      </form>
    </main>
  )
}
