import { useRef, useState } from 'react'
// Only the version is taken from package.json (Vite leaves the rest out), so it is always the one npm version set
import { version } from '../../package.json'
import { NewProjectDialog } from '../components/NewProjectDialog'
import { WhatsNew } from '../components/WhatsNew'
import { DEFAULT_PIXEL_TIP_SIZE, DEFAULT_TIP_SIZE, PIXEL_TIP_SIZES, TIP_SIZES } from '../engine/brushFile'
import { parseProject, PROJECT_EXTENSION, type ProjectData } from '../engine/projectFile'
import { tilesInGigabytes } from '../engine/tiles'
import { DEFAULT_GPU_MEMORY, GPU_MEMORY_CHOICES, type ThemeChoice } from '../settings'
import { setThemeChoice, useTheme } from '../theme'

// The choices for the interface's colors (see theme.ts)
const THEME_CHOICES: [ThemeChoice, string][] = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
]

type Props = {
  gpuMemory: number // GB of the graphics card's memory to use (see settings.ts)
  onGpuMemoryChange: (gigabytes: number) => void
  onNewProject: (project: ProjectData) => void
  onOpenProject: (project: ProjectData) => void
  onOpenDesigner: (tipSize: number, pixel: boolean) => void
}

export function Home({ gpuMemory, onGpuMemoryChange, onNewProject, onOpenProject, onOpenDesigner }: Props) {
  const [isChoosingNew, setIsChoosingNew] = useState(false) // the window for a new drawing is open
  const [isOpening, setIsOpening] = useState(false)
  const [isPixelTip, setIsPixelTip] = useState(false) // the Brush Designer makes a pixel brush
  const [tipSize, setTipSize] = useState(DEFAULT_TIP_SIZE)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const theme = useTheme()

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

  return (
    <main className="home">
      <div className="home-choices">
        <h1>Lydia v{version}</h1>
        <div className="home-actions">
          <button onClick={() => setIsChoosingNew(true)}>New project…</button>
          <button onClick={() => fileInputRef.current?.click()} disabled={isOpening}>
            {isOpening ? 'Opening…' : 'Open project'}
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept={PROJECT_EXTENSION} hidden onChange={handleFileChosen} />
        <div
          className="button-group theme-choice"
          title="The colors of Lydia's buttons and panels (System: as the computer is set). The drawing never changes"
        >
          Interface
          {THEME_CHOICES.map(([value, label]) => (
            <button key={value} aria-pressed={theme.choice === value} onClick={() => setThemeChoice(value)}>
              {label}
            </button>
          ))}
        </div>
        {isChoosingNew && <NewProjectDialog onCreate={onNewProject} onCancel={() => setIsChoosingNew(false)} />}

        <section className="designer-start">
          <h2>Brush Designer</h2>
          <p className="hint">Draw the tip of a new brush, try it, and save it to your brushes or as a file.</p>
          <label>
            Brush
            <span className="button-group">
              <button
                aria-pressed={!isPixelTip}
                onClick={() => {
                  setIsPixelTip(false)
                  setTipSize(DEFAULT_TIP_SIZE)
                }}
                title="A brush for painting: its tip is resized to any size, smoothly"
              >
                Smooth
              </button>
              <button
                aria-pressed={isPixelTip}
                onClick={() => {
                  setIsPixelTip(true)
                  setTipSize(DEFAULT_PIXEL_TIP_SIZE)
                }}
                title="A brush for pixel art: its tip is drawn pixel by pixel, and paints at 1×, 2×, 3×… its size"
              >
                Pixel
              </button>
            </span>
          </label>
          <label>
            Tip paper
            <select value={tipSize} onChange={e => setTipSize(Number(e.target.value))}>
              {(isPixelTip ? PIXEL_TIP_SIZES : TIP_SIZES).map(tip => (
                <option key={tip} value={tip}>
                  {tip}×{tip}
                  {tip === (isPixelTip ? DEFAULT_PIXEL_TIP_SIZE : DEFAULT_TIP_SIZE) ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => onOpenDesigner(tipSize, isPixelTip)}>Open Brush Designer</button>
        </section>

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
              much free memory, the computer starts using its RAM instead and everything becomes very slow, or the
              browser loses the graphics card: the drawing stops working and changes that weren't saved are lost.
            </p>
            <p>
              <strong>Choose at most half of your graphics card's memory.</strong> To see it on Windows: Task Manager →
              Performance → GPU → Dedicated GPU memory. If you're not sure, keep {DEFAULT_GPU_MEMORY} GB.
            </p>
          </div>
        </section>
      </div>
      <WhatsNew />
    </main>
  )
}
