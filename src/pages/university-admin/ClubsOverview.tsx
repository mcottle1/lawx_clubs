import { useEffect, useState } from 'react'
import { Card, Spinner } from '../../components/ui'
import { usd } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { BudgetSummary } from '../../lib/types'

interface Row { id: string; name: string; email: string; remaining: number | null; eventsThisYear: number; members: number | null }

/** Read-only list of the university's clubs. RLS limits every query to this admin's university. */
export default function ClubsOverview() {
  const [rows, setRows] = useState<Row[] | null>(null)
  useEffect(() => {
    void (async () => {
      const [clubs, budgets, events, counts] = await Promise.all([
        supabase.from('clubs').select('id, name, email, budget_year_start').order('name'),
        supabase.from('club_budget_summary').select('*'),
        supabase.from('events').select('club_id, starts_at, approval_status'),
        supabase.from('club_member_counts').select('club_id, count, recorded_on').order('recorded_on', { ascending: false }),
      ])
      const budgetBy = new Map(((budgets.data as BudgetSummary[]) ?? []).map((b) => [b.club_id, b]))
      const latest = new Map<string, number>()
      for (const c of counts.data ?? []) if (!latest.has(c.club_id)) latest.set(c.club_id, c.count)
      setRows((clubs.data ?? []).map((c) => ({
        id: c.id, name: c.name, email: c.email,
        remaining: budgetBy.has(c.id) ? Number(budgetBy.get(c.id)!.remaining) : null,
        // "This year" = the club's current budget year; denied events don't count.
        eventsThisYear: (events.data ?? []).filter((e) => e.club_id === c.id && e.approval_status !== 'denied' && e.starts_at >= c.budget_year_start).length,
        members: latest.get(c.id) ?? null,
      })))
    })()
  }, [])
  if (!rows) return <Spinner />
  return (
    <Card>
      <h2 className="font-medium">Clubs ({rows.length})</h2>
      {rows.length === 0 ? <p className="mt-2 text-sm text-slate-500">No clubs have signed up yet.</p> : (
        <div className="-mx-5 mt-3 overflow-x-auto px-5">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr><th scope="col" className="py-2 pr-4">Club</th><th scope="col" className="py-2 pr-4 text-right">Budget remaining</th><th scope="col" className="py-2 pr-4 text-right">Events this year</th><th scope="col" className="py-2 text-right">Members</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-4"><span className="font-medium">{r.name}</span><span className="block text-xs text-slate-500">{r.email}</span></td>
                  <td className={`py-2 pr-4 text-right ${r.remaining !== null && r.remaining < 0 ? 'text-red-700' : ''}`}>{r.remaining === null ? '—' : usd.format(r.remaining)}</td>
                  <td className="py-2 pr-4 text-right">{r.eventsThisYear}</td>
                  <td className="py-2 text-right">{r.members ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
