import { useState } from 'react'
import type { ProjectData } from './engine/projectFile'
import { Home } from './screens/Home'
import { Editor } from './screens/Editor'
import './App.css'

function App() {
  const [project, setProject] = useState<ProjectData | null>(null) // null = no project open, show the start screen

  if (!project) {
    return <Home onNewProject={setProject} onOpenProject={setProject} />
  }
  return <Editor project={project} onBack={() => setProject(null)} />
}

export default App
