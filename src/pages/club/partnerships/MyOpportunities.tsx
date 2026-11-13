import { useCallback, useEffect, useState } from 'react'
import Modal from '../../../components/Modal'
import SocialPosts from '../../../components/suggest/SocialPosts'
import { opportunityCaptions } from '../../../lib/suggest/templates'
import { Link } from 'react-router-dom'
import { Alert, Button, ButtonLink, Card } from '../../../components/ui'
import { supportLabel } from '../../../lib/constants'
import { publicUrl } from '../../../lib/files'
import { usd } from '../../../lib/format'
import { supabase } from '../../../lib/supabase'
import { shareLink } from '../../../lib/urls'
import type { Opportunity, OpportunityStatus } from '../../../lib/types'
import { useClub } from '../ClubContext'

const STATUS: Record<OpportunityStatus, string> = {
  open: 'bg-green-100 text-green-800', filled: 'bg-accent-100 text-accent-700', closed: 'bg-slate-200 text-slate-700',
}

export default function MyOpportunities() {
  const { club, universityName } = useClub()
  const [items, setItems] = useState<(Opportunity & { events: { name: string; starts_at: string } | null })[] | null>(null)
  const [captionFor, setCaptionFor] = useState<(Opportunity & { events: { name: string; starts_at: string } | null }) | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('opportunities').select('*, events(name, starts_at)').eq('club_id', club.id).order('created_at', { ascending: false })
    setItems((data as (Opportunity & { events: { name: string; starts_at: string } | null })[]) ?? [])
  }, [club.id])
  useEffect(() => { void load() }, [load])

  async function setStatus(o: Opportunity, status: OpportunityStatus) {
    const { error } = await supabase.from('opportunities').update({ status }).eq('id', o.id)
    if (error) setError(error.message)
    await load()
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Open opportunities appear on every partner's dashboard.</p>
        <ButtonLink to="/club/opportunities/new">Post an opportunity</ButtonLink>
      </div>
      {error && <Alert className="mb-3">{error}</Alert>}
      {items === null ? <p className="text-sm text-slate-500">Loading…</p> : items.length === 0 ? (
        <Card><p className="text-sm text-slate-500">You haven't posted any opportunities yet. Describe what you can offer a sponsor — e.g. “10 minutes to present at our lunch for 40 students.”</p></Card>
      ) : (
        <ul className="space-y-3">
          {items.map((o) => {
            const photo = publicUrl('flyers', o.photo_path)
            return (
              <li key={o.id}>
                <Card className="flex flex-col gap-3 sm:flex-row">
                  {photo && <img src={photo} alt="" className="h-24 w-full rounded-md object-cover sm:w-32" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{o.title}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[o.status]}`}>{o.status}</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {supportLabel(o.support_type)}{o.amount_sought ? ` · asking ${usd.format(Number(o.amount_sought))}` : ''}
                      {o.events && o.event_id && <> · for <Link className="hover:underline" to={`/club/events/${o.event_id}`}>{o.events.name}</Link></>}
                    </p>
                    {o.description && <p className="mt-1 line-clamp-2 text-sm text-slate-700">{o.description}</p>}
                    <div className="mt-3 flex flex-wrap gap-2 text-sm">
                      <ButtonLink to={`/club/opportunities/${o.id}/edit`} variant="secondary" className="px-3 py-1">Edit</ButtonLink>
                      {o.status === 'open' ? (
                        <>
                          <Button variant="secondary" className="px-3 py-1" onClick={() => { void navigator.clipboard.writeText(shareLink(o.id)); setCopied(o.id) }}>
                            {copied === o.id ? 'Link copied' : 'Copy share link'}
                          </Button>
                          <Button variant="secondary" className="px-3 py-1" onClick={() => setCaptionFor(o)}>Social caption</Button>
                          <Button variant="ghost" className="px-3 py-1" onClick={() => void setStatus(o, 'closed')}>Close</Button>
                        </>
                      ) : (
                        <Button variant="ghost" className="px-3 py-1" onClick={() => void setStatus(o, 'open')}>Reopen</Button>
                      )}
                    </div>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
      <Modal open={!!captionFor} onClose={() => setCaptionFor(null)} title="Social media caption">
        {captionFor && (
          <SocialPosts
            kind="opportunity"
            id={captionFor.id}
            templates={opportunityCaptions({
              clubName: club.name, universityName, title: captionFor.title, eventName: captionFor.events?.name ?? null,
              eventDate: captionFor.events ? new Date(captionFor.events.starts_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null,
              headcount: null, link: shareLink(captionFor.id),
            })}
          />
        )}
      </Modal>
    </>
  )
}
