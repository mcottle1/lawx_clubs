import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Modal from '../../../components/Modal'
import ReceiptStatusBadge from '../../../components/ReceiptStatusBadge'
import { Alert, Button, Card, Field, inputClass, PageHeader, Spinner } from '../../../components/ui'
import { formatEventRange, usd } from '../../../lib/format'
import { notify } from '../../../lib/notify'
import { addReceipt, RECEIPT_ACCEPT, receiptUrl, validateReceipt } from '../../../lib/receipts'
import { supabase } from '../../../lib/supabase'
import type { ClubEvent, EventReport as Report, Partner, Receipt } from '../../../lib/types'
import { useClub } from '../ClubContext'
import SocialPosts from '../../../components/suggest/SocialPosts'
import { recapPosts } from '../../../lib/suggest/templates'

type EventRow = ClubEvent & { partners: Pick<Partner, 'id' | 'name' | 'email'> | null }
interface NewReceipt { key: number; file: File | null; amount: string; description: string }

/** /club/events/:id/report — post-event report + receipts, then the follow-up checklist. */
export default function EventReport() {
  const { id } = useParams()
  const { club, userId, universityName } = useClub()
  const [event, setEvent] = useState<EventRow | null | undefined>(undefined)
  const [report, setReport] = useState<Report | null>(null)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [editing, setEditing] = useState(false)
  const [justSubmitted, setJustSubmitted] = useState(false)

  const load = useCallback(async () => {
    const [{ data: e }, { data: r }, { data: rc }] = await Promise.all([
      supabase.from('events').select('*, partners(id, name, email)').eq('id', id!).maybeSingle(),
      supabase.from('event_reports').select('*').eq('event_id', id!).maybeSingle(),
      supabase.from('receipts').select('*').eq('event_id', id!).order('created_at'),
    ])
    setEvent(e as EventRow | null)
    setReport(r as Report | null)
    setReceipts((rc as Receipt[]) ?? [])
  }, [id])
  useEffect(() => { void load() }, [load])

  if (event === undefined) return <Spinner />
  if (event === null) return <Alert>Event not found.</Alert>
  if (new Date(event.ends_at) > new Date()) {
    return <Alert kind="info">You can report on “{event.name}” after it ends ({formatEventRange(event.starts_at, event.ends_at, event.time_zone)}).</Alert>
  }
  if (event.approval_status === 'denied') return <Alert kind="warning">This event wasn't approved, so there's nothing to report.</Alert>

  const sponsorName = event.partners?.name ?? event.outside_sponsor_name

  return (
    <>
      <PageHeader title={`Report: ${event.name}`} subtitle={formatEventRange(event.starts_at, event.ends_at, event.time_zone)} />
      <div className="space-y-4">
        {justSubmitted && (
          <Alert kind="success">
            Report saved. Your budget has been updated{receipts.some((r) => r.status === 'pending') ? ' and your receipts were sent to your university administrator' : ''}.
            {event.partners && ` ${event.partners.name} was emailed the results.`}
          </Alert>
        )}

        {!report || editing ? (
          <ReportForm
            event={event}
            existing={report}
            clubId={club.id}
            userId={userId}
            onCancel={report ? () => setEditing(false) : undefined}
            onSaved={async () => {
              notify('report_submitted', event.id)
              setEditing(false)
              setJustSubmitted(true)
              await load()
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          />
        ) : (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">Your report</h2>
              <Button variant="secondary" className="px-3 py-1 text-sm" onClick={() => setEditing(true)}>Edit report</Button>
            </div>
            <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-3">
              <div><dt className="text-slate-500">Attendees</dt><dd className="text-lg font-semibold">{report.attendees}</dd></div>
              <div><dt className="text-slate-500">Amount spent</dt><dd className="text-lg font-semibold">{usd.format(Number(report.amount_spent))}</dd></div>
              <div><dt className="text-slate-500">Offers redeemed</dt><dd className="text-lg font-semibold">{report.offers_redeemed ?? '—'}</dd></div>
              {report.notes && <div className="sm:col-span-3"><dt className="text-slate-500">Notes</dt><dd className="whitespace-pre-line">{report.notes}</dd></div>}
            </dl>
          </Card>
        )}

        {report && (
          <ReceiptsSection
            receipts={receipts}
            add={async (file, amount, description) => {
              await addReceipt({ userId, clubId: club.id, eventId: event.id, reportId: report.id, file, amount, description })
              notify('report_submitted', event.id)
              await load()
            }}
            remove={async (r) => {
              await supabase.from('receipts').delete().eq('id', r.id)
              await supabase.storage.from('receipts').remove([r.storage_path])
              await load()
            }}
          />
        )}

        {report && <FollowUp event={event} report={report} sponsorName={sponsorName} />}

        {report && (
          <Card>
            <h2 className="font-medium">Social media recap</h2>
            <p className="mb-3 mt-1 text-sm text-slate-600">Post ideas filled in with your numbers — copy one, add a photo, and tag your sponsor.</p>
            <SocialPosts
              kind="recap"
              id={event.id}
              templates={recapPosts({
                clubName: club.name, universityName, eventName: event.name, attendees: report.attendees,
                sponsorName, offersRedeemed: report.offers_redeemed, notes: report.notes,
              })}
            />
          </Card>
        )}

        <Link to={`/club/events/${event.id}`} className="inline-block text-sm text-accent-700 hover:underline">← Back to event</Link>
      </div>
    </>
  )
}

function ReportForm({
  event, existing, clubId, userId, onSaved, onCancel,
}: {
  event: EventRow
  existing: Report | null
  clubId: string
  userId: string
  onSaved: () => void
  onCancel?: () => void
}) {
  const [f, setF] = useState({
    attendees: existing?.attendees?.toString() ?? '',
    amount_spent: existing?.amount_spent?.toString() ?? '',
    offers_redeemed: existing?.offers_redeemed?.toString() ?? '',
    notes: existing?.notes ?? '',
  })
  const [rows, setRows] = useState<NewReceipt[]>(existing ? [] : [{ key: 1, file: null, amount: '', description: '' }])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const setRow = (key: number, patch: Partial<NewReceipt>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const attendees = Number(f.attendees)
    const spent = Number(f.amount_spent || '0')
    const offers = f.offers_redeemed.trim() === '' ? null : Number(f.offers_redeemed)
    if (f.attendees.trim() === '' || !Number.isInteger(attendees) || attendees < 0) return setError('Enter the number of attendees (a whole number).')
    if (!Number.isFinite(spent) || spent < 0) return setError('Amount spent must be $0 or more.')
    if (offers !== null && (!Number.isInteger(offers) || offers < 0)) return setError('Offers redeemed must be a whole number.')
    const filled = rows.filter((r) => r.file)
    for (const r of filled) {
      const problem = validateReceipt(r.file!)
      if (problem) return setError(problem)
      if (r.amount.trim() === '' || !(Number(r.amount) >= 0)) return setError(`Enter the amount for ${r.file!.name}.`)
    }
    setBusy(true)
    setError(null)
    try {
      const row = { attendees, amount_spent: spent, offers_redeemed: offers, notes: f.notes.trim() || null }
      let reportId = existing?.id
      if (existing) {
        const { error } = await supabase.from('event_reports').update(row).eq('id', existing.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('event_reports').insert({ ...row, event_id: event.id }).select('id').single()
        if (error) throw error
        reportId = data.id
      }
      for (const r of filled) {
        await addReceipt({ userId, clubId, eventId: event.id, reportId: reportId!, file: r.file!, amount: Number(r.amount), description: r.description })
      }
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card className="space-y-4">
        <h2 className="font-medium">{existing ? 'Edit your report' : 'How did it go?'}</h2>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Number of attendees" required>
            {(id) => <input id={id} type="number" min={0} step={1} inputMode="numeric" className={inputClass} value={f.attendees} onChange={set('attendees')} />}
          </Field>
          <Field label="Amount spent (USD)" required hint="Deducted from your club budget.">
            {(id) => <input id={id} type="number" min={0} step="0.01" inputMode="decimal" className={inputClass} value={f.amount_spent} onChange={set('amount_spent')} />}
          </Field>
          <Field label="Offers redeemed" hint={event.partners ? 'e.g. sign-ups for the sponsor’s discount. Optional.' : 'Optional.'}>
            {(id) => <input id={id} type="number" min={0} step={1} inputMode="numeric" className={inputClass} value={f.offers_redeemed} onChange={set('offers_redeemed')} />}
          </Field>
        </div>
        <Field label="Notes" hint="What worked, what to change next year, approximate costs — future officers will see this.">
          {(id) => <textarea id={id} rows={4} maxLength={5000} className={inputClass} value={f.notes} onChange={set('notes')} />}
        </Field>

        {!existing && (
          <fieldset className="space-y-3 rounded-md border border-slate-200 p-4">
            <legend className="px-1 text-sm font-medium">Receipts for reimbursement <span className="font-normal text-slate-500">(optional)</span></legend>
            <p className="text-xs text-slate-500">Photos or PDFs, 10 MB max each. They go to your university administrator, and you'll see each one's status on your dashboard.</p>
            {rows.map((r, i) => (
              <div key={r.key} className="grid gap-2 sm:grid-cols-[1fr_8rem_1fr_auto] sm:items-end">
                <Field label={`Receipt ${i + 1}`}>
                  {(id) => <input id={id} type="file" accept={RECEIPT_ACCEPT} className={inputClass} onChange={(e) => setRow(r.key, { file: e.target.files?.[0] ?? null })} />}
                </Field>
                <Field label="Amount">
                  {(id) => <input id={id} type="number" min={0} step="0.01" inputMode="decimal" className={inputClass} value={r.amount} onChange={(e) => setRow(r.key, { amount: e.target.value })} />}
                </Field>
                <Field label="What for">
                  {(id) => <input id={id} className={inputClass} maxLength={500} placeholder="e.g. Pizza" value={r.description} onChange={(e) => setRow(r.key, { description: e.target.value })} />}
                </Field>
                <Button variant="ghost" className="px-2" aria-label={`Remove receipt ${i + 1}`} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>✕</Button>
              </div>
            ))}
            <Button variant="secondary" className="px-3 py-1 text-sm" onClick={() => setRows([...rows, { key: Date.now(), file: null, amount: '', description: '' }])}>
              Add another receipt
            </Button>
          </fieldset>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : existing ? 'Save changes' : 'Submit report'}</Button>
          {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
        </div>
      </Card>
    </form>
  )
}

function ReceiptsSection({
  receipts, add, remove,
}: {
  receipts: Receipt[]
  add: (file: File, amount: number, description: string) => Promise<void>
  remove: (r: Receipt) => Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(0)

  async function submit() {
    if (!file) return setError('Choose a file.')
    const problem = validateReceipt(file)
    if (problem) return setError(problem)
    if (amount.trim() === '' || !(Number(amount) >= 0)) return setError('Enter the receipt amount.')
    setBusy(true)
    setError(null)
    try {
      await add(file, Number(amount), description)
      setFile(null); setAmount(''); setDescription(''); setKey((k) => k + 1)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <Card>
      <h2 className="font-medium">Receipts</h2>
      {receipts.length === 0 ? <p className="mt-2 text-sm text-slate-500">No receipts submitted.</p> : (
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {receipts.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
              <button type="button" className="text-accent-700 hover:underline" onClick={async () => {
                const tab = window.open('', '_blank')
                const url = await receiptUrl(r.storage_path)
                if (tab && url) { tab.opener = null; tab.location.href = url } else tab?.close()
              }}>{r.file_name}</button>
              <span>{usd.format(Number(r.amount))}</span>
              {r.description && <span className="text-slate-500">· {r.description}</span>}
              <ReceiptStatusBadge status={r.status} />
              {r.admin_note && <span className="text-xs text-slate-600">“{r.admin_note}”</span>}
              {r.status === 'pending' && (
                <button type="button" className="ml-auto text-xs text-slate-500 hover:text-red-700" onClick={() => void remove(r)}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-[1fr_8rem_1fr_auto] sm:items-end">
        <Field label="Add a receipt">
          {(id) => <input key={key} id={id} type="file" accept={RECEIPT_ACCEPT} className={inputClass} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
        </Field>
        <Field label="Amount">
          {(id) => <input id={id} type="number" min={0} step="0.01" inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label="What for">
          {(id) => <input id={id} className={inputClass} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</Button>
      </div>
      {error && <Alert className="mt-2">{error}</Alert>}
    </Card>
  )
}

/** Partner follow-up checklist shown once a report exists. */
function FollowUp({ event, report, sponsorName }: { event: EventRow; report: Report; sponsorName: string | null }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!sponsorName) return null

  const thanks =
    `Hi ${sponsorName},\n\nThank you for sponsoring ${event.name}! We had ${report.attendees} attendees` +
    (report.offers_redeemed ? ` and ${report.offers_redeemed} students redeemed your offer` : '') +
    `. ${report.notes ? `\n\n${report.notes}\n\n` : ' '}We'd love to work with you again — are you open to sponsoring another event this year?\n\nThanks again!`

  async function send(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { data, error } = await supabase.rpc('start_conversation', {
      p_partner_id: event.partners!.id, p_subject: `Thank you — ${event.name}`, p_body: body.trim(), p_event_id: event.id,
    })
    setBusy(false)
    if (error) return setError(error.message)
    notify('message', data as string)
    navigate(`/club/messages/${data}`)
  }

  return (
    <Card>
      <h2 className="font-medium">Partner follow-up checklist</h2>
      <ul className="mt-2 space-y-1 text-sm">
        <li>☐ Send {sponsorName} a thank-you note</li>
        <li>☐ Share your attendance numbers{event.partners ? <span className="text-slate-500"> (they were emailed the results automatically)</span> : ''}</li>
        <li>☐ Ask about sponsoring future events</li>
        <li>☐ Tag them in your social media recap</li>
      </ul>
      <p className="mt-2 text-xs text-slate-500">A “Follow up with {sponsorName}” to-do was added to your dashboard.</p>
      {event.partners ? (
        <Button className="mt-3" onClick={() => { setBody(thanks); setOpen(true) }}>Write a thank-you message</Button>
      ) : (
        <Button className="mt-3" variant="secondary" onClick={() => void navigator.clipboard.writeText(thanks)}>Copy a thank-you note</Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={`Thank ${sponsorName}`}>
        <form onSubmit={send} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="Message">
            {(id) => <textarea id={id} rows={9} maxLength={5000} className={inputClass} value={body} onChange={(e) => setBody(e.target.value)} />}
          </Field>
          <Button type="submit" className="w-full" disabled={busy || !body.trim()}>{busy ? 'Sending…' : 'Send'}</Button>
        </form>
      </Modal>
    </Card>
  )
}
