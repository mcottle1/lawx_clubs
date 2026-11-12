import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { MIN_PASSWORD_LENGTH } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { Alert, Button, Card, Field, inputClass, Spinner } from '../components/ui'

/** Reached from the password-reset email (the recovery link signs the user in). */
export default function ResetPassword() {
  const { loading, session } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading) return <Spinner />
  if (!session) {
    return (
      <Card className="mx-auto max-w-md">
        <h1 className="text-xl font-semibold">Link expired</h1>
        <Alert kind="warning" className="mt-4">This password-reset link is invalid or has expired.</Alert>
        <p className="mt-4 text-sm"><Link className="text-accent-700 hover:underline" to="/forgot-password">Request a new link</Link></p>
      </Card>
    )
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
    if (password !== confirm) return setError('Passwords do not match.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(error.message)
    navigate('/dashboard', { replace: true })
  }

  return (
    <Card className="mx-auto max-w-md">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="New password" required hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
          {(id) => <input id={id} type="password" autoComplete="new-password" className={inputClass}
            value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field label="Confirm new password" required>
          {(id) => <input id={id} type="password" autoComplete="new-password" className={inputClass}
            value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</Button>
      </form>
    </Card>
  )
}
