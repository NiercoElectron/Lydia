import { errorMessage } from '../errors'
import { useLanguage, type LanguageChoice } from '../i18n'
import { useEffect, useRef, useState } from 'react'
// Only the version is taken from package.json (Vite leaves the rest out), so it is always the one npm version set
import { version } from '../../package.json'
import { loadBrushes, tipOf, type LibraryBrush } from '../brushLibrary'
import { NewProjectDialog } from '../components/NewProjectDialog'
import { WhatsNew } from '../components/WhatsNew'
import { DEFAULT_PIXEL_TIP_SIZE, DEFAULT_TIP_SIZE, MAX_TIP_SIZE, PIXEL_TIP_SIZES, TIP_SIZES } from '../engine/brushFile'
import type { BrushTip } from '../engine/brushTip'
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
  onOpenDesigner: (tipSize: number, pixel: boolean, brush?: LibraryBrush) => void
}

// Whether a brush's tip can be edited: the Pixel brush's is worked out for each size, so it has no picture to edit
const hasTipPicture = (brush: LibraryBrush) => brush.preset.pixel !== 'round'

// The smallest paper the Brush Designer offers that a tip fits on
function paperFor(tip: BrushTip, pixel: boolean) {
  const side = Math.max(tip.image.width, tip.image.height)
  return [...(pixel ? PIXEL_TIP_SIZES : []), ...TIP_SIZES].find(paper => paper >= side) ?? MAX_TIP_SIZE
}

