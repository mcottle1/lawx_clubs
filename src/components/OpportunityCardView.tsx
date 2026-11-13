import { Link } from 'react-router-dom'
import { supportLabel } from '../lib/constants'
import { publicUrl } from '../lib/files'
import { formatEventRange, usd } from '../lib/format'
import { logoUrl } from '../lib/storage'
import type { OpportunityCard } from '../lib/types'
import { Card } from './ui'

/** Opportunity summary used on the partner feed and the public share page. */
export default function OpportunityCardView({ o, to, full = false }: { o: OpportunityCard; to?: string; full?: boolean }) {
  const photo = publicUrl('flyers', o.photo_path)
  const clubLogo = logoUrl(o.club_logo_path)
  const title = to ? <Link to={to} className="hover:underline">{o.title}</Link> : o.title
  return (
    <Card className="flex h-full flex-col gap-3 sm:flex-row">
      {photo && <img src={photo} alt="" className={`w-full rounded-md object-cover ${full ? 'max-h-72 sm:w-72' : 'h-32 sm:w-40'}`} />}
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-600">
          {clubLogo && <img src={clubLogo} alt="" className="h-5 w-5 rounded object-cover" />}
          {o.club_name} · {o.university_name}
        </p>
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          {o.event_starts_at && o.event_time_zone && (
            <div><dt className="sr-only">Event date</dt><dd>📅 {formatEventRange(o.event_starts_at, o.event_starts_at, o.event_time_zone).split(' · ')[0]}{o.event_name ? ` · ${o.event_name}` : ''}</dd></div>
          )}
          <div><dt className="sr-only">Support</dt><dd>{supportLabel(o.support_type)}</dd></div>
          {o.amount_sought ? <div><dt className="sr-only">Asking</dt><dd className="font-medium text-slate-800">Asking {usd.format(Number(o.amount_sought))}</dd></div> : null}
        </dl>
        {o.description && <p className={`mt-2 whitespace-pre-line text-sm text-slate-700 ${full ? '' : 'line-clamp-3'}`}>{o.description}</p>}
      </div>
    </Card>
  )
}
