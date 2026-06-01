import { createRoot } from 'react-dom/client'
import './index.css'
import '@tabler/icons-webfont/dist/tabler-icons.min.css'
import App from './App.jsx'
import { initCapacitor } from './lib/capacitor-init'
import { ConfirmProvider } from './components/ConfirmModal'

// Phase 5.am: Native bridge — only runs when inside the Capacitor iOS shell.
initCapacitor()

// Phase 5.au: ConfirmProvider exposes themed alert/confirm/prompt hooks
// (replaces native window dialogs which render as "trunorthapp.com says:"
// scam-looking popups on Android Chrome).
createRoot(document.getElementById('root')).render(
  <ConfirmProvider>
    <App />
  </ConfirmProvider>
)
