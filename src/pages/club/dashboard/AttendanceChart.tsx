import BarMetric from '../../../components/charts/BarMetric'
import StatTile from '../../../components/charts/StatTile'
import { Card } from '../../../components/ui'
import { usd } from '../../../lib/format'
import { brand } from '../../../lib/theme'
import type { ClubEvent, EventReport } from '../../../lib/types'

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** Attendance per reported event (last 12), with headline numbers. */
export default function AttendanceChart({ events, reports }: { events: ClubEvent[]; reports: Map<string, EventReport> }) {
  const rows = events
    .filter((e) => reports.has(e.id))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(-12)
    .map((e) => ({ e, r: reports.get(e.id)! }))

  const total = rows.reduce((s, x) => s + x.r.attendees, 0)
  const spent = rows.reduce((s, x) => s + Number(x.r.amount_spent), 0)
  const avg = rows.length ? Math.round(total / rows.length) : 0

  return (
    <Card>
      <h2 className="font-medium">Event attendance</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">After your first event, submit its report and attendance shows up here.</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <StatTile label="Students reached" value={total} />
            <StatTile label="Avg. per event" value={avg} tone="fresh" />
            <StatTile label="Cost / attendee" value={total ? usd.format(spent / total) : '—'} tone="pop" />
          </div>
          <div className="mt-3">
            <BarMetric
              color={brand.primary()}
              valueLabel="attendees"
              summary={`Attendance for ${rows.length} reported events, from ${rows[0].r.attendees} to ${rows[rows.length - 1].r.attendees}; ${total} in total.`}
              data={rows.map(({ e, r }) => ({
                label: shortDate(e.starts_at),
                value: r.attendees,
                details: [e.name, `${usd.format(Number(r.amount_spent))} spent`, ...(r.offers_redeemed !== null ? [`${r.offers_redeemed} offers redeemed`] : [])],
              }))}
            />
          </div>
        </>
      )}
    </Card>
  )
}
