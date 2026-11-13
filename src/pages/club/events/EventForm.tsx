import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PARTNER_CATEGORIES } from '../../../lib/constants'
import { FILE_RULES, publicUrl, uploadClubFile, validateClubFile } from '../../../lib/files'
import { browserTimeZone, toDateTimeInputs, todayIso } from '../../../lib/format'
import { notify } from '../../../lib/notify'
import { supabase } from '../../../lib/supabase'
import type { ClubEvent, Partner } from '../../../lib/types'
import { Alert, Button, Card, Field, inputClass, PageHeader, Spinner } from '../../../components/ui'
import { useClub } from '../ClubContext'
import SchedulingHelp from './SchedulingHelp'

type SponsorMode = 'none' | 'platform' | 'outside'

interface FormState {
  name: string
  date: string
  start: string
  end: string
  description: string
  budget: string
  sponsorMode: SponsorMode
  partnerId: string
  outsideName: string
  partnerReminder: boolean
  partnerReminderDays: string
  potentialNotes: string
  location: string
  locationReminder: boolean
  locationReminderDays: string
}

const EMPTY: FormState = {
  name: '', date: '', start: '12:00', end: '13:00', description: '', budget: '',
  sponsorMode: 'none', partnerId: '', outsideName: '', partnerReminder: true, partnerReminderDays: '14',
  potentialNotes: '', location: '', locationReminder: true, locationReminderDays: '14',
}

function fromEvent(e: ClubEvent): FormState {
  const s = toDateTimeInputs(e.starts_at, e.time_zone)
  const en = toDateTimeInputs(e.ends_at, e.time_zone)
  return {
    name: e.name, date: s.date, start: s.time, end: en.time, description: e.description,
    budget: String(e.budget),
    sponsorMode: e.partner_id ? 'platform' : e.outside_sponsor_name ? 'outside' : 'none',
    partnerId: e.partner_id ?? '', outsideName: e.outside_sponsor_name ?? '',
    partnerReminder: e.partner_reminder_days !== null, partnerReminderDays: String(e.partner_reminder_days ?? 14),
    potentialNotes: e.potential_sponsor_notes ?? '',
    location: e.location ?? '',
    locationReminder: e.location_reminder_days !== null, locationReminderDays: String(e.location_reminder_days ?? 14),
  }
}

