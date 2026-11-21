import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import Modal from '../../components/Modal'
import ProposalStatusBadge from '../../components/ProposalStatusBadge'
import ProposalTerms from '../../components/ProposalTerms'
import ReceiptStatusBadge from '../../components/ReceiptStatusBadge'
import StatusBadge from '../../components/StatusBadge'
import { Alert, Button, Card, Field, inputClass, PageHeader, Spinner } from '../../components/ui'
import { categoryLabel } from '../../lib/constants'
import { publicUrl } from '../../lib/files'
import { formatEventRange, usd } from '../../lib/format'
import { notify } from '../../lib/notify'
import { receiptUrl } from '../../lib/receipts'
import { supabase } from '../../lib/supabase'
import type { ClubEvent, EventReport, ProposalDetail, Receipt } from '../../lib/types'
import { useReviewerNames } from './useReviewerNames'

type EventRow = ClubEvent & {
  clubs: { name: string; email: string; department_id: string; departments: { name: string } | null } | null
  partners: { name: string; category: string; city: string; state: string } | null
}
type Reopen = { kind: 'event'; id: string; label: string } | { kind: 'proposal'; id: string; label: string }

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—')

/**
 * Everything about one event for administrators, past or upcoming: details,
 * flyer, the approval record, partnerships, the report and receipts. Until the
 * event starts, an approved event or partnership can be sent back for changes.
 * `oversight` (organization admin): actions only for colleges without an admin.
 */
