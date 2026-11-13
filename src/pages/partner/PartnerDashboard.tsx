import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import listPlugin from '@fullcalendar/list'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import OpportunityCardView from '../../components/OpportunityCardView'
import ProposalStatusBadge from '../../components/ProposalStatusBadge'
import { Alert, Button, Card, Field, inputClass, PageHeader } from '../../components/ui'
import { SUPPORT_TYPES } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import type { ConversationListItem, OpportunityCard, PartnerEvent, PartnerEventResult, ProposalDetail } from '../../lib/types'
import { usePartner } from './PartnerContext'

const PAGE_SIZE = 6

export default function PartnerDashboard() {
  const { partner } = usePartner()
  const [proposals, setProposals] = useState<ProposalDetail[]>([])
  const [convs, setConvs] = useState<ConversationListItem[]>([])
  const [events, setEvents] = useState<PartnerEvent[]>([])
  const [recentByUni, setRecentByUni] = useState<OpportunityCard[]>([])
  const [results, setResults] = useState<PartnerEventResult[]>([])

  useEffect(() => {
    supabase.from('proposal_details').select('*').order('updated_at', { ascending: false })
      .then(({ data }) => setProposals((data as ProposalDetail[]) ?? []))
    supabase.from('conversation_list').select('*').order('last_message_at', { ascending: false }).limit(20)
      .then(({ data }) => setConvs((data as ConversationListItem[]) ?? []))
    supabase.from('partner_events').select('*').neq('approval_status', 'denied').order('starts_at')
      .then(({ data }) => setEvents((data as PartnerEvent[]) ?? []))
    supabase.from('partner_event_results').select('*').order('starts_at', { ascending: false })
      .then(({ data }) => setResults((data as PartnerEventResult[]) ?? []))
    const since = new Date(Date.now() - 14 * 864e5).toISOString()
    supabase.from('opportunity_cards').select('*').eq('status', 'open').gte('created_at', since).limit(200)
      .then(({ data }) => setRecentByUni((data as OpportunityCard[]) ?? []))
  }, [])

  // Next-step suggestions
  const suggestions = useMemo(() => {
    const out: { text: string; to: string }[] = []
    const sponsoredUnis = new Set(proposals.filter((p) => p.status === 'approved').map((p) => p.university_id))
    const fresh = recentByUni.filter((o) => sponsoredUnis.has(o.university_id) && !proposals.some((p) => p.opportunity_id === o.id))
    if (fresh.length) out.push({ text: `${fresh.length} new opportunit${fresh.length === 1 ? 'y' : 'ies'} at schools you've sponsored before`, to: '#opportunities' })
    for (const r of results.filter((r) => Date.now() - new Date(r.submitted_at).getTime() < 14 * 864e5).slice(0, 3)) {
      out.push({ text: `${r.event_name} report is in — ${r.attendees} attended`, to: '#results' })
    }
    const unread = convs.filter((c) => c.unread).length
    if (unread) out.push({ text: `${unread} conversation${unread === 1 ? '' : 's'} with new messages`, to: '/partner/messages' })
    const waitingClub = proposals.filter((p) => p.status === 'pending_club').length
    if (waitingClub) out.push({ text: `${waitingClub} proposal${waitingClub === 1 ? '' : 's'} waiting on clubs`, to: '/partner/proposals' })
    const waitingUni = proposals.filter((p) => p.status === 'pending_admin').length
    if (waitingUni) out.push({ text: `${waitingUni} accepted proposal${waitingUni === 1 ? '' : 's'} waiting on university approval`, to: '/partner/proposals' })
    if (!partner.logo_path) out.push({ text: 'Add a logo so clubs recognize you', to: '/partner/profile' })
    if (!partner.open_to_sponsorships) out.push({ text: "You're hidden from clubs' partner directory — turn on “open to sponsorships”", to: '/partner/profile' })
    return out
  }, [proposals, convs, recentByUni, results, partner])

  // Recent activity: messages + proposal status changes
  const activity = useMemo(() => {
    const items = [
      ...convs.map((c) => ({ at: c.last_message_at, to: `/partner/messages/${c.id}`, node: <>{c.unread && <strong>New · </strong>}Message with <strong>{c.club_name}</strong>: {c.last_message}</> })),
      ...proposals.map((p) => ({ at: p.updated_at, to: '/partner/proposals', node: <>Proposal to <strong>{p.club_name}</strong> for {p.opportunity_title ?? p.event_name ?? 'a sponsorship'} <ProposalStatusBadge status={p.status} /></> })),
    ]
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8)
  }, [convs, proposals])

  return (
    <>
      <PageHeader title={`Welcome, ${partner.name}`} subtitle="Find clubs to sponsor and follow your partnerships." />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {suggestions.length > 0 && (
            <Card>
              <h2 className="font-medium">Next steps</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {suggestions.map((s) => (
                  <li key={s.text}>
                    →{' '}
                    {s.to.startsWith('#') ? (
                      <button type="button" className="text-accent-700 hover:underline" onClick={() => document.getElementById(s.to.slice(1))?.scrollIntoView({ behavior: 'smooth' })}>{s.text}</button>
                    ) : (
                      <Link to={s.to} className="text-accent-700 hover:underline">{s.text}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <OpportunityFeed />
        </div>
        <div className="space-y-4">
          <Card>
            <h2 className="font-medium">Recent activity</h2>
            {activity.length === 0 ? <p className="mt-2 text-sm text-slate-500">Nothing yet. Respond to an opportunity to get started.</p> : (
              <ul className="mt-2 divide-y divide-slate-100 text-sm">
                {activity.map((a, i) => (
                  <li key={i} className="py-2">
                    <Link to={a.to} className="block hover:underline"><span className="line-clamp-2">{a.node}</span></Link>
                    <span className="text-xs text-slate-500">{new Date(a.at).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="mb-3 font-medium">Events you're sponsoring</h2>
            {events.length === 0 ? <p className="text-sm text-slate-500">None yet.</p> : (
              <FullCalendar
                plugins={[dayGridPlugin, listPlugin]}
                initialView="listYear"
                headerToolbar={{ left: 'prev,next', center: '', right: 'title' }}
                height="auto"
                noEventsContent="No sponsored events in this period."
                events={events.map((e) => ({
                  id: e.id, start: e.starts_at, end: e.ends_at,
                  title: `${e.name} — ${e.club_name}${e.approval_status === 'pending' ? ' (pending approval)' : ''}`,
                  color: e.approval_status === 'approved' ? '#234bb0' : '#b45309',
                }))}
              />
            )}
          </Card>
          <section id="results" aria-labelledby="results-h">
            <Card>
              <h2 id="results-h" className="font-medium">Results from events you sponsored</h2>
              {results.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">Attendance and offers redeemed appear here once clubs submit their post-event reports.</p>
              ) : (
                <>
                  <p className="mt-1 text-xs text-slate-500">
                    {results.reduce((s, r) => s + r.attendees, 0)} students reached · {results.reduce((s, r) => s + (r.offers_redeemed ?? 0), 0)} offers redeemed
                  </p>
                  <ul className="mt-2 divide-y divide-slate-100 text-sm">
                    {results.map((r) => (
                      <li key={r.event_id} className="py-2">
                        <p className="font-medium">{r.event_name}</p>
                        <p className="text-xs text-slate-500">{r.club_name} · {new Date(r.starts_at).toLocaleDateString()}</p>
                        <p className="mt-1">{r.attendees} attended{r.offers_redeemed !== null && ` · ${r.offers_redeemed} offers redeemed`}</p>
                        {r.notes && <p className="mt-1 text-xs text-slate-600">“{r.notes}”</p>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </section>
        </div>
      </div>
    </>
  )
}

function OpportunityFeed() {
  const [universities, setUniversities] = useState<{ id: string; name: string }[]>([])
  const [filters, setFilters] = useState({ university: '', type: '', from: '', to: '' })
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<OpportunityCard[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof filters) => (e: { target: { value: string } }) => { setFilters({ ...filters, [k]: e.target.value }); setPage(0) }

  useEffect(() => {
    supabase.from('opportunity_cards').select('university_id, university_name').eq('status', 'open').limit(1000).then(({ data }) => {
      const map = new Map((data ?? []).map((r) => [r.university_id as string, r.university_name as string]))
      setUniversities([...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)))
    })
  }, [])

  useEffect(() => {
    let q = supabase.from('opportunity_cards').select('*', { count: 'exact' }).eq('status', 'open')
    if (filters.university) q = q.eq('university_id', filters.university)
    if (filters.type) q = q.eq('support_type', filters.type)
    if (filters.from) q = q.gte('event_starts_at', new Date(`${filters.from}T00:00`).toISOString())
    if (filters.to) q = q.lte('event_starts_at', new Date(`${filters.to}T23:59`).toISOString())
    q.order('event_starts_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      .then(({ data, count, error }) => {
        if (error) setError(error.message)
        setRows((data as OpportunityCard[]) ?? [])
        setTotal(count ?? 0)
      })
  }, [filters, page])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  return (
    <section id="opportunities" aria-labelledby="opps-h">
      <Card>
        <h2 id="opps-h" className="font-medium">Open sponsorship opportunities</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Field label="University">
            {(id) => (
              <select id={id} className={inputClass} value={filters.university} onChange={set('university')}>
                <option value="">All</option>
                {universities.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="Support needed">
            {(id) => (
              <select id={id} className={inputClass} value={filters.type} onChange={set('type')}>
                <option value="">All</option>
                {SUPPORT_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            )}
          </Field>
          <Field label="Event from">
            {(id) => <input id={id} type="date" className={inputClass} value={filters.from} onChange={set('from')} />}
          </Field>
          <Field label="Event to">
            {(id) => <input id={id} type="date" className={inputClass} value={filters.to} onChange={set('to')} />}
          </Field>
        </div>
      </Card>
      {error && <Alert className="mt-3">{error}</Alert>}
      <p className="my-3 text-sm text-slate-600" role="status">{rows === null ? 'Loading…' : `${total} open opportunit${total === 1 ? 'y' : 'ies'}`}</p>
      <ul className="space-y-3">
        {rows?.map((o) => <li key={o.id}><OpportunityCardView o={o} to={`/partner/opportunities/${o.id}`} /></li>)}
      </ul>
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-sm">
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page + 1} of {pages}</span>
          <Button variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </nav>
      )}
    </section>
  )
}
