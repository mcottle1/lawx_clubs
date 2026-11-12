import { useAuth } from '../auth/AuthContext'
import { ButtonLink } from '../components/ui'

export default function Landing() {
  const { session } = useAuth()
  return (
    <section className="py-12 text-center">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Run your club. Find sponsors. Report results.</h1>
      <p className="mx-auto mt-4 max-w-2xl text-slate-600">
        Law Club Manager helps university student organizations plan events, connect with partners and sponsors,
        and report how events went — with university administrators approving events and processing
        reimbursements along the way.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        {session ? (
          <ButtonLink to="/dashboard" className="w-56">Go to your dashboard</ButtonLink>
        ) : (
          <>
            <ButtonLink to="/login" className="w-56">Log in</ButtonLink>
            <ButtonLink to="/signup/club" variant="secondary" className="w-56">Sign up as a Club</ButtonLink>
            <ButtonLink to="/signup/partner" variant="secondary" className="w-56">Sign up as a Partner</ButtonLink>
          </>
        )}
      </div>
      <div className="mx-auto mt-16 grid max-w-4xl gap-6 text-left sm:grid-cols-3">
        {[
          ['For clubs', 'Track your budget and members, plan events on a shared calendar, and find sponsors.'],
          ['For partners', 'Find student organizations to sponsor and see the results of each event.'],
          ['For universities', 'Approve events and partnerships and process reimbursements in one place.'],
        ].map(([title, text]) => (
          <div key={title}>
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-slate-600">{text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
