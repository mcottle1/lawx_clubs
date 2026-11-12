import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Alert, Button, Card, Field, inputClass } from '../components/ui'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(params.get('error'))
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) {
      setError(
        /confirm/i.test(error.message)
          ? 'Please confirm your email first — check your inbox for the confirmation link.'
          : 'Incorrect email or password.',
      )
      return
    }
    const from = (location.state as { from?: string } | null)?.from
    navigate(from ?? '/dashboard', { replace: true })
  }

  return (
    <Card className="mx-auto max-w-md">
      <h1 className="text-xl font-semibold">Log in</h1>
      <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Email" required>
          {(id) => (
            <input id={id} type="email" autoComplete="email" required className={inputClass}
              value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>
        <Field label="Password" required>
          {(id) => (
            <input id={id} type="password" autoComplete="current-password" required className={inputClass}
              value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>
        <Button type="submit" className="w-full" disabled={busy || !email || !password}>
          {busy ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
      <div className="mt-4 space-y-1 text-sm">
        <p><Link className="text-accent-700 hover:underline" to="/forgot-password">Forgot your password?</Link></p>
        <p className="text-slate-600">
          New here? <Link className="text-accent-700 hover:underline" to="/signup/club">Sign up as a club</Link> or{' '}
          <Link className="text-accent-700 hover:underline" to="/signup/partner">as a partner</Link>.
        </p>
      </div>
    </Card>
  )
}
