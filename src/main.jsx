import { createRoot } from 'react-dom/client'
import './index.css'
import '@tabler/icons-webfont/dist/tabler-icons.min.css'
import App from './App.jsx'
import { initCapacitor } from './lib/capacitor-init'

// Phase 5.am: Native bridge — only runs when inside the Capacitor iOS shell.
// No-op in regular browser / PWA mode.
initCapacitor()

createRoot(document.getElementById('root')).render(<App />)
