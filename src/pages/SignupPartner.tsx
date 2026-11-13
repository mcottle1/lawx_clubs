import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import LogoInput from '../components/LogoInput'
import { MIN_PASSWORD_LENGTH, PARTNER_CATEGORIES, US_STATES } from '../lib/constants'
import { uploadLogo } from '../lib/storage'
import { supabase } from '../lib/supabase'
import { siteRootUrl } from '../lib/urls'
import { signUpErrorMessage } from '../lib/authErrors'
import { Alert, Button, Card, Field, inputClass } from '../components/ui'

export default function SignupPartner() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    partner_name: '', email: '', password: '', confirm: '', city: '', state: '', category: '',
    website: '', description: '', offer_description: '',
  })
  const [open, setOpen] = useState(true)
  const [logo, setLogo] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checkEmail, setCheckEmail] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  function validate(): string | null {
    if (!form.partner_name.trim()) return 'Enter your organization name.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'Enter a valid email.'
    if (form.password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    if (form.password !== form.confirm) return 'Passwords do not match.'
    if (!form.city.trim() || !form.state) return 'Enter your city and state.'
    if (!form.category) return 'Choose a business category.'
    if (form.website && !/^https?:\/\/\S+\.\S+/i.test(form.website.trim())) return 'Website must start with http:// or https://'
    return null
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const problem = validate()
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        emailRedirectTo: siteRootUrl(),
        data: {
          role: 'partner',
          partner_name: form.partner_name.trim(),
          city: form.city.trim(),
          state: form.state,
          category: form.category,
          website: form.website.trim(),
          description: form.description.trim(),
          offer_description: form.offer_description.trim(),
          open_to_sponsorships: open,
        },
      },
    })
    if (error) {
      setBusy(false)
      setError(signUpErrorMessage(error))
      return
    }
    if (!data.session) {
      // Email confirmation is on: we can't upload yet. The dashboard asks for the logo after first login.
      setBusy(false)
      setCheckEmail(true)
      return
    }
    if (logo) {
      try {
        const path = await uploadLogo(data.session.user.id, logo)
        await supabase.from('partners').update({ logo_path: path }).eq('user_id', data.session.user.id)
      } catch {
        /* non-fatal: the dashboard offers another upload */
      }
    }
    setBusy(false)
    navigate('/partner', { replace: true })
  }

  if (checkEmail) {
    return (
      <Card className="mx-auto max-w-md">
        <h1 className="text-xl font-semibold">Check your email</h1>
        <Alert kind="success" className="mt-4">
          We sent a confirmation link to {form.email}. Click it to finish creating your account
          {logo ? ' — then you can upload your logo from your dashboard' : ''}.
        </Alert>
      </Card>
    )
  }

  return (
    <Card className="mx-auto max-w-xl">
      <h1 className="text-xl font-semibold">Sign up as a partner or sponsor</h1>
      <p className="mt-1 text-sm text-slate-600">
        Already have an account? <Link className="text-accent-700 hover:underline" to="/login">Log in</Link>
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Organization name" required>
          {(id) => <input id={id} className={inputClass} maxLength={200} value={form.partner_name} onChange={set('partner_name')} />}
        </Field>
        <Field label="Email" required hint="This is also your login.">
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" required>
            {(id) => <input id={id} autoComplete="address-level2" className={inputClass} value={form.city} onChange={set('city')} />}
          </Field>
          <Field label="State" required>
            {(id) => (
              <select id={id} className={inputClass} value={form.state} onChange={set('state')}>
                <option value="">Choose…</option>
                {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            )}
          </Field>
        </div>
        <Field label="Business category" required>
          {(id) => (
            <select id={id} className={inputClass} value={form.category} onChange={set('category')}>
              <option value="">Choose…</option>
              {PARTNER_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          )}
        </Field>
        <Field label="Website">
          {(id) => <input id={id} type="url" placeholder="https://" className={inputClass} value={form.website} onChange={set('website')} />}
        </Field>
        <LogoInput onChange={setLogo} />
        <Field label="About your organization" hint="Your purpose or focus, in a few sentences.">
          {(id) => <textarea id={id} rows={3} maxLength={2000} className={inputClass} value={form.description} onChange={set('description')} />}
        </Field>
        <Field label="What you're willing to offer" hint='e.g. "We sponsor lunches for 20–60 students in exchange for 10 minutes to present."'>
          {(id) => <textarea id={id} rows={3} maxLength={2000} className={inputClass} value={form.offer_description} onChange={set('offer_description')} />}
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-accent-600" checked={open} onChange={(e) => setOpen(e.target.checked)} />
          <span>Currently open to sponsorships <span className="block text-xs text-slate-500">Clubs only see partners with this turned on.</span></span>
        </label>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Creating account…' : 'Create partner account'}</Button>
      </form>
    </Card>
  )
}
