import { useState } from 'react'
import type { ProjectData } from './engine/projectFile'
import { Home } from './screens/Home'
import { Editor } from './screens/Editor'
import { loadGpuMemory, saveGpuMemory } from './settings'
import './App.css'

function App() {
  const [project, setProject] = useState<ProjectData | null>(null) // null = no project open, show the start screen
  const [gpuMemory, setGpuMemory] = useState(loadGpuMemory)

  function handleGpuMemoryChange(gigabytes: number) {
    setGpuMemory(gigabytes)
    saveGpuMemory(gigabytes)
  }

  if (!project) {
    return (
      <Home
        gpuMemory={gpuMemory}
        onGpuMemoryChange={handleGpuMemoryChange}
        onNewProject={setProject}
        onOpenProject={setProject}
      />
    )
  }
  return <Editor project={project} gpuMemory={gpuMemory} onBack={() => setProject(null)} />
}

export default App
