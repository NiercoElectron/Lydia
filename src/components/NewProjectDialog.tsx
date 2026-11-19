import { useLanguage } from '../i18n'
import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import {
  DEFAULT_BACKGROUND,
  DEFAULT_DPI,
  isDpi,
  MAX_DPI,
  MAX_SIZE,
  MIN_DPI,
  MIN_SIZE,
  newProject,
  type ProjectData,
} from '../engine/projectFile'
import {
  loadNewProjectChoice,
  loadSizePresets,
  MAX_PRESET_NAME,
  saveNewProjectChoice,
  saveSizePresets,
  type SizePreset,
} from '../settings'

type Size = { name: string; width: number; height: number }

const MM = 1 / 25.4 // inches in a millimeter
const CM_PER_INCH = 2.54

// Paper sizes, in inches. In pixels they depend on the resolution: A4 is 2480×3508 at 300 DPI and 1240×1754 at 150
const PAPERS: Size[] = [
  { name: 'A5', width: 148 * MM, height: 210 * MM },
  { name: 'A4', width: 210 * MM, height: 297 * MM },
  { name: 'A3', width: 297 * MM, height: 420 * MM },
  { name: 'US Letter', width: 8.5, height: 11 },
  { name: 'US Legal', width: 8.5, height: 14 },
  { name: 'Tabloid', width: 11, height: 17 },
]
// Screen sizes, in pixels at any resolution
const SCREENS: Size[] = [
  { name: 'Full HD', width: 1920, height: 1080 },
  { name: '4K UHD', width: 3840, height: 2160 },
  { name: 'Square', width: 2048, height: 2048 },
]
// Small papers for pixel art, in pixels
const PIXEL_ART: Size[] = [
  { name: 'Pixel art 64', width: 64, height: 64 },
  { name: 'Pixel art 128', width: 128, height: 128 },
  { name: 'Pixel art 256', width: 256, height: 256 },
]
const COMMON_DPIS = [72, 150, 300, 600] // a button for each; any other resolution can be typed in
const PREVIEW_SIZE = 72 // the longer side of the small picture of the paper, in pixels of the screen

// A paper size in pixels at a resolution
function paperInPixels(name: string, dpi: number): Size {
  const paper = PAPERS.find(p => p.name === name)!
  return { name, width: Math.round(paper.width * dpi), height: Math.round(paper.height * dpi) }
}

// Input values are text; a valid size is a whole number within the limits
function isValidSize(value: string) {
  const n = Number(value)
  return Number.isInteger(n) && n >= MIN_SIZE && n <= MAX_SIZE
}

type Props = {
  onCreate: (project: ProjectData) => void
  onCancel: () => void
}

