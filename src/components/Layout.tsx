import { Link, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ROLE_LABELS } from '../lib/constants'
import { supabaseConfigured } from '../lib/supabase'
import { Alert } from './ui'

export default function Layout() {
  const { session, profile, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link to={session ? '/dashboard' : '/'} className="text-lg font-semibold text-slate-900">
            Law Club Manager
          </Link>
          <nav className="flex items-center gap-3 text-sm" aria-label="Account">
            {session ? (
              <>
                <span className="hidden text-slate-600 sm:inline">
                  {session.user.email}
                  {profile && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{ROLE_LABELS[profile.role]}</span>}
                </span>
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-accent-700 hover:bg-accent-50"
                  onClick={async () => { await signOut(); navigate('/', { replace: true }) }}
                >
                  Log out
                </button>
              </>
            ) : (
              <Link to="/login" className="rounded-md px-2 py-1 text-accent-700 hover:bg-accent-50">Log in</Link>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {!supabaseConfigured && (
          <Alert kind="warning" className="mb-6">
            Supabase isn't configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). See the README.
          </Alert>
        )}
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-500">
        Prototype · <Link to="/status" className="hover:underline">System status</Link>
      </footer>
    </div>
  )
}
