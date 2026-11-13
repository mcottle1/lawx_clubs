import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ROLE_LABELS } from '../lib/constants'
import { supabaseConfigured } from '../lib/supabase'
import Logo from './Logo'
import { Alert } from './ui'

export default function Layout() {
  const { session, profile, signOut } = useAuth()
  const navigate = useNavigate()
  const fullWidth = useLocation().pathname === '/' // landing page hero spans the window

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link to={session ? '/dashboard' : '/'} aria-label="CampusBridge home">
            <Logo />
          </Link>
          <nav className="flex items-center gap-3 text-sm" aria-label="Account">
            {session ? (
              <>
                <span className="hidden text-slate-600 sm:inline">
                  {session.user.email}
                  {profile && <span className="ml-2 rounded-full bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-700">{ROLE_LABELS[profile.role]}</span>}
                </span>
                <button
                  type="button"
                  className="rounded-lg px-3 py-1.5 font-semibold text-accent-700 hover:bg-accent-50"
                  onClick={async () => { await signOut(); navigate('/', { replace: true }) }}
                >
                  Log out
                </button>
              </>
            ) : (
              <Link to="/login" className="rounded-lg px-3 py-1.5 font-semibold text-accent-700 hover:bg-accent-50">Log in</Link>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className={fullWidth ? 'w-full flex-1' : 'mx-auto w-full max-w-5xl flex-1 px-4 py-8'}>
        {!supabaseConfigured && (
          <Alert kind="warning" className="m-4 mb-6">
            Supabase isn't configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). See the README.
          </Alert>
        )}
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white py-5 text-center text-xs text-slate-500">
        <span className="font-semibold text-accent-800">CampusBridge</span> · Connecting campus clubs with community partners ·{' '}
        <Link to="/status" className="hover:underline">System status</Link>
      </footer>
    </div>
  )
}
