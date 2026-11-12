export default function Landing() {
  return (
    <section className="py-12 text-center">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        Run your club. Find sponsors. Report results.
      </h1>
      <p className="mx-auto mt-4 max-w-2xl text-slate-600">
        Law Club Manager helps university student organizations plan events, connect with
        partners and sponsors, and report how events went — with university administrators
        approving events and processing reimbursements along the way.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        {/* Auth flows arrive in Phase 1; buttons are placeholders for now. */}
        <button type="button" disabled className="w-48 rounded-md bg-accent-600 px-4 py-2 font-medium text-white opacity-60">
          Log in
        </button>
        <button type="button" disabled className="w-48 rounded-md border border-accent-600 px-4 py-2 font-medium text-accent-700 opacity-60">
          Sign up as a Club
        </button>
        <button type="button" disabled className="w-48 rounded-md border border-accent-600 px-4 py-2 font-medium text-accent-700 opacity-60">
          Sign up as a Partner
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-500">Sign-up and login are coming in Phase 1.</p>
    </section>
  )
}
