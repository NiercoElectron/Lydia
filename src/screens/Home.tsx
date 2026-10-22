import { useRef, useState } from 'react'
import {
  MAX_SIZE,
  MIN_SIZE,
  newProject,
  parseProject,
  PROJECT_EXTENSION,
  type ProjectData,
} from '../engine/projectFile'

// Input values are text; a valid size is a whole number within the limits
function isValidSize(value: string) {
  const n = Number(value)
  return Number.isInteger(n) && n >= MIN_SIZE && n <= MAX_SIZE
}

type Props = {
  onNewProject: (project: ProjectData) => void
  onOpenProject: (project: ProjectData) => void
}

export function Home({ onNewProject, onOpenProject }: Props) {
  const [width, setWidth] = useState('800')
  const [height, setHeight] = useState('600')
  const [isOpening, setIsOpening] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // reset the input so choosing the same file again still triggers onChange
    if (!file) return

    setIsOpening(true)
    try {
      onOpenProject(parseProject(await file.arrayBuffer()))
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not open the project.')
    } finally {
      setIsOpening(false)
    }
  }

  const isValid = isValidSize(width) && isValidSize(height)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault() // stop the browser from reloading the page
    if (!isValid) return
    onNewProject(newProject(Number(width), Number(height)))
  }

  return (
    <main className="home">
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
        <button type="submit" disabled={!isValid}>
          New project
        </button>
      </form>
      <p className="hint">
        From {MIN_SIZE} to {MAX_SIZE} pixels on each side.
      </p>
      <button onClick={() => fileInputRef.current?.click()} disabled={isOpening}>
        {isOpening ? 'Opening…' : 'Open project'}
      </button>
      <input ref={fileInputRef} type="file" accept={PROJECT_EXTENSION} hidden onChange={handleFileChosen} />
    </main>
  )
}
