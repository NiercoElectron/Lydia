import { deleteAutosaved, listAutosaved, loadAutosaved, type AutosavedDrawing } from '../autosave'
import { errorMessage } from '../errors'
import { useLanguage } from '../i18n'
import { FilePlus, FolderOpen, Paintbrush, Settings } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
// Only the version is taken from package.json (Vite leaves the rest out), so it is always the one npm version set
import { version } from '../../package.json'
import type { LibraryBrush } from '../brushLibrary'
import { DesignerWindow } from '../components/DesignerWindow'
import { NewProjectDialog } from '../components/NewProjectDialog'
import { SettingsWindow } from '../components/SettingsWindow'
import { WhatsNew } from '../components/WhatsNew'
import { parseProject, PROJECT_EXTENSION, type ProjectData } from '../engine/projectFile'

type Props = {
  gpuMemory: number // GB of the graphics card's memory to use (see settings.ts)
  onGpuMemoryChange: (gigabytes: number) => void
  onNewProject: (project: ProjectData) => void
  onOpenProject: (project: ProjectData) => void
  onOpenDesigner: (tipSize: number, pixel: boolean, brush?: LibraryBrush) => void
}

// One drawing that can be recovered, with a picture of it
function RecoverRow({
  drawing,
  onOpen,
  onDelete,
}: {
  drawing: AutosavedDrawing
  onOpen: () => void
  onDelete: () => void
}) {
  const { t, locale } = useLanguage()
  const { thumbnail, width, height, time } = drawing
  const picture = useMemo(() => (thumbnail ? URL.createObjectURL(thumbnail) : undefined), [thumbnail])

  useEffect(
    () => () => {
      if (picture) URL.revokeObjectURL(picture)
    },
    [picture],
  )

  return (
    <li>
      {picture && <img src={picture} alt="" />}
      <span>
        {width}×{height}
        <br />
        <span className="hint">{new Date(time).toLocaleString(locale)}</span>
      </span>
      <button onClick={onOpen}>{t('Open')}</button>
      <button onClick={onDelete}>{t('Delete')}</button>
    </li>
  )
}

// The start screen: what to do first in the middle, with the drawings to recover under it, what's new at the right, and
// the settings and the Brush Designer's choices in windows of their own
export function Home({ gpuMemory, onGpuMemoryChange, onNewProject, onOpenProject, onOpenDesigner }: Props) {
  const { t } = useLanguage()
  const [isChoosingNew, setIsChoosingNew] = useState(false) // the window for a new drawing is open
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isDesignerOpen, setIsDesignerOpen] = useState(false)
  const [isOpening, setIsOpening] = useState(false)
  const [autosaved, setAutosaved] = useState<AutosavedDrawing[]>([]) // the drawings that can be recovered
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    listAutosaved().then(
      drawings => {
        if (!cancelled) setAutosaved(drawings)
      },
      error => console.warn('Could not read the autosaved drawings:', error),
    )
    return () => {
      cancelled = true
    }
  }, [])

  async function handleRecover(id: string) {
    setIsOpening(true)
    try {
      onOpenProject(await loadAutosaved(id))
    } catch (error) {
      alert(errorMessage(error, 'LYD-109'))
    } finally {
      setIsOpening(false)
    }
  }

  async function handleDeleteAutosaved(id: string) {
    if (!window.confirm(t('Delete this copy of the drawing? It cannot be undone.'))) return
    try {
      await deleteAutosaved(id)
      setAutosaved(drawings => drawings.filter(drawing => drawing.id !== id))
    } catch (error) {
      alert(errorMessage(error, 'LYD-109'))
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
      <header className="home-bar">
        <h1>
          Lydia <span className="home-version">v{version}</span>
        </h1>
        <button
          className="top-icon"
          aria-label={t('Settings')}
          title={t('Settings')}
          onClick={() => setIsSettingsOpen(true)}
        >
          <Settings size={20} aria-hidden />
        </button>
      </header>
      <div className="home-body">
        <div className="home-start">
          <div className="home-actions">
            <button onClick={() => setIsChoosingNew(true)}>
              <FilePlus size={20} aria-hidden />
              {t('New project…')}
            </button>
            <button onClick={() => fileInputRef.current?.click()} disabled={isOpening}>
              <FolderOpen size={20} aria-hidden />
              {isOpening ? t('Opening…') : t('Open project')}
            </button>
            <button onClick={() => setIsDesignerOpen(true)}>
              <Paintbrush size={20} aria-hidden />
              {t('Brush Designer')}
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept={PROJECT_EXTENSION} hidden onChange={handleFileChosen} />
          {autosaved.length > 0 && (
            <section className="recover">
              <h2>{t('Recover')}</h2>
              <p className="hint">
                {t('Drawings closed with changes that were not saved, as they were last autosaved.')}
              </p>
              <ul>
                {autosaved.map(drawing => (
                  <RecoverRow
                    key={drawing.id}
                    drawing={drawing}
                    onOpen={() => void handleRecover(drawing.id)}
                    onDelete={() => void handleDeleteAutosaved(drawing.id)}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
        <WhatsNew />
      </div>
      {isChoosingNew && <NewProjectDialog onCreate={onNewProject} onCancel={() => setIsChoosingNew(false)} />}
      <DesignerWindow
        isOpen={isDesignerOpen}
        onClose={() => setIsDesignerOpen(false)}
        onOpenDesigner={onOpenDesigner}
      />
      <SettingsWindow
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        gpuMemory={gpuMemory}
        onGpuMemoryChange={onGpuMemoryChange}
      />
    </main>
  )
}
