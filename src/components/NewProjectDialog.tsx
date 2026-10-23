import { useEffect, useRef, useState } from 'react'
import { DEFAULT_BACKGROUND, MAX_SIZE, MIN_SIZE, newProject, type ProjectData } from '../engine/projectFile'
import { loadNewProjectChoice, saveNewProjectChoice } from '../settings'

// Common sizes for a new drawing. Paper sizes are at 300 DPI, the usual resolution for printing; another resolution
// can be typed in
const PRESET_GROUPS = [
  {
    label: 'Paper, 300 DPI',
    presets: [
      { name: 'A5', width: 1748, height: 2480 },
      { name: 'A4', width: 2480, height: 3508 },
      { name: 'A3', width: 3508, height: 4961 },
      { name: 'US Letter', width: 2550, height: 3300 },
      { name: 'US Legal', width: 2550, height: 4200 },
      { name: 'Tabloid', width: 3300, height: 5100 },
    ],
  },
  {
    label: 'Screen',
    presets: [
      { name: 'Full HD', width: 1920, height: 1080 },
      { name: '4K UHD', width: 3840, height: 2160 },
      { name: 'Square', width: 2048, height: 2048 },
    ],
  },
]
const PRESETS = PRESET_GROUPS.flatMap(group => group.presets)
const CUSTOM = 'custom'
const PREVIEW_SIZE = 72 // the longer side of the small picture of the paper, in pixels of the screen

// Input values are text; a valid size is a whole number within the limits
function isValidSize(value: string) {
  const n = Number(value)
  return Number.isInteger(n) && n >= MIN_SIZE && n <= MAX_SIZE
}

type Props = {
  onCreate: (project: ProjectData) => void
  onCancel: () => void
}

// The window for a new drawing: its size, from a list of common sizes or typed in, and its background, a color or
// transparent. It opens with the choices made the last time
export function NewProjectDialog({ onCreate, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [last] = useState(loadNewProjectChoice)
  const [width, setWidth] = useState(String(last?.width ?? 800))
  const [height, setHeight] = useState(String(last?.height ?? 600))
  const [color, setColor] = useState(last?.background ?? DEFAULT_BACKGROUND)
  const [isTransparent, setIsTransparent] = useState(last?.background === null)

  // Open as a modal window: the page behind it can't be used until it closes, and Escape closes it. Taking it out of
  // the page closes it too, so there is nothing to undo here
  useEffect(() => {
    const dialog = dialogRef.current!
    if (!dialog.open) dialog.showModal()
  }, [])

  const isValid = isValidSize(width) && isValidSize(height)
  const preset = PRESETS.find(p => p.width === Number(width) && p.height === Number(height))

  function choosePreset(name: string) {
    const chosen = PRESETS.find(p => p.name === name)
    if (!chosen) return
    setWidth(String(chosen.width))
    setHeight(String(chosen.height))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault() // stop the browser from reloading the page
    if (!isValid) return
    const background = isTransparent ? null : color
    saveNewProjectChoice({ width: Number(width), height: Number(height), background })
    onCreate(newProject(Number(width), Number(height), background))
  }

  // A small picture of the paper, with its proportions and its background
  const scale = isValid ? PREVIEW_SIZE / Math.max(Number(width), Number(height)) : 0
  const previewStyle = {
    width: Math.max(4, Math.round(Number(width) * scale)),
    height: Math.max(4, Math.round(Number(height) * scale)),
    background: isTransparent ? undefined : color,
  }

  return (
    <dialog ref={dialogRef} className="new-project" onClose={onCancel}>
      <form onSubmit={handleSubmit}>
        <h2>New project</h2>
        <label className="new-project-row">
          Size
          <select value={preset?.name ?? CUSTOM} onChange={e => choosePreset(e.target.value)}>
            <option value={CUSTOM}>Custom</option>
            {PRESET_GROUPS.map(group => (
              <optgroup key={group.label} label={group.label}>
                {group.presets.map(p => (
                  <option key={p.name} value={p.name}>
                    {p.name} ({p.width}×{p.height})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="new-project-row">
          <label>
            Width
            <input type="number" min={MIN_SIZE} max={MAX_SIZE} value={width} onChange={e => setWidth(e.target.value)} />
          </label>
          <label>
            Height
            <input
              type="number"
              min={MIN_SIZE}
              max={MAX_SIZE}
              value={height}
              onChange={e => setHeight(e.target.value)}
            />
          </label>
        </div>
        <p className="hint">
          From {MIN_SIZE} to {MAX_SIZE} pixels on each side.
        </p>
        <fieldset className="new-project-row">
          <legend>Background</legend>
          <input
            type="color"
            aria-label="Background color"
            value={color}
            disabled={isTransparent}
            onChange={e => setColor(e.target.value)}
          />
          <button type="button" aria-pressed={isTransparent} onClick={() => setIsTransparent(t => !t)}>
            Transparent
          </button>
        </fieldset>
        <div className="paper-preview-box">
          {isValid && (
            <div className={isTransparent ? 'paper-preview transparent' : 'paper-preview'} style={previewStyle} />
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={!isValid}>
            Create
          </button>
        </div>
      </form>
    </dialog>
  )
}
