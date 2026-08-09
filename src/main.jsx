import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Imported for its side effect, and before App so the first render already has
// the chosen language. Resources are bundled, not fetched, so init is
// synchronous and there is no loading state to wait on.
import './i18n'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
