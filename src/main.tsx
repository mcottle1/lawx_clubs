import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* HashRouter so deep links work on GitHub Pages without server rewrites. */}
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
