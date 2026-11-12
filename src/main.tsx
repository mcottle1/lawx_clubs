import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { supabase } from './lib/supabase'

/**
 * Supabase email links (confirm sign-up, reset password) come back as
 *   <site>/#access_token=...&type=recovery   or   <site>/#error_description=...
 * which would clash with HashRouter's "#/route" URLs. Let Supabase read the
 * tokens first, then swap the hash for the right app route.
 */
async function handleAuthRedirect() {
  const hash = window.location.hash
  if (!/access_token=|error_description=/.test(hash)) return
  const params = new URLSearchParams(hash.slice(1))
  await supabase.auth.getSession() // waits until the URL tokens have been processed
  let route = '/dashboard'
  if (params.get('error_description')) {
    route = `/login?error=${encodeURIComponent(params.get('error_description')!.replace(/\+/g, ' '))}`
  } else if (params.get('type') === 'recovery') {
    route = '/reset-password'
  }
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${route}`)
}

handleAuthRedirect().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {/* HashRouter so deep links work on GitHub Pages without server rewrites. */}
      <HashRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </HashRouter>
    </StrictMode>,
  )
})
