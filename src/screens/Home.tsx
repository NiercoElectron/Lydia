import { deleteAutosaved, listAutosaved, loadAutosaved, type AutosavedDrawing } from '../autosave'
import { errorMessage } from '../errors'
import { useLanguage } from '../i18n'
import { BookOpen, Bug, Code, FileImage, FilePlus, FolderOpen, Paintbrush, Settings, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
// Only the version is taken from package.json (Vite leaves the rest out), so it is always the one npm version set
import { version } from '../../package.json'
import type { LibraryBrush } from '../brushLibrary'
import { DesignerWindow } from '../components/DesignerWindow'
import { NewProjectDialog } from '../components/NewProjectDialog'
import { useProjectOpening } from '../components/projectOpening'
import { SettingsWindow } from '../components/SettingsWindow'
import { WhatsNew } from '../components/WhatsNew'
import { desktop, nameOfFile } from '../desktop'
import type { ProjectData } from '../engine/projectFile'
import { BUG_URL, GITHUB_URL, GUIDE_URL } from '../links'
import { forgetRecentDrawing, listRecentDrawings, openRecentDrawing, type RecentDrawing } from '../recentDrawings'

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

// One drawing of the Recent list (desktop app only): its picture, its name and when it was last opened, which opens it,
// and a button that takes it out of the list (its file stays)
function RecentCard({
  drawing,
  disabled,
  onOpen,
  onForget,
}: {
  drawing: RecentDrawing
  disabled: boolean
  onOpen: () => void
  onForget: () => void
}) {
  const { t, locale } = useLanguage()
  const { file, time, width, height, picture } = drawing
  return (
    <li className="recent-drawing">
      <button className="recent-open" onClick={onOpen} disabled={disabled} title={file}>
        {picture ? <img src={picture} alt="" /> : <FileImage className="recent-blank" size={40} aria-hidden />}
        <span className="recent-name">{nameOfFile(file)}</span>
        <span className="hint">
          {width && height ? `${width}×${height} · ` : ''}
          {new Date(time).toLocaleDateString(locale)}
        </span>
      </button>
      <button
        className="icon-button recent-forget"
        onClick={onForget}
        aria-label={t('Take out of the list')}
        title={t('Take it out of the list. The file stays where it is')}
      >
        <X size={14} aria-hidden />
      </button>
    </li>
  )
}

// The start screen, in three columns as in Krita (decision 92): at the left what to do first and Lydia's pages, in the
// middle the drawings opened lately (in the desktop app) and those to recover, and at the right what's new. The
// settings and the Brush Designer's choices are in windows of their own
export function Home({ gpuMemory, onGpuMemoryChange, onNewProject, onOpenProject, onOpenDesigner }: Props) {
  const { t } = useLanguage()
  const [isChoosingNew, setIsChoosingNew] = useState(false) // the window for a new drawing is open
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isDesignerOpen, setIsDesignerOpen] = useState(false)
  const [isRecovering, setIsRecovering] = useState(false)
  const [autosaved, setAutosaved] = useState<AutosavedDrawing[]>([]) // the drawings that can be recovered
  const [recent, setRecent] = useState<RecentDrawing[]>([]) // the drawings opened lately, in the desktop app
  const opening = useProjectOpening(onOpenProject)
  const isOpening = opening.isOpening || isRecovering

  function showRecent() {
    listRecentDrawings().then(setRecent, error => console.warn('Could not read the recent drawings:', error))
  }
  useEffect(showRecent, [])

  async function handleOpenRecent(file: string) {
    setIsRecovering(true)
    try {
      onOpenProject(await openRecentDrawing(file))
    } catch (error) {
      alert(errorMessage(error, 'LYD-105'))
      showRecent() // one that is gone has left the list
    } finally {
      setIsRecovering(false)
    }
  }

  async function handleForgetRecent(file: string) {
    await forgetRecentDrawing(file)
    showRecent()
  }

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
    setIsRecovering(true)
    try {
      onOpenProject(await loadAutosaved(id))
    } catch (error) {
      alert(errorMessage(error, 'LYD-109'))
    } finally {
      setIsRecovering(false)
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
          <h2>{t('Start')}</h2>
          <div className="home-actions">
            <button onClick={() => setIsChoosingNew(true)}>
              <FilePlus size={20} aria-hidden />
              {t('New project…')}
            </button>
            <button onClick={opening.open} disabled={isOpening}>
              <FolderOpen size={20} aria-hidden />
              {isOpening ? t('Opening…') : t('Open project')}
            </button>
            <button onClick={() => setIsDesignerOpen(true)}>
              <Paintbrush size={20} aria-hidden />
              {t('Brush Designer')}
            </button>
          </div>
          {opening.input}
          <h2>{t('Links')}</h2>
          <ul className="home-links">
            <li>
              <a href={GUIDE_URL} target="_blank" rel="noreferrer">
                <BookOpen size={18} aria-hidden />
                {t('Guide')}
              </a>
            </li>
            <li>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                <Code size={18} aria-hidden />
                GitHub
              </a>
            </li>
            <li>
              <a href={BUG_URL} target="_blank" rel="noreferrer">
                <Bug size={18} aria-hidden />
                {t('Report a bug')}
              </a>
            </li>
          </ul>
        </div>
        <div className="home-files">
          {desktop && (
            <section className="recent">
              <h2>{t('Recent')}</h2>
              {recent.length > 0 ? (
                <ul>
                  {recent.map(drawing => (
                    <RecentCard
                      key={drawing.file}
                      drawing={drawing}
                      disabled={isOpening}
                      onOpen={() => void handleOpenRecent(drawing.file)}
                      onForget={() => void handleForgetRecent(drawing.file)}
                    />
                  ))}
                </ul>
              ) : (
                <p className="hint">{t('The drawings you open or save show here.')}</p>
              )}
            </section>
          )}
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
          {!desktop && autosaved.length === 0 && (
            <p className="hint">{t('Drawings closed with changes that were not saved show here, to recover them.')}</p>
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
