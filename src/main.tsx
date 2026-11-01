import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-ext-400.css'
import '@fontsource/ibm-plex-sans/latin-700.css'
import '@fontsource/ibm-plex-sans/latin-ext-700.css'
import './index.css'
import { UpdateNotice } from './components/UpdateNotice'
import './theme' // the interface's colors, before anything is shown
import App from './App.tsx'
import { desktop } from './desktop'
import { loadInterfaceSize } from './settings'

desktop?.setInterfaceSize(loadInterfaceSize())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <UpdateNotice />
  </StrictMode>,
)
