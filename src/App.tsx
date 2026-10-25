import { useState } from 'react'
import type { ProjectData } from './engine/projectFile'
import { BrushDesigner } from './screens/BrushDesigner'
import { Editor } from './screens/Editor'
import { Home } from './screens/Home'
import { loadGpuMemory, saveGpuMemory } from './settings'
import type { TrayImage } from './tray'
import './App.css'

// The screen being shown: the start screen, a drawing, or the Brush Designer with the size of its paper, for a smooth
// brush or a pixel brush
type Screen =
  { name: 'home' } | { name: 'editor'; project: ProjectData } | { name: 'designer'; tipSize: number; pixel: boolean }

function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [gpuMemory, setGpuMemory] = useState(loadGpuMemory)
  // The tray (see tray.ts) stays the same from one drawing to the next, until Lydia is closed
  const [tray, setTray] = useState<TrayImage[]>([])

  function handleGpuMemoryChange(gigabytes: number) {
    setGpuMemory(gigabytes)
    saveGpuMemory(gigabytes)
  }

  const openProject = (project: ProjectData) => setScreen({ name: 'editor', project })
  const goHome = () => setScreen({ name: 'home' })

  if (screen.name === 'editor') {
    return <Editor project={screen.project} gpuMemory={gpuMemory} tray={tray} onTrayChange={setTray} onBack={goHome} />
  }
  if (screen.name === 'designer') {
    return <BrushDesigner tipSize={screen.tipSize} pixel={screen.pixel} gpuMemory={gpuMemory} onBack={goHome} />
  }
  return (
    <Home
      gpuMemory={gpuMemory}
      onGpuMemoryChange={handleGpuMemoryChange}
      onNewProject={openProject}
      onOpenProject={openProject}
      onOpenDesigner={(tipSize, pixel) => setScreen({ name: 'designer', tipSize, pixel })}
    />
  )
}

export default App
