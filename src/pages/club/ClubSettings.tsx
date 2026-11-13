import { useState, type FormEvent } from 'react'
import { todayIso } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { Alert, Button, Card, Field, inputClass, PageHeader } from '../../components/ui'
import { useClub } from './ClubContext'

export default function ClubSettings() {
  const { club, universityName, refreshClub } = useClub()
  const [form, setForm] = useState({
    name: club.name,
    description: club.description,
    initial_budget: String(club.initial_budget),
    budget_year_start: club.budget_year_start,
    instagram: club.social_links?.instagram ?? '',
    tiktok: club.social_links?.tiktok ?? '',
    website: club.social_links?.website ?? '',
  })
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const budget = Number(form.initial_budget)
    if (!form.name.trim()) return setMsg({ kind: 'error', text: 'Enter a club name.' })
    if (form.initial_budget === '' || !Number.isFinite(budget) || budget < 0) return setMsg({ kind: 'error', text: 'Enter an annual budget of $0 or more.' })
    if (!form.budget_year_start) return setMsg({ kind: 'error', text: 'Choose when your budget year starts.' })
    if (form.website && !/^https?:\/\/\S+\.\S+/i.test(form.website.trim())) return setMsg({ kind: 'error', text: 'Website must start with http:// or https://' })
    setBusy(true)
    const social = Object.fromEntries(
      Object.entries({ instagram: form.instagram, tiktok: form.tiktok, website: form.website })
        .map(([k, v]) => [k, v.trim().replace(/^@/, '')]).filter(([, v]) => v),
    )
    const { error } = await supabase.from('clubs').update({
      name: form.name.trim(),
      description: form.description.trim(),
      initial_budget: budget,
      budget_year_start: form.budget_year_start,
      social_links: social,
    }).eq('id', club.id)
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: error.message })
    await refreshClub()
    setMsg({ kind: 'success', text: 'Settings saved.' })
  }

  return (
    <>
      <PageHeader title="Club settings" subtitle={`${universityName} · login ${club.email}`} />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <Card className="space-y-4">
          <h2 className="font-medium">Profile</h2>
          <Field label="Club name" required>
            {(id) => <input id={id} className={inputClass} maxLength={200} value={form.name} onChange={set('name')} />}
          </Field>
          <Field label="Short description">
            {(id) => <textarea id={id} rows={4} maxLength={2000} className={inputClass} value={form.description} onChange={set('description')} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Instagram handle">
              {(id) => <input id={id} className={inputClass} placeholder="byulawfedsoc" value={form.instagram} onChange={set('instagram')} />}
            </Field>
            <Field label="TikTok handle">
              {(id) => <input id={id} className={inputClass} value={form.tiktok} onChange={set('tiktok')} />}
            </Field>
            <Field label="Website">
              {(id) => <input id={id} type="url" placeholder="https://" className={inputClass} value={form.website} onChange={set('website')} />}
            </Field>
          </div>
          <p className="text-xs text-slate-500">Upload your logo on the Files page.</p>
        </Card>
        <Card className="space-y-4">
          <h2 className="font-medium">Budget</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Annual budget (USD)" required>
              {(id) => <input id={id} type="number" min={0} step="0.01" inputMode="decimal" className={inputClass} value={form.initial_budget} onChange={set('initial_budget')} />}
            </Field>
            <Field label="Budget year starts" required hint="Spending reported for events on or after this date counts against the budget. Update it each new year.">
              {(id) => <input id={id} type="date" max={todayIso()} className={inputClass} value={form.budget_year_start} onChange={set('budget_year_start')} />}
            </Field>
          </div>
        </Card>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</Button>
      </form>
    </>
  )
}
