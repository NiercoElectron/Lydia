import { useRef } from 'react'
import './App.css'

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const desenhando = useRef(false) // is the pointer pressed down on the canvas?

  // Convert the pointer position (relative to the window) into canvas coordinates
  function posicao(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function aoPressionar(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = posicao(e)
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(x, y)
    desenhando.current = true
  }

  function aoMover(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!desenhando.current) return // pointer is just hovering, not drawing
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = posicao(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  function aoSoltar() {
    desenhando.current = false
  }

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={600}
      style={{ border: '1px solid #ccc', touchAction: 'none' }}
      onPointerDown={aoPressionar}
      onPointerMove={aoMover}
      onPointerUp={aoSoltar}
      onPointerLeave={aoSoltar}
    />
  )
}

export default App
