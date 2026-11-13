import { Link } from 'react-router-dom'
import { formatEventRange } from '../../../lib/format'
import type { ClubEvent, ProposalDetail } from '../../../lib/types'
import StatusBadge from '../../../components/StatusBadge'
import { Card } from '../../../components/ui'

/**
 * Sidebar: events waiting on the university admin (denied ones too, so the
 * club can fix them), proposals waiting on the club, partnerships waiting on
 * the university, and unread messages.
 */
export default function PendingApprovals({
  events, proposals, unread,
}: {
  events: ClubEvent[]
  proposals: ProposalDetail[]
  unread: number
}) {
  const now = Date.now()
  const items = events.filter((e) => new Date(e.starts_at).getTime() > now && e.approval_status !== 'approved')
  const needsYou = proposals.filter((p) => p.status === 'pending_club')
  // Partnerships tied to a pending event are approved with the event, so list only the standalone ones.
  const atUniversity = proposals.filter((p) => p.status === 'pending_admin' && p.event_approval_status !== 'pending')

  return (
    <Card>
      <h2 className="font-medium">Waiting on approval <span className="text-sm font-normal text-slate-500">({items.length + atUniversity.length})</span></h2>
      {items.length + atUniversity.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Nothing pending.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {items.map((e) => (
            <li key={e.id} className="py-2 text-sm">
              <Link to={`/club/events/${e.id}`} className="font-medium hover:underline">{e.name}</Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <StatusBadge status={e.approval_status} />
                {e.partner_id && e.approval_status === 'pending' && <span>+ partnership</span>}
                <span>{formatEventRange(e.starts_at, e.ends_at, e.time_zone)}</span>
              </div>
              {e.approval_status === 'denied' && e.denial_reason && <p className="mt-1 text-xs text-red-800">Reason: {e.denial_reason}</p>}
            </li>
          ))}
          {atUniversity.map((p) => (
            <li key={p.id} className="py-2 text-sm">
              <Link to="/club/partnerships?tab=proposals" className="font-medium hover:underline">Partnership with {p.partner_name}</Link>
              <p className="text-xs text-slate-500">{p.opportunity_title ?? p.event_name} · waiting on university</p>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-4 border-t border-slate-100 pt-3 font-medium">Partner proposals <span className="text-sm font-normal text-slate-500">({needsYou.length})</span></h2>
      {needsYou.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No proposals waiting on you.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {needsYou.map((p) => (
            <li key={p.id}>
              <Link to="/club/partnerships?tab=proposals" className="font-medium hover:underline">{p.partner_name}</Link>
              <span className="text-xs text-slate-500"> · {p.opportunity_title ?? p.event_name ?? 'general'}</span>
            </li>
          ))}
        </ul>
      )}
      {unread > 0 && (
        <p className="mt-3 text-sm"><Link to="/club/messages" className="text-accent-700 hover:underline">{unread} unread message{unread === 1 ? '' : 's'}</Link></p>
      )}
    </Card>
  )
}
