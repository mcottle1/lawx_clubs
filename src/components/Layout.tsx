import { Link, Outlet } from 'react-router-dom'

export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-semibold text-slate-900">
            Law Club Manager
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link to="/status" className="text-slate-600 hover:text-accent-600">
              Status
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-500">
        Prototype
      </footer>
    </div>
  )
}
