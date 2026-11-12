import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MIN_PASSWORD_LENGTH } from '../lib/constants'
import { callFunction, supabase } from '../lib/supabase'
import { Alert, Button, Card, Field, inputClass, Spinner } from '../components/ui'

interface Preview { email: string; university_name: string }

/** University admin opens their emailed invite link: set password + scheduling info. */
export default function AdminInvite() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState({ password: '', confirm: '', scheduling_url: '', scheduling_instructions: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  useEffect(() => {
    callFunction<Preview>('accept-admin-invite', { action: 'preview', token })
      .then(setPreview)
      .catch((e: Error) => setLoadError(e.message))
  }, [token])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (form.password.length < MIN_PASSWORD_LENGTH) return setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    if (form.password !== form.confirm) return setError('Passwords do not match.')
    if (!form.scheduling_url.trim() && !form.scheduling_instructions.trim()) {
      return setError('Add a link to your space-scheduling system, written instructions, or both.')
    }
    if (form.scheduling_url.trim() && !/^https?:\/\/\S+/i.test(form.scheduling_url.trim())) {
      return setError('The scheduling link must start with http:// or https://')
    }
    setBusy(true)
    setError(null)
    try {
      const res = await callFunction<Preview>('accept-admin-invite', {
        action: 'accept',
        token,
        password: form.password,
        scheduling_url: form.scheduling_url.trim(),
        scheduling_instructions: form.scheduling_instructions.trim(),
      })
      await supabase.auth.signOut() // in case someone else was logged in on this browser
      const { error: loginError } = await supabase.auth.signInWithPassword({ email: res.email, password: form.password })
      if (loginError) throw new Error('Your account is ready. Please log in.')
      navigate('/university-admin', { replace: true })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  if (loadError) {
    return (
      <Card className="mx-auto max-w-md">
        <h1 className="text-xl font-semibold">Invite unavailable</h1>
        <Alert kind="warning" className="mt-4">{loadError}</Alert>
      </Card>
    )
  }
  if (!preview) return <Spinner label="Checking your invite…" />

  return (
    <Card className="mx-auto max-w-xl">
      <h1 className="text-xl font-semibold">Set up your administrator account</h1>
      <p className="mt-1 text-sm text-slate-600">
        You're joining as the club administrator for <strong>{preview.university_name}</strong>.
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Email">
          {(id) => <input id={id} className={inputClass} value={preview.email} disabled readOnly />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Password" required hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
            {(id) => <input id={id} type="password" autoComplete="new-password" className={inputClass} value={form.password} onChange={set('password')} />}
          </Field>
          <Field label="Confirm password" required>
            {(id) => <input id={id} type="password" autoComplete="new-password" className={inputClass} value={form.confirm} onChange={set('confirm')} />}
          </Field>
        </div>
        <fieldset className="space-y-4 rounded-md border border-slate-200 p-4">
          <legend className="px-1 text-sm font-medium">How clubs book rooms <span className="font-normal text-slate-500">(one or both; editable later)</span></legend>
          <Field label="Link to your space-scheduling system">
            {(id) => <input id={id} type="url" placeholder="https://" className={inputClass} value={form.scheduling_url} onChange={set('scheduling_url')} />}
          </Field>
          <Field label="Written scheduling instructions">
            {(id) => <textarea id={id} rows={4} maxLength={5000} className={inputClass} value={form.scheduling_instructions} onChange={set('scheduling_instructions')} />}
          </Field>
        </fieldset>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Setting up…' : 'Activate account'}</Button>
      </form>
    </Card>
  )
}
