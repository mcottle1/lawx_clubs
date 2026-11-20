import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import StatTile from '../../components/charts/StatTile'
import { Button, Card, inputClass, PageHeader, Spinner } from '../../components/ui'
import { downloadCsv } from '../../lib/csv'
import { usd } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { PartnerEvent, PartnerEventResult, ProposalDetail } from '../../lib/types'
import { usePartner } from './PartnerContext'

interface HistoryRow {
  key: string
  date: string
  upcoming: boolean
  club: string
  university: string
  title: string
  amount: number
  headcount: number
  inKind: string | null
  studentOffer: string | null
  attendees: number | null
  redeemed: number | null
}

/** Everything a partner has sponsored, approved by the university, with results over time. */
export default function PartnerHistory() {
  const { partner } = usePartner()
  const [rows, setRows] = useState<HistoryRow[] | null>(null)
  const [year, setYear] = useState('all')

  useEffect(() => {
    void (async () => {
      const [p, e, r] = await Promise.all([
        supabase.from('proposal_details').select('*').eq('partner_id', partner.id).eq('status', 'approved'),
        supabase.from('partner_events').select('*').eq('partner_id', partner.id).eq('approval_status', 'approved'),
        supabase.from('partner_event_results').select('*'),
      ])
      const results = new Map(((r.data as PartnerEventResult[]) ?? []).map((x) => [x.event_id, x]))
      const now = Date.now()
      const out: HistoryRow[] = []
      const seenEvents = new Set<string>()
      for (const x of (p.data as ProposalDetail[]) ?? []) {
        if (x.event_id) seenEvents.add(x.event_id)
        const res = x.event_id ? results.get(x.event_id) : undefined
        const date = x.event_starts_at ?? x.updated_at
        out.push({
          key: x.id, date, upcoming: new Date(date).getTime() > now,
          club: x.club_name, university: x.university_name,
          title: x.event_name ?? x.opportunity_title ?? 'General sponsorship',
          amount: Number(x.amount ?? 0), headcount: x.headcount ?? 0, inKind: x.in_kind, studentOffer: x.student_offer,
          attendees: res?.attendees ?? null, redeemed: res?.offers_redeemed ?? null,
        })
      }
      // Events that list this partner as sponsor without a proposal on CampusBridge.
      for (const ev of (e.data as PartnerEvent[]) ?? []) {
        if (seenEvents.has(ev.id)) continue
        const res = results.get(ev.id)
        out.push({
          key: ev.id, date: ev.starts_at, upcoming: new Date(ev.starts_at).getTime() > now,
          club: ev.club_name, university: ev.university_name, title: ev.name,
          amount: 0, headcount: 0, inKind: null, studentOffer: null,
          attendees: res?.attendees ?? null, redeemed: res?.offers_redeemed ?? null,
        })
      }
      out.sort((a, b) => b.date.localeCompare(a.date))
      setRows(out)
    })()
  }, [partner.id])

  const years = useMemo(() => [...new Set((rows ?? []).map((x) => x.date.slice(0, 4)))], [rows])
  const shown = useMemo(() => (rows ?? []).filter((x) => year === 'all' || x.date.startsWith(year)), [rows, year])

  if (!rows) return <Spinner />

  const totals = {
    count: shown.length,
    clubs: new Set(shown.map((x) => x.club)).size,
    amount: shown.reduce((s, x) => s + x.amount, 0),
    headcount: shown.reduce((s, x) => s + x.headcount, 0),
    reached: shown.reduce((s, x) => s + (x.attendees ?? 0), 0),
    redeemed: shown.reduce((s, x) => s + (x.redeemed ?? 0), 0),
  }

  function download() {
    const header = ['Date', 'Club', 'University', 'Event or opportunity', 'Funding (USD)', 'Lunches / people covered', 'In-kind', 'Student offer', 'Attendees', 'Offers extended']
    const lines = shown.map((x) => [
      x.date.slice(0, 10), x.club, x.university, x.title, x.amount || null, x.headcount || null, x.inKind, x.studentOffer, x.attendees, x.redeemed,
    ])
    downloadCsv(`campusbridge-sponsorships${year === 'all' ? '' : `-${year}`}.csv`, [header, ...lines])
  }

  let lastYear = ''
  return (
    <>
      <PageHeader
        title="Sponsorship history"
        subtitle="Every sponsorship the university approved, with what you contributed and how the event went."
        actions={rows.length > 0 && (
          <>
            <label className="sr-only" htmlFor="hist-year">Year</label>
            <select id="hist-year" className={inputClass.replace('w-full', 'w-auto')} value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="all">All years</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <Button variant="secondary" onClick={download}>Download CSV</Button>
          </>
        )}
      />
      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            No approved sponsorships yet. When a club accepts your proposal and their university approves it, it shows up here.{' '}
            <Link to="/partner" className="text-accent-700 hover:underline">Browse open opportunities</Link>.
          </p>
        </Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Sponsorships" value={totals.count} />
            <StatTile label="Clubs supported" value={totals.clubs} />
            <StatTile label="Funding" value={totals.amount ? usd.format(totals.amount).replace(/\.00$/, '') : '—'} tone="pop" />
            <StatTile label="Lunches / people covered" value={totals.headcount || '—'} />
            <StatTile label="Students reached" value={totals.reached} tone="fresh" />
            <StatTile label="Offers extended" value={totals.redeemed} tone="fresh" />
          </div>
          <Card className="p-0">
            <ul className="divide-y divide-slate-100">
              {shown.map((x) => {
                const y = x.date.slice(0, 4)
                const heading = y !== lastYear
                lastYear = y
                const terms = [
                  x.amount > 0 && usd.format(x.amount),
                  x.headcount > 0 && `${x.headcount} lunches`,
                  x.inKind && `In-kind: ${x.inKind}`,
                  x.studentOffer && `Student offer: ${x.studentOffer}`,
                ].filter(Boolean) as string[]
                return (
                  <li key={x.key}>
                    {heading && <h2 className="bg-slate-50 px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{y}</h2>}
                    <div className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium">{x.title}</p>
                        <p className="text-xs text-slate-500">
                          {x.club} · {x.university} · {new Date(x.date).toLocaleDateString([], { dateStyle: 'medium' })}
                        </p>
                        <p className="mt-1 text-sm text-slate-700">{terms.length ? terms.join(' · ') : 'Listed as the event’s sponsor'}</p>
                      </div>
                      <p className="shrink-0 text-sm sm:text-right">
                        {x.attendees !== null ? (
                          <>
                            <span className="font-semibold">{x.attendees}</span> attended
                            {x.redeemed !== null && <span className="block text-xs text-slate-500">{x.redeemed} offers extended</span>}
                          </>
                        ) : (
                          <span className="text-xs text-slate-500">{x.upcoming ? 'Upcoming' : 'Report not in yet'}</span>
                        )}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>
        </>
      )}
    </>
  )
}