export function Home({ gpuMemory, onGpuMemoryChange, onNewProject, onOpenProject, onOpenDesigner }: Props) {
  const { t, locale, choice, setChoice } = useLanguage()
  const [isChoosingNew, setIsChoosingNew] = useState(false) // the window for a new drawing is open
  const [isOpening, setIsOpening] = useState(false)
  const [isPixelTip, setIsPixelTip] = useState(false) // the Brush Designer makes a pixel brush
  const [tipSize, setTipSize] = useState(DEFAULT_TIP_SIZE)
  const [brushes, setBrushes] = useState<LibraryBrush[]>([]) // the ones that can be opened in the Brush Designer
  const [startBrushId, setStartBrushId] = useState('') // the one it starts from; '': a new brush
  const fileInputRef = useRef<HTMLInputElement>(null)
  const theme = useTheme()

  useEffect(() => {
    let cancelled = false
    loadBrushes().then(
      loaded => {
        if (!cancelled) setBrushes(loaded.filter(hasTipPicture))
      },
      error => console.warn('Could not read the brushes:', error),
    )
    return () => {
      cancelled = true
    }
  }, [])

  // Open the Brush Designer on a new brush, or on the one to start from, on a paper it fits on
  async function handleOpenDesigner() {
    const brush = brushes.find(each => each.id === startBrushId)
    if (!brush) {
      onOpenDesigner(tipSize, isPixelTip)
      return
    }
    try {
      const pixel = brush.preset.pixel === 'drawn'
      onOpenDesigner(paperFor(await tipOf(brush), pixel), pixel, brush)
    } catch (error) {
      alert(errorMessage(error, 'LYD-210'))
    }
  }

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // reset the input so choosing the same file again still triggers onChange
    if (!file) return

    setIsOpening(true)
    try {
      onOpenProject(parseProject(await file.arrayBuffer()))
    } catch (error) {
      alert(errorMessage(error, 'LYD-105'))
    } finally {
      setIsOpening(false)
    }
  }

  return (
    <main className="home">
      <div className="home-choices">
        <h1>Lydia v{version}</h1>
        <div className="home-actions">
          <button onClick={() => setIsChoosingNew(true)}>{t('New project…')}</button>
          <button onClick={() => fileInputRef.current?.click()} disabled={isOpening}>
            {isOpening ? t('Opening…') : t('Open project')}
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept={PROJECT_EXTENSION} hidden onChange={handleFileChosen} />
        <div
          className="button-group theme-choice"
          title={t(
            "The colors of Lydia's buttons and panels (System: as the computer is set). The drawing never changes",
          )}
        >
          {t('Interface')}
          {THEME_CHOICES.map(([value, label]) => (
            <button key={value} aria-pressed={theme.choice === value} onClick={() => setThemeChoice(value)}>
              {t(label)}
            </button>
          ))}
        </div>
        <label className="theme-choice">
          {t('Language')}
          <select value={choice} onChange={e => setChoice(e.target.value as LanguageChoice)}>
            <option value="system">{t('System')}</option>
            <option value="pt-BR">Português (Brasil)</option>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
        {isChoosingNew && <NewProjectDialog onCreate={onNewProject} onCancel={() => setIsChoosingNew(false)} />}

        <section className="designer-start">
          <h2>{t('Brush Designer')}</h2>
          <p className="hint">{t('Draw the tip of a new brush, try it, and save it to your brushes or as a file.')}</p>
          <label title={t('A new brush, or one of the brushes, to change it or make another from it')}>
            {t('Start from')}
            <select className="start-brush" value={startBrushId} onChange={e => setStartBrushId(e.target.value)}>
              <option value="">{t('A new brush')}</option>
              {brushes.map(brush => (
                <option key={brush.id} value={brush.id}>
                  {brush.isBuiltIn ? t(brush.preset.name, {}, 'brush') : brush.preset.name}
                </option>
              ))}
            </select>
          </label>
          {!startBrushId && (
            <>
              <label>
                {t('Brush')}
                <span className="button-group">
                  <button
                    aria-pressed={!isPixelTip}
                    onClick={() => {
                      setIsPixelTip(false)
                      setTipSize(DEFAULT_TIP_SIZE)
                    }}
                    title={t('A brush for painting: its tip is resized to any size, smoothly')}
                  >
                    {t('Smooth')}
                  </button>
                  <button
                    aria-pressed={isPixelTip}
                    onClick={() => {
                      setIsPixelTip(true)
                      setTipSize(DEFAULT_PIXEL_TIP_SIZE)
                    }}
                    title={t(
                      'A brush for pixel art: its tip is drawn pixel by pixel, and paints at 1×, 2×, 3×… its size',
                    )}
                  >
                    {t('Pixel')}
                  </button>
                </span>
              </label>
              <label>
                {t('Tip paper')}
                <select className="tip-paper" value={tipSize} onChange={e => setTipSize(Number(e.target.value))}>
                  {(isPixelTip ? PIXEL_TIP_SIZES : TIP_SIZES).map(tip => (
                    <option key={tip} value={tip}>
                      {tip}×{tip}
                      {tip === (isPixelTip ? DEFAULT_PIXEL_TIP_SIZE : DEFAULT_TIP_SIZE) ? t(' (default)') : ''}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <button onClick={() => void handleOpenDesigner()}>{t('Open Brush Designer')}</button>
        </section>

        <section className="gpu-memory">
          <h2>{t('Graphics card memory')}</h2>
          <label>
            {t('Memory Lydia may use to keep layers ready')}
            <select value={gpuMemory} onChange={e => onGpuMemoryChange(Number(e.target.value))}>
              {GPU_MEMORY_CHOICES.map(gigabytes => (
                <option key={gigabytes} value={gigabytes}>
                  {gigabytes.toLocaleString(locale)} GB ({tilesInGigabytes(gigabytes).toLocaleString(locale)}{' '}
                  {t('tiles')}
                  {gigabytes === DEFAULT_GPU_MEMORY ? t(', default') : ''})
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            {t('A tile is a square of 256×256 pixels of a layer. A full layer of 10000×10000 has 1,600 tiles.')}
          </p>
          <div className="danger">
            <p className="danger-title">
              <span aria-hidden="true">⚠️</span> {t('Too much can crash Lydia or slow down your whole computer')}
            </p>
            <p>
              {t(
                "Lydia uses this much on top of about 1 GB for the drawing itself. If your graphics card doesn't have that much free memory, the computer starts using its RAM instead and everything becomes very slow, or the browser loses the graphics card: the drawing stops working and changes that weren't saved are lost.",
              )}
            </p>
            <p>
              <strong>{t("Choose at most half of your graphics card's memory.")}</strong>{' '}
              {t(
                'To see it on Windows: Task Manager → Performance → GPU → Dedicated GPU memory. If you are unsure, keep',
              )}{' '}
              {DEFAULT_GPU_MEMORY} GB.
            </p>
          </div>
        </section>
      </div>
      <WhatsNew />
    </main>
  )
}
