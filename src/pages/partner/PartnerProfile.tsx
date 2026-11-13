import { useState, type FormEvent } from 'react'
import LogoInput from '../../components/LogoInput'
import { Alert, Button, Card, Field, inputClass, PageHeader } from '../../components/ui'
import { PARTNER_CATEGORIES, US_STATES } from '../../lib/constants'
import { logoUrl, uploadLogo } from '../../lib/storage'
import { supabase } from '../../lib/supabase'
import type { PartnerCategory } from '../../lib/types'
import { usePartner } from './PartnerContext'

export default function PartnerProfile() {
  const { partner, userId, refreshPartner } = usePartner()
  const [f, setF] = useState({
    name: partner.name, city: partner.city, state: partner.state, category: partner.category as PartnerCategory,
    website: partner.website ?? '', description: partner.description, offer_description: partner.offer_description,
  })
  const [open, setOpen] = useState(partner.open_to_sponsorships)
  const [logo, setLogo] = useState<File | null>(null)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!f.name.trim() || !f.city.trim() || !f.state) return setMsg({ kind: 'error', text: 'Name, city and state are required.' })
    if (f.website && !/^https?:\/\/\S+\.\S+/i.test(f.website.trim())) return setMsg({ kind: 'error', text: 'Website must start with http:// or https://' })
    setBusy(true)
    try {
      let logo_path = partner.logo_path
      if (logo) logo_path = await uploadLogo(userId, logo)
      const { error } = await supabase.from('partners').update({
        name: f.name.trim(), city: f.city.trim(), state: f.state, category: f.category,
        website: f.website.trim() || null, description: f.description.trim(), offer_description: f.offer_description.trim(),
        open_to_sponsorships: open, logo_path,
      }).eq('id', partner.id)
      if (error) throw error
      if (logo && partner.logo_path) await supabase.storage.from('logos').remove([partner.logo_path])
      await refreshPartner()
      setLogo(null)
      setMsg({ kind: 'success', text: 'Profile saved.' })
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message })
    }
    setBusy(false)
  }

  return (
    <>
      <PageHeader title="Your profile" subtitle="This is what clubs see in the partner directory." />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        {!partner.logo_path && <Alert kind="warning">Add a logo so clubs recognize you in the partner directory.</Alert>}
        <Card className="space-y-4">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-accent-600" checked={open} onChange={(e) => setOpen(e.target.checked)} />
            <span><span className="font-medium">Currently open to sponsorships</span><span className="block text-xs text-slate-500">When off, you're hidden from the clubs' partner directory.</span></span>
          </label>
          <Field label="Organization name" required>
            {(id) => <input id={id} className={inputClass} maxLength={200} value={f.name} onChange={set('name')} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City" required>
              {(id) => <input id={id} className={inputClass} value={f.city} onChange={set('city')} />}
            </Field>
            <Field label="State" required>
              {(id) => (
                <select id={id} className={inputClass} value={f.state} onChange={set('state')}>
                  {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
              )}
            </Field>
            <Field label="Business category" required>
              {(id) => (
                <select id={id} className={inputClass} value={f.category} onChange={set('category')}>
                  {PARTNER_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              )}
            </Field>
          </div>
          <Field label="Website">
            {(id) => <input id={id} type="url" placeholder="https://" className={inputClass} value={f.website} onChange={set('website')} />}
          </Field>
          <Field label="About your organization">
            {(id) => <textarea id={id} rows={3} maxLength={2000} className={inputClass} value={f.description} onChange={set('description')} />}
          </Field>
          <Field label="What you're willing to offer" hint='e.g. "We sponsor lunches for 20–60 students in exchange for 10 minutes to present."'>
            {(id) => <textarea id={id} rows={3} maxLength={2000} className={inputClass} value={f.offer_description} onChange={set('offer_description')} />}
          </Field>
          <LogoInput label={partner.logo_path ? 'Replace logo' : 'Logo'} currentUrl={logoUrl(partner.logo_path)} onChange={setLogo} />
        </Card>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</Button>
      </form>
    </>
  )
}
