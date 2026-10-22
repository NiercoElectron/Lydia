import { useRef, useState } from 'react'
import {
  MAX_SIZE,
  MIN_SIZE,
  newProject,
  parseProject,
  PROJECT_EXTENSION,
  type ProjectData,
} from '../engine/projectFile'
import { tilesInGigabytes } from '../engine/tiles'
import { DEFAULT_GPU_MEMORY, GPU_MEMORY_CHOICES } from '../settings'

// Input values are text; a valid size is a whole number within the limits
function isValidSize(value: string) {
  const n = Number(value)
  return Number.isInteger(n) && n >= MIN_SIZE && n <= MAX_SIZE
}

type Props = {
  gpuMemory: number // GB of the graphics card's memory to use (see settings.ts)
  onGpuMemoryChange: (gigabytes: number) => void
  onNewProject: (project: ProjectData) => void
  onOpenProject: (project: ProjectData) => void
}

export function Home({ gpuMemory, onGpuMemoryChange, onNewProject, onOpenProject }: Props) {
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

      <section className="gpu-memory">
        <h2>Graphics card memory</h2>
        <label>
          Memory Lydia may use to keep layers ready
          <select value={gpuMemory} onChange={e => onGpuMemoryChange(Number(e.target.value))}>
            {GPU_MEMORY_CHOICES.map(gigabytes => (
              <option key={gigabytes} value={gigabytes}>
                {gigabytes} GB ({tilesInGigabytes(gigabytes).toLocaleString('en-US')} tiles
                {gigabytes === DEFAULT_GPU_MEMORY ? ', default' : ''})
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          A tile is a square of 256×256 pixels of a layer. A full layer of 10000×10000 has 1,600 tiles.
        </p>
        <div className="danger">
          <p className="danger-title">
            <span aria-hidden="true">⚠️</span> Too much can crash Lydia or slow down your whole computer
          </p>
          <p>
            Lydia uses this much on top of about 1 GB for the drawing itself. If your graphics card doesn't have that
            much free memory, the computer starts using its RAM instead and everything becomes very slow, or the browser
            loses the graphics card: the drawing stops working and changes that weren't saved are lost.
          </p>
          <p>
            <strong>Choose at most half of your graphics card's memory.</strong> To see it on Windows: Task Manager →
            Performance → GPU → Dedicated GPU memory. If you're not sure, keep {DEFAULT_GPU_MEMORY} GB.
          </p>
        </div>
      </section>
    </main>
  )
}
