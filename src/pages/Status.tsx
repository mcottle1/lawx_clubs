import { useEffect, useState } from 'react'
import { supabase, supabaseConfigured } from '../lib/supabase'

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; count: number }
  | { kind: 'error'; message: string }

/** Developer page: confirms the frontend can reach Supabase and the first migration ran. */
export default function Status() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    if (!supabaseConfigured) {
      setState({ kind: 'error', message: 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. See README.' })
      return
    }
    supabase
      .from('universities')
      .select('id', { count: 'exact', head: true })
      .then(({ count, error }) => {
        if (error) setState({ kind: 'error', message: error.message })
        else setState({ kind: 'ok', count: count ?? 0 })
      })
  }, [])

  return (
    <section className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-6">
      <h1 className="text-xl font-semibold">System status</h1>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-600">Supabase env configured</dt>
          <dd>{supabaseConfigured ? 'Yes' : 'No'}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-600">Database connection</dt>
          <dd role="status">
            {state.kind === 'loading' && 'Checking…'}
            {state.kind === 'ok' && `OK — ${state.count} universities`}
            {state.kind === 'error' && <span className="text-red-700">Error</span>}
          </dd>
        </div>
      </dl>
      {state.kind === 'error' && <p className="mt-4 text-sm text-red-700">{state.message}</p>}
    </section>
  )
}