/** Create (/club/events/new) or edit (/club/events/:id/edit) an event. */
export default function EventForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const { club, userId, scheduling } = useClub()
  const [existing, setExisting] = useState<ClubEvent | null | undefined>(editing ? undefined : null)
  const [partners, setPartners] = useState<Pick<Partner, 'id' | 'name' | 'city' | 'state' | 'category'>[]>([])
  const [form, setForm] = useState<FormState>(EMPTY)
  const [flyer, setFlyer] = useState<File | null>(null)
  const [flyerError, setFlyerError] = useState<string | null>(null)
  const [removeFlyer, setRemoveFlyer] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))
  const text = (k: keyof FormState) => (e: { target: { value: string } }) => set(k, e.target.value as never)

  useEffect(() => {
    supabase.from('partners').select('id, name, city, state, category').order('name')
      .then(({ data }) => setPartners(data ?? []))
    if (id) {
      supabase.from('events').select('*').eq('id', id).maybeSingle().then(({ data }) => {
        setExisting(data as ClubEvent | null)
        if (data) setForm(fromEvent(data as ClubEvent))
      })
    }
  }, [id])

  if (existing === undefined) return <Spinner />
  if (editing && existing === null) return <Alert>Event not found.</Alert>
  if (existing && new Date(existing.starts_at) <= new Date()) {
    return <Alert kind="warning">This event has already started, so it can no longer be edited.</Alert>
  }

  function validate(): string | null {
    if (!form.name.trim()) return 'Enter an event name.'
    if (!form.date || !form.start || !form.end) return 'Enter the date, start time and end time.'
    const starts = new Date(`${form.date}T${form.start}`)
    const ends = new Date(`${form.date}T${form.end}`)
    if (Number.isNaN(starts.getTime())) return 'Enter a valid date and time.'
    if (starts <= new Date()) return 'The event must start in the future.'
    if (ends <= starts) return 'The end time must be after the start time.'
    const budget = Number(form.budget || '0')
    if (!Number.isFinite(budget) || budget < 0) return 'Enter a budget of $0 or more.'
    if (form.sponsorMode === 'platform' && !form.partnerId) return 'Choose a partner, or pick another sponsor option.'
    if (form.sponsorMode === 'outside' && !form.outsideName.trim()) return 'Enter the outside sponsor’s name.'
    const days = (v: string) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 120
    if (form.sponsorMode === 'none' && form.partnerReminder && !days(form.partnerReminderDays)) return 'Sponsor reminder: choose 1–120 days.'
    if (!form.location.trim() && form.locationReminder && !days(form.locationReminderDays)) return 'Location reminder: choose 1–120 days.'
    if (flyerError) return flyerError
    return null
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const problem = validate()
    if (problem) {
      setError(problem)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setBusy(true)
    setError(null)
    const noSponsor = form.sponsorMode === 'none'
    const noLocation = !form.location.trim()
    const row = {
      name: form.name.trim(),
      starts_at: new Date(`${form.date}T${form.start}`).toISOString(),
      ends_at: new Date(`${form.date}T${form.end}`).toISOString(),
      time_zone: browserTimeZone(),
      description: form.description.trim(),
      budget: Number(form.budget || '0'),
      partner_id: form.sponsorMode === 'platform' ? form.partnerId : null,
      outside_sponsor_name: form.sponsorMode === 'outside' ? form.outsideName.trim() : null,
      partner_reminder_days: noSponsor && form.partnerReminder ? Number(form.partnerReminderDays) : null,
      potential_sponsor_notes: form.potentialNotes.trim() || null,
      location: form.location.trim() || null,
      location_reminder_days: noLocation && form.locationReminder ? Number(form.locationReminderDays) : null,
      ...(removeFlyer ? { flyer_path: null } : {}),
    }

    try {
      let eventId = existing?.id
      if (existing) {
        const { error } = await supabase.from('events').update(row).eq('id', existing.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('events').insert({ ...row, club_id: club.id }).select('id').single()
        if (error) throw error
        eventId = data.id
      }
      // Flyers are filed under Club files automatically (and kept when replaced).
      if (flyer && eventId) {
        const saved = await uploadClubFile({ clubId: club.id, userId, file: flyer, type: 'flyer', eventId })
        const { error } = await supabase.from('events').update({ flyer_path: saved.storage_path }).eq('id', eventId)
        if (error) throw error
      }
      // Email the university admin when the event (newly or again) needs approval.
      if (!existing) {
        notify('event_submitted', eventId!)
      } else if (existing.approval_status !== 'pending') {
        const { data: now } = await supabase.from('events').select('approval_status').eq('id', eventId!).single()
        if (now?.approval_status === 'pending') notify('event_submitted', eventId!)
      }
      navigate(`/club/events/${eventId}`, { replace: true, state: { saved: editing ? 'updated' : 'created' } })
    } catch (err) {
      setError(friendly((err as Error).message))
      setBusy(false)
    }
  }

  const currentFlyer = existing?.flyer_path && !removeFlyer ? publicUrl('flyers', existing.flyer_path) : null

  return (
    <>
      <PageHeader
        title={editing ? `Edit “${existing?.name}”` : 'New event'}
        subtitle="Submitting sends the event to your university administrator for approval."
      />
      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        {error && <Alert>{error}</Alert>}
        {existing && existing.approval_status !== 'pending' && (
          <Alert kind="warning">
            This event is currently <strong>{existing.approval_status}</strong>. Changing its name, time, description,
            location, sponsor or budget sends it back for approval.
          </Alert>
        )}

        <Card className="space-y-4">
          <h2 className="font-medium">Basics</h2>
          <Field label="Event name" required>
            {(fid) => <input id={fid} className={inputClass} maxLength={200} value={form.name} onChange={text('name')} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Date" required>
              {(fid) => <input id={fid} type="date" min={todayIso()} className={inputClass} value={form.date} onChange={text('date')} />}
            </Field>
            <Field label="Start time" required>
              {(fid) => <input id={fid} type="time" className={inputClass} value={form.start} onChange={text('start')} />}
            </Field>
            <Field label="End time" required>
              {(fid) => <input id={fid} type="time" className={inputClass} value={form.end} onChange={text('end')} />}
            </Field>
          </div>
          <Field label="Description">
            {(fid) => <textarea id={fid} rows={4} maxLength={5000} className={inputClass} value={form.description} onChange={text('description')} />}
          </Field>
          <Field label="Event budget (USD)" hint="What you expect to spend. Actual spending is reported after the event.">
            {(fid) => <input id={fid} type="number" min={0} step="0.01" inputMode="decimal" className={inputClass + ' sm:w-48'} value={form.budget} onChange={text('budget')} />}
          </Field>
        </Card>

        <Card className="space-y-4">
          <h2 className="font-medium">Sponsor</h2>
          <fieldset className="space-y-2 text-sm">
            <legend className="sr-only">Sponsor</legend>
            {([
              ['none', 'No sponsor yet'],
              ['platform', 'A partner on this site'],
              ['outside', 'An outside sponsor (not on this site)'],
            ] as const).map(([v, label]) => (
              <label key={v} className="flex items-center gap-2">
                <input type="radio" name="sponsor" className="accent-accent-600" checked={form.sponsorMode === v} onChange={() => set('sponsorMode', v)} />
                {label}
              </label>
            ))}
          </fieldset>
          {form.sponsorMode === 'platform' && (
            <Field label="Partner" required>
              {(fid) => (
                <select id={fid} className={inputClass} value={form.partnerId} onChange={text('partnerId')}>
                  <option value="">Choose a partner…</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.city}, {p.state} ({PARTNER_CATEGORIES.find((c) => c.value === p.category)?.label})
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {form.sponsorMode === 'outside' && (
            <Field label="Sponsor name" required>
              {(fid) => <input id={fid} className={inputClass} maxLength={200} value={form.outsideName} onChange={text('outsideName')} />}
            </Field>
          )}
          {form.sponsorMode === 'none' && (
            <ReminderInput
              label="Email me a reminder to find a sponsor"
              checked={form.partnerReminder}
              onChecked={(v) => set('partnerReminder', v)}
              days={form.partnerReminderDays}
              onDays={(v) => set('partnerReminderDays', v)}
              hint="Sent to your club email with a link to partnership opportunities, if there's still no sponsor."
            />
          )}
          <Field label="Potential sponsor opportunities" hint="What you could offer a sponsor (e.g. “10 minutes to present at lunch”). To post it for partners to see, use “Post a sponsorship opportunity” on the event page.">
            {(fid) => <textarea id={fid} rows={3} maxLength={2000} className={inputClass} value={form.potentialNotes} onChange={text('potentialNotes')} />}
          </Field>
        </Card>

        <Card className="space-y-4">
          <h2 className="font-medium">Location</h2>
          <Field label="Event location" hint="Leave blank if you haven't booked a room yet.">
            {(fid) => <input id={fid} className={inputClass} maxLength={300} placeholder="e.g. JRCB Room 205" value={form.location} onChange={text('location')} />}
          </Field>
          {!form.location.trim() && (
            <>
              <ReminderInput
                label="Email me a reminder to book a room"
                checked={form.locationReminder}
                onChecked={(v) => set('locationReminder', v)}
                days={form.locationReminderDays}
                onDays={(v) => set('locationReminderDays', v)}
                hint="Sent to your club email with your university's scheduling link or instructions, if there's still no location."
              />
              <SchedulingHelp scheduling={scheduling} />
            </>
          )}
        </Card>

        <Card className="space-y-4">
          <h2 className="font-medium">Flyer or photo</h2>
          {currentFlyer && (
            <div className="flex items-center gap-3 text-sm">
              {existing?.flyer_path?.toLowerCase().endsWith('.pdf')
                ? <a href={currentFlyer} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">Current flyer (PDF)</a>
                : <img src={currentFlyer} alt="Current flyer" className="h-24 rounded border border-slate-200 object-cover" />}
              <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setRemoveFlyer(true)}>Remove from event</Button>
            </div>
          )}
          <Field label={currentFlyer ? 'Replace flyer' : 'Upload flyer'} hint={`${FILE_RULES.flyer.hint} It's also saved to your club files.`}>
            {(fid) => (
              <input
                id={fid}
                type="file"
                accept={FILE_RULES.flyer.accept}
                className={inputClass}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  const problem = f ? validateClubFile(f, 'flyer') : null
                  setFlyerError(problem)
                  setFlyer(problem ? null : f)
                }}
              />
            )}
          </Field>
          {flyerError && <p role="alert" className="text-xs text-red-700">{flyerError}</p>}
        </Card>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Link to={existing ? `/club/events/${existing.id}` : '/club'} className="px-4 py-2 text-center text-sm text-slate-600 hover:underline">Cancel</Link>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Submit for approval'}
          </Button>
        </div>
      </form>
    </>
  )
}

function ReminderInput(props: {
  label: string
  checked: boolean
  onChecked: (v: boolean) => void
  days: string
  onDays: (v: string) => void
  hint: string
}) {
  return (
    <div className="rounded-md bg-slate-50 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-accent-600" checked={props.checked} onChange={(e) => props.onChecked(e.target.checked)} />
          <span>{props.label}</span>
        </label>
        {props.checked && (
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={120}
              aria-label="Days before the event"
              className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
              value={props.days}
              onChange={(e) => props.onDays(e.target.value)}
            />
            <span>days before the event</span>
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">{props.hint}</p>
    </div>
  )
}

function friendly(message: string): string {
  if (/start in the future/i.test(message)) return 'The event must start in the future.'
  if (/Past events/i.test(message)) return 'This event has already started and can no longer be edited.'
  return message
}
