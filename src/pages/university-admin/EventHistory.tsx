import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Modal from '../../components/Modal'
import ProposalStatusBadge from '../../components/ProposalStatusBadge'
import StatusBadge from '../../components/StatusBadge'
import { Alert, Button, Card, inputClass, Spinner } from '../../components/ui'
import { formatEventRange, usd } from '../../lib/format'
import { notify } from '../../lib/notify'
import { supabase } from '../../lib/supabase'
import type { ApprovalStatus, ClubEvent, ProposalDetail } from '../../lib/types'
import { ReopenForm } from './AdminEventDetail'

type Row = ClubEvent & {
  clubs: { name: string; department_id: string; departments: { name: string } | null } | null
  event_reports: { attendees: number; amount_spent: number }[] | { attendees: number; amount_spent: number } | null
}
const WHEN = [['past', 'Past'], ['upcoming', 'Upcoming'], ['all', 'All']] as const

/**
 * A record of every event (and decided partnership) for administrators.
 * Events open the full detail page. `oversight`: organization admin.
 */
export default function EventHistory({ base, oversight }: { base: string; oversight?: { actsFor: Set<string> } }) {
  const [tab, setTab] = useState<'events' | 'partnerships'>('events')
  return (
    <>
      <div role="tablist" aria-label="History" className="mb-4 flex gap-2">
        {(['events', 'partnerships'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1.5 text-sm ${tab === t ? 'bg-accent-600 font-semibold text-white shadow-sm' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-accent-50'}`}>
            {t === 'events' ? 'Events' : 'Partnerships'}
          </button>
        ))}
      </div>
      {tab === 'events' ? <Events base={base} oversight={oversight} /> : <Partnerships base={base} oversight={oversight} />}
    </>
  )
}

function Events({ base, oversight }: { base: string; oversight?: { actsFor: Set<string> } }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [when, setWhen] = useState<'past' | 'upcoming' | 'all'>('past')
  const [status, setStatus] = useState<'' | ApprovalStatus>('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    supabase.from('events').select('*, clubs(name, department_id, departments(name)), event_reports(attendees, amount_spent)')
      .order('starts_at', { ascending: false }).limit(1000)
      .then(({ data }) => setRows((data as Row[]) ?? []))
  }, [])

  const shown = useMemo(() => {
    const now = Date.now()
    const q = query.trim().toLowerCase()
    const list = (rows ?? []).filter((e) => {
      const past = new Date(e.starts_at).getTime() <= now
      if (when === 'past' && !past) return false
      if (when === 'upcoming' && past) return false
      if (status && e.approval_status !== status) return false
      return !q || [e.name, e.clubs?.name ?? '', e.location ?? '', e.clubs?.departments?.name ?? ''].some((v) => v.toLowerCase().includes(q))
    })
    return when === 'upcoming' ? [...list].reverse() : list
  }, [rows, when, status, query])

  if (!rows) return <Spinner />
  return (
    <Card>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {WHEN.map(([k, l]) => (
            <Button key={k} variant={when === k ? 'primary' : 'secondary'} className="px-3 py-1 text-sm" onClick={() => setWhen(k)} aria-pressed={when === k}>{l}</Button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select aria-label="Status" className={inputClass.replace('w-full', 'w-auto')} value={status} onChange={(e) => setStatus(e.target.value as '' | ApprovalStatus)}>
            <option value="">Any status</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="changes_requested">Changes requested</option>
            <option value="denied">Denied</option>
          </select>
          <input type="search" aria-label="Search events" placeholder="Search event, club or location" className={`${inputClass} sm:w-64`} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      {shown.length === 0 ? <p className="mt-4 text-sm text-slate-500">No events match.</p> : (
        <ul className="mt-3 divide-y divide-slate-100">
          {shown.map((e) => {
            const report = Array.isArray(e.event_reports) ? e.event_reports[0] : e.event_reports
            return (
              <li key={e.id}>
                <Link to={`${base}/events/${e.id}`} className="-mx-2 flex flex-col gap-1 rounded-md px-2 py-2.5 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{e.name}</p>
                    <p className="text-xs text-slate-500">
                      {e.clubs?.name}{oversight && e.clubs?.departments ? ` · ${e.clubs.departments.name}` : ''} · {formatEventRange(e.starts_at, e.ends_at, e.time_zone)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-slate-600">
                    {report && <span>{report.attendees} attended · {usd.format(Number(report.amount_spent))} spent</span>}
                    <StatusBadge status={e.approval_status} />
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function Partnerships({ base, oversight }: { base: string; oversight?: { actsFor: Set<string> } }) {
  const [rows, setRows] = useState<ProposalDetail[] | null>(null)
  const [reopen, setReopen] = useState<ProposalDetail | null>(null)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    supabase.from('proposal_details').select('*').in('status', ['approved', 'denied', 'changes_requested'])
      .order('reviewed_at', { ascending: false, nullsFirst: false }).limit(500)
      .then(({ data }) => setRows((data as ProposalDetail[]) ?? []))
  }, [version])

  async function doReopen(p: ProposalDetail, note: string) {
    const { error } = await supabase.rpc('reopen_proposal', { p_proposal_id: p.id, p_note: note })
    setReopen(null)
    if (error) return setMsg({ kind: 'error', text: error.message })
    notify('reviewed', p.id, { kind: 'proposal' })
    setMsg({ kind: 'success', text: `Partnership with ${p.partner_name} sent back for changes.` })
    setVersion((v) => v + 1)
  }

  if (!rows) return <Spinner />
  const now = Date.now()
  return (
    <Card>
      {msg && <Alert kind={msg.kind} className="mb-3">{msg.text}</Alert>}
      {rows.length === 0 ? <p className="text-sm text-slate-500">No decided partnerships yet.</p> : (
        <ul className="divide-y divide-slate-100">
          {rows.map((p) => {
            const upcoming = !p.event_starts_at || new Date(p.event_starts_at).getTime() > now
            const canAct = !oversight || oversight.actsFor.has(p.department_id)
            const terms = [p.amount ? usd.format(Number(p.amount)) : null, p.headcount ? `${p.headcount} lunches` : null, p.in_kind, p.student_offer].filter(Boolean).join(' · ')
            return (
              <li key={p.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">{p.partner_name} → {p.club_name}{oversight ? <span className="font-normal text-slate-500"> · {p.department_name}</span> : null}</p>
                  <p className="text-xs text-slate-500">
                    {p.event_id ? <Link className="text-accent-700 hover:underline" to={`${base}/events/${p.event_id}`}>{p.event_name}</Link> : p.opportunity_title ?? 'General sponsorship'}
                    {terms && ` · ${terms}`}
                    {p.reviewed_at && ` · decided ${new Date(p.reviewed_at).toLocaleDateString()}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ProposalStatusBadge status={p.status} />
                  {p.status === 'approved' && upcoming && canAct && (
                    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setReopen(p)}>Send back</Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <Modal open={!!reopen} onClose={() => setReopen(null)} title={`Send back partnership with ${reopen?.partner_name ?? ''}`}>
        {reopen && <ReopenForm kind="proposal" onSubmit={(note) => void doReopen(reopen, note)} />}
      </Modal>
    </Card>
  )
}
