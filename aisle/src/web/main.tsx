import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import { listenForInstallPrompt } from './lib/install'
import { boot } from './lib/session'
import { sync } from './lib/sync'
import { toast } from './lib/toast'
import { uploads } from './lib/uploads'
import './styles.css'

registerSW({ immediate: true })
listenForInstallPrompt()
sync.onRejected = (message) => toast(message, { tone: 'error' })
uploads.onUploaded = (capture) => sync.putCapture(capture)
void boot()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