export default function AdminEventDetail({ base, oversight }: { base: string; oversight?: { actsFor: Set<string> } }) {
  const { id } = useParams()
  const [event, setEvent] = useState<EventRow | null | undefined>(undefined)
  const [proposals, setProposals] = useState<ProposalDetail[]>([])
  const [report, setReport] = useState<EventReport | null>(null)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [links, setLinks] = useState<Record<string, string>>({})
  const [reopen, setReopen] = useState<Reopen | null>(null)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const names = useReviewerNames()

  const load = useCallback(async () => {
    const [e, p, r, rc] = await Promise.all([
      supabase.from('events').select('*, clubs(name, email, department_id, departments(name)), partners(name, category, city, state)').eq('id', id!).maybeSingle(),
      supabase.from('proposal_details').select('*').eq('event_id', id!).order('created_at'),
      supabase.from('event_reports').select('*').eq('event_id', id!).maybeSingle(),
      supabase.from('receipts').select('*').eq('event_id', id!).order('created_at'),
    ])
    setEvent(e.data as EventRow | null)
    setProposals((p.data as ProposalDetail[]) ?? [])
    setReport(r.data as EventReport | null)
    const list = (rc.data as Receipt[]) ?? []
    setReceipts(list)
    const urls = await Promise.all(list.map(async (x) => [x.id, await receiptUrl(x.storage_path)] as const))
    setLinks(Object.fromEntries(urls.filter(([, u]) => u) as [string, string][]))
  }, [id])
  useEffect(() => { void load() }, [load])

  async function doReopen(r: Reopen, note: string) {
    const { error } = r.kind === 'event'
      ? await supabase.rpc('reopen_event', { p_event_id: r.id, p_note: note })
      : await supabase.rpc('reopen_proposal', { p_proposal_id: r.id, p_note: note })
    if (error) return setMsg({ kind: 'error', text: error.message })
    notify('reviewed', r.id, { kind: r.kind })
    setReopen(null)
    setMsg({ kind: 'success', text: r.kind === 'event'
      ? 'Sent back to the club with your note. It returns to your approvals when they resubmit.'
      : 'Sent back to the partner with your note. The club accepts the revised terms, then it comes back to you.' })
    await load()
  }

  if (event === undefined) return <Spinner />
  if (event === null) return <Alert>Event not found.</Alert>

  const upcoming = new Date(event.starts_at) > new Date()
  const canAct = !oversight || oversight.actsFor.has(event.clubs?.department_id ?? '')
  const flyer = publicUrl('flyers', event.flyer_path)
  const spent = receipts.reduce((s, r) => s + (r.status === 'denied' ? 0 : Number(r.amount)), 0)

  return (
    <>
      <Link to={`${base}/history`} className="mb-3 inline-block text-sm text-accent-700 hover:underline">← Event history</Link>
      <PageHeader
        title={event.name}
        subtitle={<>{event.clubs?.name}{event.clubs?.departments && oversight ? ` · ${event.clubs.departments.name}` : ''} · {formatEventRange(event.starts_at, event.ends_at, event.time_zone)}</>}
      />
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">Event details</h2>
              <StatusBadge status={event.approval_status} />
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Location</dt><dd>{event.location ?? 'Not booked'}</dd></div>
              <div><dt className="text-slate-500">Budget</dt><dd>{usd.format(Number(event.budget))}</dd></div>
              <div>
                <dt className="text-slate-500">Sponsor</dt>
                <dd>{event.partners ? `${event.partners.name} (${categoryLabel(event.partners.category)}, ${event.partners.city}, ${event.partners.state})` : event.outside_sponsor_name ? `${event.outside_sponsor_name} (outside sponsor)` : 'None'}</dd>
              </div>
              <div><dt className="text-slate-500">Club contact</dt><dd className="truncate">{event.clubs?.email}</dd></div>
              {event.description && <div className="sm:col-span-2"><dt className="text-slate-500">Description</dt><dd className="whitespace-pre-line">{event.description}</dd></div>}
            </dl>
          </Card>

          <Card>
            <h2 className="font-medium">Approval record</h2>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Submitted</dt><dd>{when(event.created_at)}</dd></div>
              <div><dt className="text-slate-500">Last decision</dt><dd>{event.reviewed_at ? `${when(event.reviewed_at)} by ${names(event.reviewed_by)}` : 'Not decided yet'}</dd></div>
              {event.denial_reason && event.approval_status !== 'approved' && (
                <div className="sm:col-span-2"><dt className="text-slate-500">{event.approval_status === 'denied' ? 'Reason' : 'Note to the club'}</dt><dd>{event.denial_reason}</dd></div>
              )}
            </dl>
            {event.approval_status === 'pending' && canAct && (
              <p className="mt-3 text-sm"><Link to={base} className="font-medium text-accent-700 hover:underline">Decide it in Approvals →</Link></p>
            )}
            {event.approval_status === 'approved' && upcoming && canAct && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="text-xs text-slate-600">Approved by mistake, or something changed? Until the event starts you can send it back to the club with a note; they edit and resubmit it.</p>
                <Button variant="secondary" className="mt-2" onClick={() => setReopen({ kind: 'event', id: event.id, label: event.name })}>Send back for changes</Button>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="font-medium">Partnerships ({proposals.length})</h2>
            {proposals.length === 0 ? <p className="mt-2 text-sm text-slate-500">No partner proposals for this event.</p> : (
              <ul className="mt-2 divide-y divide-slate-100">
                {proposals.map((p) => (
                  <li key={p.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{p.partner_name} <span className="text-xs font-normal text-slate-500">({categoryLabel(p.partner_category)})</span></p>
                      <ProposalStatusBadge status={p.status} />
                    </div>
                    <div className="mt-2"><ProposalTerms p={p} /></div>
                    <p className="mt-2 text-xs text-slate-500">
                      Proposed {when(p.created_at)}{p.reviewed_at && ` · last decision ${when(p.reviewed_at)} by ${names(p.reviewed_by)}`}
                    </p>
                    {p.denial_reason && p.status !== 'approved' && <p className="mt-1 text-xs text-slate-600">Note: {p.denial_reason}</p>}
                    {p.status === 'approved' && upcoming && canAct && (
                      <Button variant="secondary" className="mt-2 px-3 py-1 text-sm" onClick={() => setReopen({ kind: 'proposal', id: p.id, label: `partnership with ${p.partner_name}` })}>
                        Send partnership back for changes
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="font-medium">Flyer</h2>
            {flyer ? (event.flyer_path!.toLowerCase().endsWith('.pdf')
              ? <a href={flyer} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-accent-700 hover:underline">Open flyer (PDF)</a>
              : <a href={flyer} target="_blank" rel="noreferrer"><img src={flyer} alt={`Flyer for ${event.name}`} className="mt-2 w-full rounded border border-slate-200" /></a>)
              : <p className="mt-2 text-sm text-slate-500">No flyer.</p>}
          </Card>

          <Card>
            <h2 className="font-medium">Report</h2>
            {report ? (
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Attendance</dt><dd>{report.attendees}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Spent</dt><dd>{usd.format(Number(report.amount_spent))}</dd></div>
                {report.offers_redeemed !== null && <div className="flex justify-between"><dt className="text-slate-500">Offers redeemed</dt><dd>{report.offers_redeemed}</dd></div>}
                {report.notes && <div><dt className="text-slate-500">Notes</dt><dd className="whitespace-pre-line">{report.notes}</dd></div>}
                <div className="text-xs text-slate-500">Submitted {when(report.submitted_at)}</div>
              </dl>
            ) : <p className="mt-2 text-sm text-slate-500">{upcoming ? 'Due after the event.' : 'Not submitted yet.'}</p>}
          </Card>

          <Card>
            <h2 className="font-medium">Receipts ({receipts.length})</h2>
            {receipts.length === 0 ? <p className="mt-2 text-sm text-slate-500">None.</p> : (
              <>
                <ul className="mt-2 divide-y divide-slate-100 text-sm">
                  {receipts.map((r) => (
                    <li key={r.id} className="py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{usd.format(Number(r.amount))}</span>
                        <ReceiptStatusBadge status={r.status} />
                      </div>
                      <p className="truncate text-xs text-slate-600">
                        {links[r.id] ? <a href={links[r.id]} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">{r.file_name}</a> : r.file_name}
                        {r.description && ` · ${r.description}`}
                      </p>
                      {r.admin_note && <p className="text-xs text-slate-500">Note: {r.admin_note}</p>}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-slate-500">Total (not denied): {usd.format(spent)}</p>
              </>
            )}
          </Card>
        </div>
      </div>

      <Modal open={!!reopen} onClose={() => setReopen(null)} title={`Send back ${reopen?.label ?? ''}`}>
        {reopen && <ReopenForm kind={reopen.kind} onSubmit={(note) => void doReopen(reopen, note)} />}
      </Modal>
    </>
  )
}

export function ReopenForm({ kind, onSubmit }: { kind: 'event' | 'proposal'; onSubmit: (note: string) => void }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!note.trim()) return setError('Say what needs to change; they see this note.')
    setBusy(true)
    onSubmit(note.trim())
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-slate-600">
        {kind === 'event'
          ? 'The approval is withdrawn and the event goes back to the club as “changes requested”. They edit and resubmit it, and it comes back to your approvals.'
          : 'The approval is withdrawn: the partner comes off the event and revises their terms, the club accepts again, and it comes back to your approvals.'}
      </p>
      {error && <Alert>{error}</Alert>}
      <Field label="What needs to change" required>
        {(id) => <textarea id={id} rows={4} maxLength={2000} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Send back for changes'}</Button>
    </form>
  )
}