// The window for a new drawing, laid out like Krita's (decision 92): at the left a list of common sizes, in groups
// (the person's own presets, screens, papers at the resolution chosen, pixel art), and at the right its size, which
// can be typed in, its resolution on paper, and its background, a color or transparent, each on a row of its own.
// What is chosen can be saved as a preset with a name. It opens with the choices made the last time
export function NewProjectDialog({ onCreate, onCancel }: Props) {
  const { t, locale } = useLanguage()
  const id = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [last] = useState(loadNewProjectChoice)
  const [width, setWidth] = useState(String(last?.width ?? 800))
  const [height, setHeight] = useState(String(last?.height ?? 600))
  const [dpi, setDpi] = useState(String(last?.dpi ?? DEFAULT_DPI))
  const [color, setColor] = useState(last?.background ?? DEFAULT_BACKGROUND)
  const [isTransparent, setIsTransparent] = useState(last?.background === null)
  // The paper chosen from the list, if any: it stays the same paper when the resolution changes, so its pixels change
  const [paperName, setPaperName] = useState<string | null>(() => {
    if (!last) return null
    const paper = PAPERS.map(p => paperInPixels(p.name, last.dpi)).find(
      p => p.width === last.width && p.height === last.height,
    )
    return paper?.name ?? null
  })
  const [presets, setPresets] = useState(loadSizePresets)
  // The preset chosen from the list, until anything it set is changed
  const [presetName, setPresetName] = useState<string | null>(null)
  // The name being typed for a new preset, or null when no preset is being saved
  const [newPresetName, setNewPresetName] = useState<string | null>(null)

  // Open as a modal window: the page behind it can't be used until it closes, and Escape closes it. Taking it out of
  // the page closes it too, so there is nothing to undo here
  useEffect(() => {
    const dialog = dialogRef.current!
    if (!dialog.open) dialog.showModal()
  }, [])

  const dpiValue = isDpi(Number(dpi)) ? Number(dpi) : null
  const isValid = isValidSize(width) && isValidSize(height) && dpiValue !== null
  const papers = PAPERS.map(p => paperInPixels(p.name, dpiValue ?? DEFAULT_DPI))
  const chosen = presetName
    ? null
    : (paperName ??
      [...papers, ...SCREENS, ...PIXEL_ART].find(s => s.width === Number(width) && s.height === Number(height))?.name)

  function chooseSize(name: string) {
    const size = [...papers, ...SCREENS, ...PIXEL_ART].find(s => s.name === name)
    if (!size) return
    setPresetName(null)
    setPaperName(PAPERS.some(p => p.name === name) ? name : null)
    setWidth(String(size.width))
    setHeight(String(size.height))
  }

  // A preset sets everything the window chooses, as it was when saved
  function choosePreset(preset: SizePreset) {
    setPresetName(preset.name)
    setPaperName(null)
    setWidth(String(preset.width))
    setHeight(String(preset.height))
    setDpi(String(preset.dpi))
    setIsTransparent(preset.background === null)
    if (preset.background) setColor(preset.background)
  }

  // Typing a size leaves the paper or preset chosen from the list
  function typeSize(setter: (value: string) => void, value: string) {
    setPresetName(null)
    setPaperName(null)
    setter(value)
  }

  function changeDpi(value: string) {
    setPresetName(null)
    setDpi(value)
    if (!paperName || !isDpi(Number(value))) return
    const paper = paperInPixels(paperName, Number(value))
    setWidth(String(paper.width))
    setHeight(String(paper.height))
  }

  function changePresets(next: SizePreset[]) {
    setPresets(next)
    saveSizePresets(next)
  }

  // A preset with the name of one already saved takes its place in the list
  function savePreset() {
    const name = newPresetName?.trim().slice(0, MAX_PRESET_NAME)
    if (!name || !isValid) return
    const preset = {
      name,
      width: Number(width),
      height: Number(height),
      dpi: dpiValue,
      background: isTransparent ? null : color,
    }
    const at = presets.findIndex(p => p.name === name)
    changePresets(at < 0 ? [...presets, preset] : presets.map((p, i) => (i === at ? preset : p)))
    setNewPresetName(null)
    setPaperName(null)
    setPresetName(name)
  }

  function deletePreset(name: string) {
    if (!window.confirm(t('Delete the preset "{name}"? It cannot be undone.', { name }))) return
    changePresets(presets.filter(p => p.name !== name))
    if (presetName === name) setPresetName(null)
  }

  // In the name's field, Enter saves the preset instead of creating the drawing, and Escape leaves the name instead of
  // closing the window
  function handleNameKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      savePreset()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setNewPresetName(null)
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault() // stop the browser from reloading the page
    if (!isValid) return
    const background = isTransparent ? null : color
    const choice = { width: Number(width), height: Number(height), background, dpi: dpiValue }
    saveNewProjectChoice(choice)
    onCreate(newProject(choice.width, choice.height, background, dpiValue))
  }

  // The size on paper, at the chosen resolution
  const onPaper = (pixels: string, unit: number, digits: number) =>
    ((Number(pixels) / dpiValue!) * unit).toLocaleString(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
  const paperSize = isValid
    ? `${t('On paper:')} ${onPaper(width, CM_PER_INCH, 1)} × ${onPaper(height, CM_PER_INCH, 1)} cm ` +
      `(${onPaper(width, 1, 2)} × ${onPaper(height, 1, 2)} in).`
    : ''

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
        <h2>{t('New project')}</h2>
        <div className="new-project-body">
          <div className="new-project-sizes" role="listbox" aria-label={t('Size')}>
            <SizeOption
              name={t('Custom')}
              isChosen={chosen === undefined}
              onChoose={() => {
                // its size is typed in: the width is ready for it
                setPresetName(null)
                setPaperName(null)
                dialogRef.current?.querySelector<HTMLInputElement>('input[type=number]')?.select()
              }}
            />
            {presets.length > 0 && <h3>{t('My presets')}</h3>}
            {presets.map(p => (
              <div key={p.name} className="size-preset">
                <SizeOption
                  name={p.name}
                  detail={`${p.width}×${p.height}, ${p.dpi} DPI`}
                  isChosen={presetName === p.name}
                  hint={p.name}
                  onChoose={() => choosePreset(p)}
                />
                <button
                  type="button"
                  className="icon-button preset-forget"
                  aria-label={t('Delete this preset')}
                  title={t('Delete this preset')}
                  onClick={() => deletePreset(p.name)}
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
            ))}
            <h3>{t('Screen')}</h3>
            {SCREENS.map(s => (
              <SizeOption
                key={s.name}
                name={t(s.name)}
                detail={`${s.width}×${s.height}`}
                isChosen={chosen === s.name}
                onChoose={() => chooseSize(s.name)}
              />
            ))}
            <h3>{`${t('Paper, at')} ${dpiValue ?? DEFAULT_DPI} DPI`}</h3>
            {papers.map(p => {
              const fits = p.width <= MAX_SIZE && p.height <= MAX_SIZE
              return (
                <SizeOption
                  key={p.name}
                  name={t(p.name)}
                  detail={`${p.width}×${p.height}`}
                  isChosen={chosen === p.name}
                  disabled={!fits}
                  hint={fits ? undefined : t('Too big at this resolution')}
                  onChoose={() => chooseSize(p.name)}
                />
              )
            })}
            <h3>{t('Pixel art')}</h3>
            {PIXEL_ART.map(s => (
              <SizeOption
                key={s.name}
                name={`${s.width}×${s.height}`}
                isChosen={chosen === s.name}
                onChoose={() => chooseSize(s.name)}
              />
            ))}
          </div>
          <div className="new-project-settings">
            {/* One row for each choice, its name at the left; only the resolution's own buttons share its row */}
            <div className="new-project-fields">
              <label htmlFor={`${id}-width`}>{t('Width')}</label>
              <div className="new-project-row">
                <input
                  id={`${id}-width`}
                  type="number"
                  min={MIN_SIZE}
                  max={MAX_SIZE}
                  value={width}
                  onChange={e => typeSize(setWidth, e.target.value)}
                />
                <SizeSlider label={t('Width')} value={width} onChange={value => typeSize(setWidth, value)} />
              </div>
              <label htmlFor={`${id}-height`}>{t('Height')}</label>
              <div className="new-project-row">
                <input
                  id={`${id}-height`}
                  type="number"
                  min={MIN_SIZE}
                  max={MAX_SIZE}
                  value={height}
                  onChange={e => typeSize(setHeight, e.target.value)}
                />
                <SizeSlider label={t('Height')} value={height} onChange={value => typeSize(setHeight, value)} />
              </div>
              <label
                htmlFor={`${id}-dpi`}
                title={t('How many pixels make an inch on paper. It matters for printing; the screen ignores it')}
              >
                {t('Resolution')}
              </label>
              <div className="new-project-row">
                <input
                  id={`${id}-dpi`}
                  type="number"
                  min={MIN_DPI}
                  max={MAX_DPI}
                  value={dpi}
                  onChange={e => changeDpi(e.target.value)}
                />
                DPI
                {COMMON_DPIS.map(common => (
                  <button
                    key={common}
                    type="button"
                    aria-pressed={dpiValue === common}
                    onClick={() => changeDpi(String(common))}
                  >
                    {common}
                  </button>
                ))}
              </div>
            </div>
            <p className="hint">
              {t('From')} {MIN_SIZE} {t('to')} {MAX_SIZE} {t('pixels on each side.')}
              <span className="size-on-paper">{paperSize}</span>
            </p>
            <fieldset className="new-project-row">
              <legend>{t('Background')}</legend>
              <input
                type="color"
                aria-label={t('Background color')}
                value={color}
                disabled={isTransparent}
                onChange={e => {
                  setPresetName(null)
                  setColor(e.target.value)
                }}
              />
              <button
                type="button"
                aria-pressed={isTransparent}
                onClick={() => {
                  setPresetName(null)
                  setIsTransparent(t => !t)
                }}
              >
                {t('Transparent')}
              </button>
            </fieldset>
            <div className="paper-preview-box">
              {isValid && (
                <div className={isTransparent ? 'paper-preview transparent' : 'paper-preview'} style={previewStyle} />
              )}
            </div>
            <div className="new-project-row save-preset">
              {newPresetName === null ? (
                <button type="button" disabled={!isValid} onClick={() => setNewPresetName(`${width}×${height}`)}>
                  {t('Save as preset…')}
                </button>
              ) : (
                <>
                  <input
                    type="text"
                    aria-label={t('Name of the preset')}
                    maxLength={MAX_PRESET_NAME}
                    value={newPresetName}
                    autoFocus
                    onFocus={e => e.target.select()}
                    onChange={e => setNewPresetName(e.target.value)}
                    onKeyDown={handleNameKey}
                  />
                  <button type="button" disabled={!newPresetName.trim() || !isValid} onClick={savePreset}>
                    {t('Save preset')}
                  </button>
                  <button type="button" onClick={() => setNewPresetName(null)}>
                    {t('Cancel')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            {t('Cancel')}
          </button>
          <button type="submit" disabled={!isValid}>
            {t('Create')}
          </button>
        </div>
      </form>
    </dialog>
  )
}

// A slider beside a side's field, over the whole range of sizes, with each step of it the same number of pixels.
// While the field holds something that isn't a size, the slider stays at the nearest end
function SizeSlider({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <input
      type="range"
      aria-label={label}
      min={MIN_SIZE}
      max={MAX_SIZE}
      step={1}
      value={Math.min(MAX_SIZE, Math.max(MIN_SIZE, Number(value) || MIN_SIZE))}
      onChange={e => onChange(e.target.value)}
    />
  )
}

// A size in the list: its name, and its pixels when the name doesn't say them (a preset's are under its name)
function SizeOption({
  name,
  detail,
  isChosen,
  disabled = false,
  hint,
  onChoose,
}: {
  name: string
  detail?: string
  isChosen: boolean
  disabled?: boolean
  hint?: string
  onChoose: () => void
}) {
  return (
    <button type="button" role="option" aria-selected={isChosen} disabled={disabled} title={hint} onClick={onChoose}>
      <span className="size-name">{name}</span>
      {detail && <span className="hint">{detail}</span>}
    </button>
  )
}
