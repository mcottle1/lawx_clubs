import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import listPlugin from '@fullcalendar/list'
import { useNavigate } from 'react-router-dom'
import { brand } from '../../../lib/theme'
import type { ClubEvent, EventReport } from '../../../lib/types'
import { Card } from '../../../components/ui'

// Approved events use the brand color (from index.css); status colors stay semantic.
const COLORS = {
  get approved() { return brand.primary() },
  pending: '#b45309',
  changes_requested: '#9d174d',
  denied: '#b91c1c',
  past: '#64748b',
}
const LEGEND = { approved: 'Approved', pending: 'Pending', changes_requested: 'Changes requested', denied: 'Denied', past: 'Past' }

/**
 * Month/list calendar of events. Clubs see their own; admins pass `basePath`
 * (where an event opens) and `label` (e.g. to prefix the club's name).
 */
export default function ClubCalendar({ events, reports, basePath = '/club/events', label, heading = 'Calendar' }: {
  events: ClubEvent[]
  reports: Map<string, EventReport>
  basePath?: string
  label?: (e: ClubEvent) => string
  heading?: string
}) {
  const navigate = useNavigate()
  const now = Date.now()
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">{heading}</h2>
        <ul className="flex flex-wrap gap-3 text-xs text-slate-600" aria-label="Legend">
          {(['approved', 'pending', 'changes_requested', 'denied', 'past'] as const).map((k) => (
            <li key={k} className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLORS[k] }} aria-hidden />
              {LEGEND[k]}
            </li>
          ))}
        </ul>
      </div>
      <FullCalendar
        plugins={[dayGridPlugin, listPlugin]}
        initialView={narrow ? 'listMonth' : 'dayGridMonth'}
        headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,listMonth' }}
        buttonText={{ today: 'Today', month: 'Month', list: 'List' }}
        height="auto"
        dayMaxEventRows={3}
        noEventsContent="No events this month."
        events={events.map((e) => {
          const past = new Date(e.ends_at).getTime() < now
          const report = reports.get(e.id)
          return {
            id: e.id,
            title: (label ? label(e) : e.name) + (past && report ? ` · ${report.attendees} attended` : ''),
            start: e.starts_at,
            end: e.ends_at,
            color: past ? COLORS.past : COLORS[e.approval_status],
          }
        })}
        eventClick={(info) => {
          info.jsEvent.preventDefault()
          navigate(`${basePath}/${info.event.id}`)
        }}
        eventDidMount={(info) => {
          // Make events reachable and readable by keyboard / screen readers.
          info.el.setAttribute('tabindex', '0')
          info.el.setAttribute('role', 'link')
          info.el.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); navigate(`${basePath}/${info.event.id}`) }
          })
        }}
      />
    </Card>
  )
}
