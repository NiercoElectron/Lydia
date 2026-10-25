import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './theme' // the interface's colors, before anything is shown
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
