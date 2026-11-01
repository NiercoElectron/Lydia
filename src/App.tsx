import { useEffect, useState } from 'react'
import type { LibraryBrush } from './brushLibrary'
import { desktop, readFile, sameItems } from './desktop'
import { parseProject, type ProjectData } from './engine/projectFile'
import { errorMessage } from './errors'
import { useLanguage } from './i18n'
import { BrushDesigner } from './screens/BrushDesigner'
import { Editor } from './screens/Editor'
import { Home } from './screens/Home'
import { loadGpuMemory, saveGpuMemory } from './settings'
import { readTrayFolder, type TrayImage } from './tray'
import './App.css'

// The screen being shown: the start screen, a drawing, or the Brush Designer with the size of its paper, for a smooth
// brush or a pixel brush, and the brush it starts from, if any
type Screen =
  | { name: 'home' }
  | { name: 'editor'; project: ProjectData }
  | { name: 'designer'; tipSize: number; pixel: boolean; brush?: LibraryBrush }

function App() {
  const { t } = useLanguage()
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  // A project the system asked to open, waiting to get to the start screen (see Editor's wantsToLeave)
  const [fileToOpen, setFileToOpen] = useState<string | null>(null)
  const [gpuMemory, setGpuMemory] = useState(loadGpuMemory)
  // The tray (see tray.ts) stays the same from one drawing to the next
  const [tray, setTray] = useState<TrayImage[]>([])

  function handleGpuMemoryChange(gigabytes: number) {
    setGpuMemory(gigabytes)
    saveGpuMemory(gigabytes)
  }

  const openProject = (project: ProjectData) => setScreen({ name: 'editor', project })
  const goHome = () => setScreen({ name: 'home' })

  useEffect(() => {
    desktop?.onFileOpened(setFileToOpen)
    desktop?.takeOpenedFile().then(file => file && setFileToOpen(file))
  }, [])

  useEffect(() => {
    desktop?.setCloseTexts({
      message: t('There are changes that are not saved.'),
      leave: t('Close without saving'),
      stay: t('Cancel'),
    })
  }, [t])

  // What is copied into the Tray folder shows up on coming back to Lydia
  useEffect(() => {
    if (!desktop) return
    const read = () => {
      readTrayFolder().then(
        images => setTray(current => (sameItems(current, images) ? current : images)),
        error => console.warn('Could not read the tray folder:', error),
      )
    }
    read()
    window.addEventListener('focus', read)
    return () => window.removeEventListener('focus', read)
  }, [])

  const isHome = screen.name === 'home'
  useEffect(() => {
    if (!isHome || fileToOpen === null) return
    readFile(fileToOpen).then(
      bytes => {
        setFileToOpen(null)
        setScreen({ name: 'editor', project: { ...parseProject(bytes), file: fileToOpen } })
      },
      error => {
        setFileToOpen(null)
        alert(errorMessage(error, 'LYD-105'))
      },
    )
  }, [isHome, fileToOpen])

  if (screen.name === 'editor') {
    return (
      <Editor
        project={screen.project}
        gpuMemory={gpuMemory}
        tray={tray}
        onTrayChange={setTray}
        wantsToLeave={fileToOpen !== null}
        onStay={() => setFileToOpen(null)}
        onBack={goHome}
      />
    )
  }
  if (screen.name === 'designer') {
    const { tipSize, pixel, brush } = screen
    return <BrushDesigner tipSize={tipSize} pixel={pixel} brush={brush} gpuMemory={gpuMemory} onBack={goHome} />
  }
  return (
    <Home
      gpuMemory={gpuMemory}
      onGpuMemoryChange={handleGpuMemoryChange}
      onNewProject={openProject}
      onOpenProject={openProject}
      onOpenDesigner={(tipSize, pixel, brush) => setScreen({ name: 'designer', tipSize, pixel, brush })}
    />
  )
}

export default App
