import { useRef, useState, type ChangeEvent } from 'react'
import { desktop, readFile } from '../desktop'
import { parseProject, PROJECT_EXTENSION, type ProjectData } from '../engine/projectFile'
import { errorMessage } from '../errors'

// Opening a project, from the start screen or the editor. In the desktop app the system's window opens in Lydia's own
// folder; in a browser, its file chooser, from "input", which goes somewhere in the page
export function useProjectOpening(onOpen: (project: ProjectData) => void) {
  const [isOpening, setIsOpening] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function read(work: () => Promise<ProjectData | null>) {
    setIsOpening(true)
    try {
      const project = await work()
      if (project) onOpen(project)
    } catch (error) {
      alert(errorMessage(error, 'LYD-105'))
    } finally {
      setIsOpening(false)
    }
  }

  function open() {
    if (!desktop) {
      inputRef.current?.click()
      return
    }
    const app = desktop
    void read(async () => {
      const file = await app.chooseToOpen()
      return file ? { ...parseProject(await readFile(file)), file } : null
    })
  }

  function handleChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // so that choosing the same file again still counts
    if (file) void read(async () => parseProject(await file.arrayBuffer()))
  }

  const input = <input ref={inputRef} type="file" accept={PROJECT_EXTENSION} hidden onChange={handleChosen} />
  return { open, isOpening, input }
}
