import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { publicUrl } from '../../../lib/files'
import { formatEventRange, usd } from '../../../lib/format'
import { logoUrl } from '../../../lib/storage'
import { supabase } from '../../../lib/supabase'
import type { ClubEvent, EventReport, Partner } from '../../../lib/types'
import StatusBadge from '../../../components/StatusBadge'
import { Alert, Button, ButtonLink, Card, PageHeader, Spinner } from '../../../components/ui'
import { useClub } from '../ClubContext'
import SchedulingHelp from './SchedulingHelp'

type EventRow = ClubEvent & { partners: Pick<Partner, 'name' | 'city' | 'state' | 'logo_path' | 'website'> | null }

export default function EventDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const saved = (location.state as { saved?: string } | null)?.saved
  const { scheduling } = useClub()
  const [event, setEvent] = useState<EventRow | null | undefined>(undefined)
  const [report, setReport] = useState<EventReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('events').select('*, partners(name, city, state, logo_path, website)').eq('id', id!).maybeSingle()
      .then(({ data }) => setEvent(data as EventRow | null))
    supabase.from('event_reports').select('*').eq('event_id', id!).maybeSingle()
      .then(({ data }) => setReport(data as EventReport | null))
  }, [id])

  if (event === undefined) return <Spinner />
  if (event === null) return <Alert>Event not found.</Alert>

  const upcoming = new Date(event.starts_at) > new Date()
  const ended = new Date(event.ends_at) < new Date()
  const flyer = publicUrl('flyers', event.flyer_path)

  async function onDelete() {
    if (!confirm(`Delete “${event!.name}”? This can't be undone.`)) return
    const { error } = await supabase.from('events').delete().eq('id', event!.id)
    if (error) return setError(error.message)
    navigate('/club', { replace: true })
  }

  return (
    <>
      <PageHeader
        title={event.name}
        subtitle={formatEventRange(event.starts_at, event.ends_at, event.time_zone)}
        actions={upcoming && (
          <>
            <ButtonLink to={`/club/events/${event.id}/edit`} variant="secondary">Edit</ButtonLink>
            <Button variant="danger" onClick={() => void onDelete()}>Delete</Button>
          </>
        )}
      />
      <div className="space-y-4">
        {saved && <Alert kind="success">Event {saved}. {event.approval_status === 'pending' && 'It’s waiting for your university administrator’s approval.'}</Alert>}
        {error && <Alert>{error}</Alert>}
        {event.approval_status === 'denied' && (
          <Alert>
            Denied{event.denial_reason ? `: ${event.denial_reason}` : '.'} {upcoming && 'Edit the event to resubmit it.'}
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="space-y-4 md:col-span-2">
            <div className="flex items-center gap-2"><StatusBadge status={event.approval_status} /></div>
            <Detail label="Description">{event.description || <Muted>No description.</Muted>}</Detail>
            <Detail label="Location">
              {event.location ?? (
                <>
                  <Muted>Not booked yet.</Muted>
                  {event.location_reminder_days && <Muted> Reminder {event.location_reminder_days} days before.</Muted>}
                  {upcoming && <div className="mt-2"><SchedulingHelp scheduling={scheduling} /></div>}
                </>
              )}
            </Detail>
            <Detail label="Sponsor">
              {event.partners ? (
                <span className="flex items-center gap-2">
                  {event.partners.logo_path && <img src={logoUrl(event.partners.logo_path)!} alt="" className="h-8 w-8 rounded object-cover" />}
                  {event.partners.name} <Muted>({event.partners.city}, {event.partners.state})</Muted>
                </span>
              ) : event.outside_sponsor_name ? (
                <>{event.outside_sponsor_name} <Muted>(outside sponsor)</Muted></>
              ) : (
                <>
                  <Muted>None yet.</Muted>
                  {event.partner_reminder_days && <Muted> Reminder {event.partner_reminder_days} days before.</Muted>}
                </>
              )}
            </Detail>
            {event.potential_sponsor_notes && <Detail label="Potential sponsor opportunities">{event.potential_sponsor_notes}</Detail>}
            <Detail label="Budget">{usd.format(Number(event.budget))}</Detail>
          </Card>

          <Card>
            <h2 className="text-sm font-medium text-slate-600">Flyer</h2>
            {flyer ? (
              event.flyer_path!.toLowerCase().endsWith('.pdf')
                ? <a href={flyer} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-accent-700 hover:underline">Open flyer (PDF)</a>
                : <a href={flyer} target="_blank" rel="noreferrer"><img src={flyer} alt={`Flyer for ${event.name}`} className="mt-2 w-full rounded border border-slate-200" /></a>
            ) : (
              <p className="mt-2 text-sm text-slate-500">No flyer uploaded.</p>
            )}
          </Card>
        </div>

        {ended && (
          <Card>
            <h2 className="font-medium">Event report</h2>
            {report ? (
              <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-3">
                <div><dt className="text-slate-500">Attendees</dt><dd className="text-lg font-semibold">{report.attendees}</dd></div>
                <div><dt className="text-slate-500">Amount spent</dt><dd className="text-lg font-semibold">{usd.format(Number(report.amount_spent))}</dd></div>
                {report.offers_redeemed !== null && <div><dt className="text-slate-500">Offers redeemed</dt><dd className="text-lg font-semibold">{report.offers_redeemed}</dd></div>}
                {report.notes && <div className="sm:col-span-3"><dt className="text-slate-500">Notes</dt><dd className="whitespace-pre-line">{report.notes}</dd></div>}
              </dl>
            ) : (
              <p className="mt-2 text-sm text-slate-500">No report yet. Post-event reporting is coming in a later phase.</p>
            )}
          </Card>
        )}

        <Link to="/club" className="inline-block text-sm text-accent-700 hover:underline">← Back to dashboard</Link>
      </div>
    </>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</h3>
      <div className="mt-1 whitespace-pre-line text-sm">{children}</div>
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-slate-500">{children}</span>
}
