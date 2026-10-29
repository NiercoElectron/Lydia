import { useLanguage } from '../i18n'
import { useEffect, useRef, useState } from 'react'
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
import { loadNewProjectChoice, saveNewProjectChoice } from '../settings'

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
const COMMON_DPIS = [72, 150, 300, 600] // a button for each; any other resolution can be typed in
const CUSTOM = 'custom'
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

// The window for a new drawing: its size, from a list of common sizes or typed in, its resolution on paper, and its
// background, a color or transparent. It opens with the choices made the last time
export function NewProjectDialog({ onCreate, onCancel }: Props) {
  const { t, locale } = useLanguage()
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

  // Open as a modal window: the page behind it can't be used until it closes, and Escape closes it. Taking it out of
  // the page closes it too, so there is nothing to undo here
  useEffect(() => {
    const dialog = dialogRef.current!
    if (!dialog.open) dialog.showModal()
  }, [])

  const dpiValue = isDpi(Number(dpi)) ? Number(dpi) : null
  const isValid = isValidSize(width) && isValidSize(height) && dpiValue !== null
  const papers = PAPERS.map(p => paperInPixels(p.name, dpiValue ?? DEFAULT_DPI))
  const chosen =
    paperName ?? [...papers, ...SCREENS].find(s => s.width === Number(width) && s.height === Number(height))?.name

  function chooseSize(name: string) {
    const size = papers.find(p => p.name === name) ?? SCREENS.find(s => s.name === name)
    if (!size) return // "Custom": the size stays as it is, to be typed in
    setPaperName(PAPERS.some(p => p.name === name) ? name : null)
    setWidth(String(size.width))
    setHeight(String(size.height))
  }

  // Typing a size leaves the paper chosen from the list
  function typeSize(setter: (value: string) => void, value: string) {
    setPaperName(null)
    setter(value)
  }

  function changeDpi(value: string) {
    setDpi(value)
    if (!paperName || !isDpi(Number(value))) return
    const paper = paperInPixels(paperName, Number(value))
    setWidth(String(paper.width))
    setHeight(String(paper.height))
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
        <label className="new-project-row">
          {t('Size')}
          <select value={chosen ?? CUSTOM} onChange={e => chooseSize(e.target.value)}>
            <option value={CUSTOM}>{t('Custom')}</option>
            <optgroup label={`${t('Paper, at')} ${dpiValue ?? DEFAULT_DPI} DPI`}>
              {papers.map(p => {
                const fits = p.width <= MAX_SIZE && p.height <= MAX_SIZE
                return (
                  <option key={p.name} value={p.name} disabled={!fits}>
                    {t(p.name)} ({p.width}×{p.height}){fits ? '' : t(', too big at this resolution')}
                  </option>
                )
              })}
            </optgroup>
            <optgroup label={t('Screen')}>
              {SCREENS.map(s => (
                <option key={s.name} value={s.name}>
                  {t(s.name)} ({s.width}×{s.height})
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <div className="new-project-row">
          <label>
            {t('Width')}
            <input
              type="number"
              min={MIN_SIZE}
              max={MAX_SIZE}
              value={width}
              onChange={e => typeSize(setWidth, e.target.value)}
            />
          </label>
          <label>
            {t('Height')}
            <input
              type="number"
              min={MIN_SIZE}
              max={MAX_SIZE}
              value={height}
              onChange={e => typeSize(setHeight, e.target.value)}
            />
          </label>
        </div>
        <div className="new-project-row">
          <label title={t('How many pixels make an inch on paper. It matters for printing; the screen ignores it')}>
            {t('Resolution')}
            <input type="number" min={MIN_DPI} max={MAX_DPI} value={dpi} onChange={e => changeDpi(e.target.value)} />
            DPI
          </label>
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
        <p className="hint">
          {t('From')} {MIN_SIZE} {t('to')} {MAX_SIZE} {t('pixels on each side.')} {paperSize}
        </p>
        <fieldset className="new-project-row">
          <legend>{t('Background')}</legend>
          <input
            type="color"
            aria-label={t('Background color')}
            value={color}
            disabled={isTransparent}
            onChange={e => setColor(e.target.value)}
          />
          <button type="button" aria-pressed={isTransparent} onClick={() => setIsTransparent(t => !t)}>
            {t('Transparent')}
          </button>
        </fieldset>
        <div className="paper-preview-box">
          {isValid && (
            <div className={isTransparent ? 'paper-preview transparent' : 'paper-preview'} style={previewStyle} />
          )}
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
