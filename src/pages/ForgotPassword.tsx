import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { siteRootUrl } from '../lib/urls'
import { Alert, Button, Card, Field, inputClass } from '../components/ui'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    // The link returns to the site root with #...type=recovery; main.tsx routes it to /reset-password.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: siteRootUrl() })
    setBusy(false)
    if (error && /rate|seconds/i.test(error.message)) setError('Too many requests. Please wait a minute and try again.')
    else setSent(true) // Don't reveal whether the email has an account.
  }

  return (
    <Card className="mx-auto max-w-md">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      {sent ? (
        <Alert kind="success" className="mt-4">
          If an account exists for {email}, we've sent a link to reset the password. It may take a minute to arrive.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="Email" required>
            {(id) => (
              <input id={id} type="email" autoComplete="email" required className={inputClass}
                value={email} onChange={(e) => setEmail(e.target.value)} />
            )}
          </Field>
          <Button type="submit" className="w-full" disabled={busy || !email}>
            {busy ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
      <p className="mt-4 text-sm"><Link className="text-accent-700 hover:underline" to="/login">Back to log in</Link></p>
    </Card>
  )
}
