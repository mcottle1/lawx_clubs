import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Modal from '../../components/Modal'
import ProposalTerms from '../../components/ProposalTerms'
import { Alert, Button, Card, Field, inputClass, Spinner } from '../../components/ui'
import { categoryLabel } from '../../lib/constants'
import { publicUrl } from '../../lib/files'
import { formatEventRange, usd } from '../../lib/format'
import { notify } from '../../lib/notify'
import { supabase } from '../../lib/supabase'
import type { ClubEvent, ProposalDetail } from '../../lib/types'

type PendingEvent = ClubEvent & { clubs: { name: string } | null; partners: { name: string; category: string } | null }
type Target = { kind: 'event' | 'proposal'; id: string; label: string }

export default function Approvals() {
  const [events, setEvents] = useState<PendingEvent[] | null>(null)
  const [proposals, setProposals] = useState<ProposalDetail[]>([])
  const [recent, setRecent] = useState<PendingEvent[]>([])
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [denying, setDenying] = useState<Target | null>(null)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [ev, pr, rec] = await Promise.all([
      supabase.from('events').select('*, clubs(name), partners(name, category)').eq('approval_status', 'pending').order('starts_at'),
      supabase.from('proposal_details').select('*').eq('status', 'pending_admin').order('created_at'),
      supabase.from('events').select('*, clubs(name), partners(name, category)').neq('approval_status', 'pending').not('reviewed_at', 'is', null).order('reviewed_at', { ascending: false }).limit(5),
    ])
    setEvents((ev.data as PendingEvent[]) ?? [])
    setProposals((pr.data as ProposalDetail[]) ?? [])
    setRecent((rec.data as PendingEvent[]) ?? [])
  }, [])
  useEffect(() => { void load() }, [load])

  async function decide(t: Target, approve: boolean, reason?: string) {
    setBusy(t.id)
    const fn = t.kind === 'event' ? 'review_event' : 'review_proposal'
    const args = t.kind === 'event'
      ? { p_event_id: t.id, p_approve: approve, p_reason: reason ?? null }
      : { p_proposal_id: t.id, p_approve: approve, p_reason: reason ?? null }
    const { error } = await supabase.rpc(fn, args)
    setBusy(null)
    if (error) return setMsg({ kind: 'error', text: error.message })
    notify('reviewed', t.id, { kind: t.kind })
    setMsg({ kind: 'success', text: `${approve ? 'Approved' : 'Denied'}: ${t.label}. The club${t.kind === 'proposal' || proposals.some((p) => p.event_id === t.id) ? ' and partner have' : ' has'} been notified.` })
    setDenying(null)
    await load()
  }

  if (!events) return <Spinner />
  const standalone = proposals.filter((p) => !p.event_id || p.event_approval_status !== 'pending')
  const total = events.length + standalone.length

  return (
    <>
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      <h2 className="mb-3 font-medium">Pending approvals ({total})</h2>
      {total === 0 && <Card><p className="text-sm text-slate-500">You're all caught up.</p></Card>}
      <ul className="space-y-3">
        {events.map((e) => {
          const withEvent = proposals.filter((p) => p.event_id === e.id)
          const flyer = publicUrl('flyers', e.flyer_path)
          const past = new Date(e.starts_at) < new Date()
          const t: Target = { kind: 'event', id: e.id, label: e.name }
          return (
            <li key={e.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Event{withEvent.length > 0 && ' + partnership'}</p>
                    <h3 className="font-semibold">{e.name}</h3>
                    <p className="text-sm text-slate-600">{e.clubs?.name} · {formatEventRange(e.starts_at, e.ends_at, e.time_zone)}</p>
                    {past && <p className="text-xs text-amber-800">This event's date has already passed.</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" aria-expanded={!!open[e.id]} onClick={() => setOpen({ ...open, [e.id]: !open[e.id] })}>{open[e.id] ? 'Hide' : 'Review'}</Button>
                    <Button disabled={busy === e.id} onClick={() => void decide(t, true)}>Approve</Button>
                    <Button variant="danger" disabled={busy === e.id} onClick={() => setDenying(t)}>Deny</Button>
                  </div>
                </div>
                {open[e.id] && (
                  <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 text-sm md:grid-cols-3">
                    <dl className="space-y-2 md:col-span-2">
                      <div><dt className="text-slate-500">Location</dt><dd>{e.location ?? 'Not booked yet'}</dd></div>
                      <div><dt className="text-slate-500">Budget</dt><dd>{usd.format(Number(e.budget))}</dd></div>
                      <div><dt className="text-slate-500">Sponsor</dt><dd>{e.partners ? `${e.partners.name} (${categoryLabel(e.partners.category)})` : e.outside_sponsor_name ? `${e.outside_sponsor_name} (outside sponsor)` : 'None'}</dd></div>
                      {e.description && <div><dt className="text-slate-500">Description</dt><dd className="whitespace-pre-line">{e.description}</dd></div>}
                    </dl>
                    {flyer && (e.flyer_path!.toLowerCase().endsWith('.pdf')
                      ? <a href={flyer} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">Open flyer (PDF)</a>
                      : <img src={flyer} alt={`Flyer for ${e.name}`} className="w-full rounded border border-slate-200" />)}
                    {withEvent.map((p) => (
                      <div key={p.id} className="rounded-md bg-slate-50 p-3 md:col-span-3">
                        <p className="mb-2 font-medium">Partnership with {p.partner_name} — approved or denied along with this event</p>
                        <ProposalTerms p={p} />
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </li>
          )
        })}
        {standalone.map((p) => {
          const t: Target = { kind: 'proposal', id: p.id, label: `partnership with ${p.partner_name}` }
          return (
            <li key={p.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Partnership</p>
                    <h3 className="font-semibold">{p.partner_name} → {p.club_name}</h3>
                    <p className="text-sm text-slate-600">{p.opportunity_title ?? p.event_name ?? 'General sponsorship'} · {categoryLabel(p.partner_category)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button disabled={busy === p.id} onClick={() => void decide(t, true)}>Approve</Button>
                    <Button variant="danger" disabled={busy === p.id} onClick={() => setDenying(t)}>Deny</Button>
                  </div>
                </div>
                <div className="mt-3 border-t border-slate-100 pt-3"><ProposalTerms p={p} /></div>
              </Card>
            </li>
          )
        })}
      </ul>

      {recent.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 font-medium">Recently decided</h2>
          <Card className="p-0">
            <ul className="divide-y divide-slate-100 text-sm">
              {recent.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2 px-5 py-2">
                  <span>{e.name} <span className="text-slate-500">· {e.clubs?.name}</span></span>
                  <span className={e.approval_status === 'approved' ? 'text-green-700' : 'text-red-700'}>{e.approval_status}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <Modal open={!!denying} onClose={() => setDenying(null)} title={`Deny ${denying?.label ?? ''}`}>
        {denying && <DenyForm busy={busy === denying.id} onSubmit={(reason) => void decide(denying, false, reason)} />}
      </Modal>
    </>
  )
}

function DenyForm({ onSubmit, busy }: { onSubmit: (reason: string) => void; busy: boolean }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!reason.trim()) return setError('Please give a short reason — the club sees it.')
    onSubmit(reason.trim())
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <Field label="Reason" required hint="Shared with the club (and the partner, if any).">
        {(id) => <textarea id={id} rows={3} maxLength={1000} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <Button type="submit" variant="danger" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Deny'}</Button>
    </form>
  )
}
