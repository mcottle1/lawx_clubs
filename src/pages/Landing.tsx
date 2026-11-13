import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { ButtonLink } from '../components/ui'

/** Public landing page (the layout gives it the full page width). */
export default function Landing() {
  const { session } = useAuth()
  return (
    <div>
      <section className="relative overflow-hidden bg-gradient-to-br from-accent-900 via-accent-800 to-accent-600 px-4 py-16 text-white sm:py-24">
        {/* decorative glows */}
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-pop-500/30 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-fresh-500/25 blur-3xl" />
        <div className="relative mx-auto max-w-3xl text-center">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-fresh-300 ring-1 ring-white/20">
            Clubs · Sponsors · Universities
          </p>
          <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Bridge your club to the <span className="text-pop-200">sponsors</span> that make events happen.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-accent-100">
            CampusBridge helps student organizations plan events, find partners, and report results — while university
            administrators approve events and process reimbursements in one place.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {session ? (
              <ButtonLink to="/dashboard" variant="pop" className="w-60 py-3 text-base">Go to your dashboard</ButtonLink>
            ) : (
              <>
                <ButtonLink to="/signup/club" variant="pop" className="w-60 py-3 text-base">Sign up as a Club</ButtonLink>
                <ButtonLink to="/signup/partner" variant="light" className="w-60 py-3 text-base">Sign up as a Partner</ButtonLink>
              </>
            )}
          </div>
          {!session && (
            <p className="mt-4 text-sm text-accent-100">
              Already have an account? <a href="#/login" className="font-semibold text-white underline decoration-pop-400 decoration-2 underline-offset-4">Log in</a>
            </p>
          )}
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-5 px-4 py-14 sm:grid-cols-3">
        <Feature color="accent" title="For clubs" icon={<path d="M4 20V10l8-6 8 6v10h-5v-6H9v6z" />}>
          Track your budget and members, plan events on a shared calendar, find sponsors with smart suggestions, and
          report how it went.
        </Feature>
        <Feature color="pop" title="For partners" icon={<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z" />}>
          Discover student organizations to sponsor, send proposals in a few clicks, and see attendance and offers
          redeemed for every event.
        </Feature>
        <Feature color="fresh" title="For universities" icon={<path d="M4 10l8-5 8 5-8 5zM7 12v4c0 1.5 2.2 3 5 3s5-1.5 5-3v-4" />}>
          Approve events and partnerships, process receipts and reimbursements, and keep an overview of every club.
        </Feature>
      </section>
    </div>
  )
}

const COLORS = {
  accent: { chip: 'bg-accent-100 text-accent-700', border: 'border-t-accent-500' },
  pop: { chip: 'bg-pop-100 text-pop-700', border: 'border-t-pop-400' },
  fresh: { chip: 'bg-fresh-100 text-fresh-700', border: 'border-t-fresh-500' },
}

function Feature({ color, title, icon, children }: { color: keyof typeof COLORS; title: string; icon: ReactNode; children: ReactNode }) {
  const c = COLORS[color]
  return (
    <div className={`rounded-xl border border-t-4 border-slate-200 bg-white p-6 shadow-sm ${c.border}`}>
      <span className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${c.chip}`}>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" aria-hidden>{icon}</svg>
      </span>
      <h2 className="mt-4 text-lg font-bold text-accent-900">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{children}</p>
    </div>
  )
}
