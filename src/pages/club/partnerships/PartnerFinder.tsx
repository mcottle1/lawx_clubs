import { useEffect, useMemo, useState } from 'react'
import Modal from '../../../components/Modal'
import { AiBadge, AiUsage } from '../../../components/suggest/AiNote'
import { Alert, Button, Card, Field, inputClass } from '../../../components/ui'
import { callAi, useAiStatus } from '../../../lib/ai'
import { categoryLabel } from '../../../lib/constants'
import { logoUrl } from '../../../lib/storage'
import { inferCategories } from '../../../lib/suggest/keywords'
import { rankPartners, type MatchStats } from '../../../lib/suggest/partnerMatch'
import { searchLinks } from '../../../lib/suggest/searchLinks'
import { supabase } from '../../../lib/supabase'
import type { ClubEvent, Partner, PartnerCategory } from '../../../lib/types'
import { useClub } from '../ClubContext'
import { ReachOutForm } from './PartnerDirectory'

interface AiBusiness { name: string; website: string; city: string; category: PartnerCategory; reason: string }

/**
 * Partner finder: platform partners ranked by simple rules (always on, free),
 * map/web search links for outside businesses, and an optional AI web search.
 */
export default function PartnerFinder() {
  const { universityCity, universityState } = useClub()
  const [events, setEvents] = useState<ClubEvent[]>([])
  const [partners, setPartners] = useState<Partner[] | null>(null)
  const [stats, setStats] = useState<Map<string, MatchStats>>(new Map())
  const [eventId, setEventId] = useState('')
  const [keywords, setKeywords] = useState('')
  const [contact, setContact] = useState<Partner | null>(null)
  const [ai, refreshAi] = useAiStatus()
  const [aiResults, setAiResults] = useState<AiBusiness[] | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('events').select('*').gt('starts_at', new Date().toISOString()).order('starts_at')
      .then(({ data }) => setEvents((data as ClubEvent[]) ?? []))
    supabase.from('partners').select('*').eq('open_to_sponsorships', true)
      .then(({ data }) => setPartners((data as Partner[]) ?? []))
    supabase.rpc('partner_match_stats').then(({ data }) => {
      setStats(new Map(((data ?? []) as ({ partner_id: string } & MatchStats)[]).map((r) => [r.partner_id, r])))
    })
  }, [])

  const event = events.find((e) => e.id === eventId) ?? null
  const text = `${event ? `${event.name} ${event.description}` : ''} ${keywords}`.trim()

  const ranked = useMemo(() => partners ? rankPartners({
    text, universityCity, universityState, partners, stats,
  }) : [], [partners, stats, text, universityCity, universityState])
  const shown = text ? ranked.filter((r) => r.score > 0).slice(0, 8) : ranked.slice(0, 8)
  const links = searchLinks(inferCategories(text).map((h) => h.category), universityCity, universityState)

  async function searchWithAi() {
    setAiBusy(true)
    setAiError(null)
    try {
      const res = await callAi<{ businesses: AiBusiness[] }>('find_partners', { event_id: eventId || null, keywords })
      setAiResults(res.businesses)
    } catch (e) {
      setAiError((e as Error).message)
    }
    setAiBusy(false)
    refreshAi()
  }

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-slate-600">
          Pick an event (or describe what you're planning) and we'll suggest partners. Your club's location, past sponsors and the event's
          topic are used automatically.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Event">
            {(id) => (
              <select id={id} className={inputClass} value={eventId} onChange={(e) => { setEventId(e.target.value); setAiResults(null) }}>
                <option value="">No specific event</option>
                {events.map((e) => <option key={e.id} value={e.id}>{e.name} — {new Date(e.starts_at).toLocaleDateString()}</option>)}
              </select>
            )}
          </Field>
          <Field label="What are you looking for?" hint="e.g. “lunch for 40”, “bar prep”, “firm for a career panel”">
            {(id) => <input id={id} className={inputClass} maxLength={300} value={keywords} onChange={(e) => { setKeywords(e.target.value); setAiResults(null) }} />}
          </Field>
        </div>
      </Card>

      <section aria-labelledby="matches-h">
        <h2 id="matches-h" className="mb-2 font-medium">Partners on this site</h2>
        {partners === null ? <p className="text-sm text-slate-500">Loading…</p> : shown.length === 0 ? (
          <Card><p className="text-sm text-slate-500">{text ? 'No strong matches on the site yet — try the searches below.' : 'No partners are open to sponsorships yet.'}</p></Card>
        ) : (
          <ol className="space-y-3">
            {shown.map(({ partner: p, reasons }) => {
              const logo = logoUrl(p.logo_path)
              return (
                <li key={p.id}>
                  <Card className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    {logo ? <img src={logo} alt="" className="h-12 w-12 shrink-0 rounded-md border border-slate-200 object-cover" />
                      : <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-slate-100 font-semibold text-slate-500">{p.name[0]}</span>}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{p.name} <span className="text-xs font-normal text-slate-500">{categoryLabel(p.category)} · {p.city}, {p.state}</span></p>
                      <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">
                        {reasons.slice(0, 4).map((r) => <li key={r}>{r}</li>)}
                      </ul>
                    </div>
                    <div className="flex shrink-0 gap-2 text-sm">
                      <Button onClick={() => setContact(p)}>Reach out</Button>
                    </div>
                  </Card>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <section aria-labelledby="outside-h">
        <Card>
          <h2 id="outside-h" className="font-medium">Businesses that aren't on the site yet</h2>
          <p className="mt-1 text-sm text-slate-600">These searches open in a new tab, near {[universityCity, universityState].filter(Boolean).join(', ') || 'your university'}.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {links.map((l) => (
              <li key={l.url}><a href={l.url} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">{l.label} ↗</a></li>
            ))}
          </ul>

          {ai?.enabled && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void searchWithAi()} disabled={aiBusy}>{aiBusy ? 'Searching the web… (up to a minute)' : 'Search the web with AI'}</Button>
                <AiBadge />
              </div>
              <div className="mt-2"><AiUsage status={ai} kind="search" /></div>
              {aiError && <Alert className="mt-3">{aiError}</Alert>}
              {aiResults && (
                aiResults.length === 0 ? <p className="mt-3 text-sm text-slate-500">The AI didn't find any new businesses this time.</p> : (
                  <ul className="mt-3 divide-y divide-slate-100 text-sm">
                    {aiResults.map((b) => (
                      <li key={b.website + b.name} className="py-2">
                        <p className="font-medium">
                          <a href={b.website} target="_blank" rel="noreferrer nofollow" className="text-accent-700 hover:underline">{b.name} ↗</a>
                          <span className="ml-1 text-xs font-normal text-slate-500">{categoryLabel(b.category)}{b.city && ` · ${b.city}`}</span>
                        </p>
                        <p className="text-slate-700">{b.reason}</p>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>
          )}
        </Card>
      </section>

      <Modal open={!!contact} onClose={() => setContact(null)} title={`Message ${contact?.name ?? ''}`}>
        {contact && <ReachOutForm partner={contact} eventId={eventId || undefined} />}
      </Modal>
    </div>
  )
}
