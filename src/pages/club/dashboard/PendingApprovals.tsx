import { Link } from 'react-router-dom'
import { formatEventRange } from '../../../lib/format'
import type { ClubEvent } from '../../../lib/types'
import StatusBadge from '../../../components/StatusBadge'
import { Card } from '../../../components/ui'

/** Upcoming events waiting on the university admin, plus denied ones that need changes. */
export default function PendingApprovals({ events }: { events: ClubEvent[] }) {
  const now = Date.now()
  const items = events.filter((e) => new Date(e.starts_at).getTime() > now && e.approval_status !== 'approved')
  return (
    <Card>
      <h2 className="font-medium">Waiting on approval <span className="text-sm font-normal text-slate-500">({items.length})</span></h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Nothing pending.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {items.map((e) => (
            <li key={e.id} className="py-2 text-sm">
              <Link to={`/club/events/${e.id}`} className="font-medium hover:underline">{e.name}</Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <StatusBadge status={e.approval_status} />
                <span>{formatEventRange(e.starts_at, e.ends_at, e.time_zone)}</span>
              </div>
              {e.approval_status === 'denied' && e.denial_reason && (
                <p className="mt-1 text-xs text-red-800">Reason: {e.denial_reason}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500">Partner proposals will appear here once partnerships launch.</p>
    </Card>
  )
}
