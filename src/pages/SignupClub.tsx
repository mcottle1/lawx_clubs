import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MIN_PASSWORD_LENGTH } from '../lib/constants'
import { supabase } from '../lib/supabase'
import type { University } from '../lib/types'
import { siteRootUrl } from '../lib/urls'
import { Alert, Button, Card, Field, inputClass } from '../components/ui'

export default function SignupClub() {
  const navigate = useNavigate()
  const [universities, setUniversities] = useState<University[] | null>(null)
  const [form, setForm] = useState({
    club_name: '', university_id: '', email: '', password: '', confirm: '', initial_budget: '', description: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checkEmail, setCheckEmail] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  useEffect(() => {
    supabase.from('universities').select('*').eq('is_participating', true).order('name')
      .then(({ data }) => setUniversities((data as University[]) ?? []))
  }, [])

  function validate(): string | null {
    if (!form.club_name.trim()) return 'Enter your club name.'
    if (!form.university_id) return 'Choose your university.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'Enter a valid club email.'
    if (form.password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    if (form.password !== form.confirm) return 'Passwords do not match.'
    const budget = Number(form.initial_budget)
    if (form.initial_budget === '' || !Number.isFinite(budget) || budget < 0) return 'Enter an annual budget of $0 or more.'
    return null
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const problem = validate()
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    // The database trigger turns this metadata into the club record (and validates it again).
    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        emailRedirectTo: siteRootUrl(),
        data: {
          role: 'club',
          club_name: form.club_name.trim(),
          university_id: form.university_id,
          initial_budget: form.initial_budget,
          description: form.description.trim(),
        },
      },
    })
    setBusy(false)
    if (error) {
      setError(/registered|exists/i.test(error.message)
        ? 'An account with this email already exists. Try logging in.'
        : 'Sign-up failed. Check the form and try again.')
      return
    }
    if (data.session) navigate('/club', { replace: true })
    else setCheckEmail(true) // email confirmation is on
  }

  if (checkEmail) {
    return (
      <Card className="mx-auto max-w-md">
        <h1 className="text-xl font-semibold">Check your email</h1>
        <Alert kind="success" className="mt-4">
          We sent a confirmation link to {form.email}. Click it to finish creating your club account.
        </Alert>
      </Card>
    )
  }

  return (
    <Card className="mx-auto max-w-xl">
      <h1 className="text-xl font-semibold">Sign up as a club</h1>
      <p className="mt-1 text-sm text-slate-600">
        Already have an account? <Link className="text-accent-700 hover:underline" to="/login">Log in</Link>
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Club name" required>
          {(id) => <input id={id} className={inputClass} maxLength={200} value={form.club_name} onChange={set('club_name')} />}
        </Field>
        <Field label="University" required hint="Only universities whose administrator has joined are listed.">
          {(id) => (
            <select id={id} className={inputClass} value={form.university_id} onChange={set('university_id')} disabled={!universities}>
              <option value="">{universities ? 'Choose your university…' : 'Loading…'}</option>
              {universities?.map((u) => (
                <option key={u.id} value={u.id}>{u.name}{u.state ? ` (${u.state})` : ''}</option>
              ))}
            </select>
          )}
        </Field>
        {universities?.length === 0 && (
          <Alert kind="warning">No universities have joined yet. Ask your university's club administrator to contact us.</Alert>
        )}
        <Field label="Club email" required hint="This is also your login.">
          {(id) => <input id={id} type="email" autoComplete="email" className={inputClass} value={form.email} onChange={set('email')} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Password" required hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
            {(id) => <input id={id} type="password" autoComplete="new-password" className={inputClass} value={form.password} onChange={set('password')} />}
          </Field>
          <Field label="Confirm password" required>
            {(id) => <input id={id} type="password" autoComplete="new-password" className={inputClass} value={form.confirm} onChange={set('confirm')} />}
          </Field>
        </div>
        <Field label="Initial annual budget (USD)" required>
          {(id) => <input id={id} type="number" inputMode="decimal" min={0} step="0.01" className={inputClass} value={form.initial_budget} onChange={set('initial_budget')} />}
        </Field>
        <Field label="Short club description" hint="A few sentences about your club. Max 2,000 characters.">
          {(id) => <textarea id={id} rows={4} maxLength={2000} className={inputClass} value={form.description} onChange={set('description')} />}
        </Field>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Creating account…' : 'Create club account'}</Button>
      </form>
    </Card>
  )
}
