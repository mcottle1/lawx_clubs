import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../../../components/Modal'
import { Alert, Button, Card, Field, inputClass } from '../../../components/ui'
import { categoryLabel, PARTNER_CATEGORIES, US_STATES } from '../../../lib/constants'
import { notify } from '../../../lib/notify'
import { logoUrl } from '../../../lib/storage'
import { supabase } from '../../../lib/supabase'
import type { ClubEvent, Partner } from '../../../lib/types'
import { useClub } from '../ClubContext'

/** Partners with "open to sponsorships" on, with filters and a reach-out button. */
export default function PartnerDirectory() {
  const [partners, setPartners] = useState<Partner[] | null>(null)
  const [category, setCategory] = useState('')
  const [state, setState] = useState('')
  const [query, setQuery] = useState('')
  const [contact, setContact] = useState<Partner | null>(null)

  useEffect(() => {
    supabase.from('partners').select('*').eq('open_to_sponsorships', true).order('name')
      .then(({ data }) => setPartners((data as Partner[]) ?? []))
  }, [])

  const shown = useMemo(() => (partners ?? []).filter((p) =>
    (!category || p.category === category) &&
    (!state || p.state === state) &&
    (!query.trim() || `${p.name} ${p.city} ${p.description} ${p.offer_description}`.toLowerCase().includes(query.trim().toLowerCase())),
  ), [partners, category, state, query])

  const statesInUse = useMemo(() => new Set((partners ?? []).map((p) => p.state)), [partners])

  return (
    <>
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Search">
            {(id) => <input id={id} className={inputClass} placeholder="Name, city or keyword" value={query} onChange={(e) => setQuery(e.target.value)} />}
          </Field>
          <Field label="Category">
            {(id) => (
              <select id={id} className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {PARTNER_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            )}
          </Field>
          <Field label="State">
            {(id) => (
              <select id={id} className={inputClass} value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">All locations</option>
                {US_STATES.filter(([code]) => statesInUse.has(code)).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            )}
          </Field>
        </div>
      </Card>
      <p className="mb-3 text-sm text-slate-600" role="status">
        {partners === null ? 'Loading partners…' : `${shown.length} partner${shown.length === 1 ? '' : 's'} open to sponsorships`}
      </p>
      <ul className="grid gap-4 md:grid-cols-2">
        {shown.map((p) => {
          const logo = logoUrl(p.logo_path)
          return (
            <li key={p.id}>
              <Card className="flex h-full flex-col">
                <div className="flex items-start gap-3">
                  {logo ? <img src={logo} alt={`${p.name} logo`} className="h-14 w-14 shrink-0 rounded-md border border-slate-200 object-cover" />
                    : <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-slate-100 text-lg font-semibold text-slate-500">{p.name[0]}</span>}
                  <div className="min-w-0">
                    <h3 className="font-semibold">{p.name}</h3>
                    <p className="text-xs text-slate-500">{categoryLabel(p.category)} · {p.city}, {p.state}</p>
                  </div>
                </div>
                {p.description && <p className="mt-3 text-sm text-slate-700">{p.description}</p>}
                {p.offer_description && (
                  <p className="mt-2 rounded-md bg-accent-50 p-2 text-sm text-accent-700"><span className="font-medium">Offers:</span> {p.offer_description}</p>
                )}
                <div className="mt-auto flex flex-wrap items-center gap-3 pt-4 text-sm">
                  <Button onClick={() => setContact(p)}>Reach out</Button>
                  <a className="text-accent-700 hover:underline" href={`mailto:${p.email}`}>Email {p.email}</a>
                  {p.website && <a className="text-accent-700 hover:underline" href={p.website} target="_blank" rel="noreferrer">Website</a>}
                </div>
              </Card>
            </li>
          )
        })}
      </ul>
      <Modal open={!!contact} onClose={() => setContact(null)} title={`Message ${contact?.name ?? ''}`}>
        {contact && <ReachOutForm partner={contact} />}
      </Modal>
    </>
  )
}

function ReachOutForm({ partner }: { partner: Partner }) {
  const navigate = useNavigate()
  const { club } = useClub()
  const [events, setEvents] = useState<ClubEvent[]>([])
  const [eventId, setEventId] = useState('')
  const [subject, setSubject] = useState('Sponsorship opportunity')
  const [body, setBody] = useState(`Hi ${partner.name},\n\nWe're ${club.name} and we'd love to talk about partnering on an upcoming event.\n\nThanks!`)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('events').select('*').eq('club_id', club.id).gt('starts_at', new Date().toISOString()).order('starts_at')
      .then(({ data }) => setEvents((data as ClubEvent[]) ?? []))
  }, [club.id])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return setError('Write a message.')
    setBusy(true)
    const { data, error } = await supabase.rpc('start_conversation', {
      p_partner_id: partner.id, p_subject: subject.trim() || 'Sponsorship opportunity', p_body: body.trim(),
      p_event_id: eventId || null,
    })
    setBusy(false)
    if (error) return setError(error.message)
    notify('message', data as string)
    navigate(`/club/messages/${data}`)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <Field label="Subject">
        {(id) => <input id={id} className={inputClass} maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />}
      </Field>
      <Field label="About an event (optional)" hint="Lets the partner send a proposal tied to that event.">
        {(id) => (
          <select id={id} className={inputClass} value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">No specific event</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name} — {new Date(ev.starts_at).toLocaleDateString()}</option>)}
          </select>
        )}
      </Field>
      <Field label="Message" required>
        {(id) => <textarea id={id} rows={6} maxLength={5000} className={inputClass} value={body} onChange={(e) => setBody(e.target.value)} />}
      </Field>
      <p className="text-xs text-slate-500">They'll get it on the site and by email.</p>
      <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Sending…' : 'Send message'}</Button>
    </form>
  )
}
