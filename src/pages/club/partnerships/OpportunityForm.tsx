import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import LogoInput from '../../../components/LogoInput'
import { Alert, Button, Card, Field, inputClass, PageHeader, Spinner } from '../../../components/ui'
import { SUPPORT_TYPES } from '../../../lib/constants'
import { publicUrl } from '../../../lib/files'
import { validateImage } from '../../../lib/storage'
import { supabase } from '../../../lib/supabase'
import type { ClubEvent, Opportunity, SupportType } from '../../../lib/types'
import { useClub } from '../ClubContext'
import DraftHelper from './DraftHelper'

/** /club/opportunities/new[?event=id] and /club/opportunities/:id/edit */
export default function OpportunityForm() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { club, userId } = useClub()
  const [existing, setExisting] = useState<Opportunity | null | undefined>(id ? undefined : null)
  const [events, setEvents] = useState<ClubEvent[]>([])
  const [f, setF] = useState({ title: '', description: '', support_type: 'food' as SupportType, amount_sought: '', event_id: params.get('event') ?? '' })
  const [photo, setPhoto] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  useEffect(() => {
    supabase.from('events').select('*').eq('club_id', club.id).gt('starts_at', new Date().toISOString()).order('starts_at')
      .then(({ data }) => setEvents((data as ClubEvent[]) ?? []))
    if (id) {
      supabase.from('opportunities').select('*').eq('id', id).maybeSingle().then(({ data }) => {
        const o = data as Opportunity | null
        setExisting(o)
        if (o) setF({ title: o.title, description: o.description, support_type: o.support_type, amount_sought: o.amount_sought?.toString() ?? '', event_id: o.event_id ?? '' })
      })
    }
  }, [id, club.id])

  if (existing === undefined) return <Spinner />
  if (id && !existing) return <Alert>Opportunity not found.</Alert>

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!f.title.trim()) return setError('Give the opportunity a title.')
    const amount = f.amount_sought.trim() === '' ? null : Number(f.amount_sought)
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return setError('The amount must be $0 or more.')
    if (photo) {
      const problem = validateImage(photo)
      if (problem) return setError(problem)
    }
    setBusy(true)
    setError(null)
    try {
      let photo_path = existing?.photo_path ?? null
      if (photo) {
        const ext = photo.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
        const path = `${userId}/opportunity-${Date.now()}.${ext}`
        const up = await supabase.storage.from('flyers').upload(path, photo, { contentType: photo.type })
        if (up.error) throw up.error
        photo_path = path
      }
      const row = {
        title: f.title.trim(), description: f.description.trim(), support_type: f.support_type,
        amount_sought: amount, event_id: f.event_id || null, photo_path,
      }
      const { error } = existing
        ? await supabase.from('opportunities').update(row).eq('id', existing.id)
        : await supabase.from('opportunities').insert({ ...row, club_id: club.id })
      if (error) throw error
      navigate('/club/partnerships?tab=opportunities', { replace: true })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title={existing ? 'Edit opportunity' : 'Post a sponsorship opportunity'} subtitle="Describe what a sponsor gets. Open opportunities show up on partners' dashboards." />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <DraftHelper
          supportType={f.support_type}
          event={events.find((e) => e.id === f.event_id) ?? null}
          current={{ title: f.title, description: f.description }}
          onDraft={(d) => setF((prev) => ({
            ...prev,
            ...(d.title !== undefined ? { title: d.title } : {}),
            ...(d.description !== undefined ? { description: d.description } : {}),
            ...(d.amount !== undefined ? { amount_sought: String(d.amount) } : {}),
          }))}
        />
        <Card className="space-y-4">
          <Field label="Title" required>
            {(fid) => <input id={fid} className={inputClass} maxLength={200} placeholder="e.g. Sponsor lunch at our Bar Prep panel" value={f.title} onChange={set('title')} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Support needed">
              {(fid) => (
                <select id={fid} className={inputClass} value={f.support_type} onChange={set('support_type')}>
                  {SUPPORT_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              )}
            </Field>
            <Field label="Amount to ask for (USD)" hint="Optional.">
              {(fid) => <input id={fid} type="number" min={0} step="0.01" inputMode="decimal" className={inputClass} value={f.amount_sought} onChange={set('amount_sought')} />}
            </Field>
            <Field label="For an event">
              {(fid) => (
                <select id={fid} className={inputClass} value={f.event_id} onChange={set('event_id')}>
                  <option value="">Not tied to an event</option>
                  {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name} — {new Date(ev.starts_at).toLocaleDateString()}</option>)}
                </select>
              )}
            </Field>
          </div>
          <Field label="Description" hint="Who attends, how many, what the sponsor gets (time to present, logo on flyers, etc.).">
            {(fid) => <textarea id={fid} rows={6} maxLength={5000} className={inputClass} value={f.description} onChange={set('description')} />}
          </Field>
          <LogoInput label="Photo" currentUrl={publicUrl('flyers', existing?.photo_path)} onChange={setPhoto} />
        </Card>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Link to="/club/partnerships?tab=opportunities" className="px-4 py-2 text-center text-sm text-slate-600 hover:underline">Cancel</Link>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : existing ? 'Save changes' : 'Post opportunity'}</Button>
        </div>
      </form>
    </>
  )
}
