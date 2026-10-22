import { useEffect, useRef } from 'react'
import { createEngine, type Engine } from '../engine/engine'
import type { ProjectData } from '../engine/projectFile'

type Props = {
  project: ProjectData
  gpuMemory: number // GB of the graphics card's memory to use (see settings.ts)
  onEngineChange: (engine: Engine | null) => void // the engine once it is ready, null when it goes away
}

// The area where the drawing is shown and painted on. The engine draws into it with the graphics card
export function DrawSpace({ project, gpuMemory, onEngineChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Creating the engine takes a moment. If the component goes away before it is ready (React does that once on
    // purpose in development, to find bugs), the engine is destroyed as soon as it arrives
    let cancelled = false
    let engine: Engine | null = null
    createEngine(hostRef.current!, project, gpuMemory).then(
      created => {
        if (cancelled) {
          created.destroy()
          return
        }
        engine = created
        onEngineChange(created)
        // In development, the engine and its parts can be inspected from the browser's console as "lydia"
        if (import.meta.env.DEV) {
          ;(window as unknown as { lydia?: unknown }).lydia = { engine: created, ...created.inspect() }
        }
      },
      error => {
        if (!cancelled) alert(error instanceof Error ? error.message : 'Could not start the drawing.')
      },
    )
    return () => {
      cancelled = true
      engine?.destroy()
      onEngineChange(null)
    }
  }, [project, gpuMemory, onEngineChange])

  return <div ref={hostRef} className="draw-space" />
}
