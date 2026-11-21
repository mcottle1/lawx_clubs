import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Modal from '../../components/Modal'
import ProposalTerms from '../../components/ProposalTerms'
import StatusBadge from '../../components/StatusBadge'
import { Alert, Button, Card, Field, inputClass, Spinner } from '../../components/ui'
import { categoryLabel, supportLabel } from '../../lib/constants'
import { publicUrl } from '../../lib/files'
import { formatEventRange, usd } from '../../lib/format'
import { notify } from '../../lib/notify'
import { supabase } from '../../lib/supabase'
import type { ClubEvent, MessageReview, OpportunityCard, ProposalDetail } from '../../lib/types'

type PendingEvent = ClubEvent & {
  clubs: { name: string; department_id: string; departments: { name: string } | null } | null
  partners: { name: string; category: string } | null
}
type Kind = 'event' | 'proposal' | 'opportunity' | 'message'
type Decision = 'approve' | 'send_back' | 'deny'
type Target = { kind: Kind; id: string; label: string; requester: string }

const RPC: Record<Kind, [fn: string, idArg: string]> = {
  event: ['decide_event', 'p_event_id'],
  proposal: ['decide_proposal', 'p_proposal_id'],
  opportunity: ['decide_opportunity', 'p_opportunity_id'],
  message: ['decide_conversation', 'p_conversation_id'],
}

/**
 * The approval queue. College admins see and decide their college's items.
 * With `oversight` (organization admin), every college's items are listed, but
 * the buttons only appear for colleges without an admin of their own.
 */
export default function Approvals({ oversight }: { oversight?: { actsFor: Set<string> } }) {
  const base = useLocation().pathname.startsWith('/org-admin') ? '/org-admin' : '/university-admin'
  const [events, setEvents] = useState<PendingEvent[] | null>(null)
  const [proposals, setProposals] = useState<ProposalDetail[]>([])
  const [opportunities, setOpportunities] = useState<OpportunityCard[]>([])
  const [messages, setMessages] = useState<MessageReview[]>([])
  const [recent, setRecent] = useState<PendingEvent[]>([])
  const [noting, setNoting] = useState<{ target: Target; decision: 'send_back' | 'deny' } | null>(null)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [ev, pr, op, me, rec] = await Promise.all([
      supabase.from('events').select('*, clubs(name, department_id, departments(name)), partners(name, category)').eq('approval_status', 'pending').order('starts_at'),
      supabase.from('proposal_details').select('*').in('status', ['pending_admin', 'pending_review']).order('created_at'),
      supabase.from('opportunity_cards').select('*').eq('approval_status', 'pending').order('created_at'),
      supabase.from('message_reviews').select('*').eq('approval_status', 'pending').order('submitted_at'),
      supabase.from('events').select('*, clubs(name, department_id, departments(name)), partners(name, category)').neq('approval_status', 'pending').not('reviewed_at', 'is', null).order('reviewed_at', { ascending: false }).limit(5),
    ])
    setEvents((ev.data as PendingEvent[]) ?? [])
    setProposals((pr.data as ProposalDetail[]) ?? [])
    setOpportunities((op.data as OpportunityCard[]) ?? [])
    setMessages((me.data as MessageReview[]) ?? [])
    setRecent((rec.data as PendingEvent[]) ?? [])
  }, [])
  useEffect(() => { void load() }, [load])

  async function decide(t: Target, decision: Decision, note?: string) {
    setBusy(t.id)
    const [fn, idArg] = RPC[t.kind]
    const { error } = await supabase.rpc(fn, { [idArg]: t.id, p_decision: decision, p_note: note ?? null })
    setBusy(null)
    if (error) return setMsg({ kind: 'error', text: error.message })
    notify('reviewed', t.id, { kind: t.kind })
    const verb = { approve: 'Approved', send_back: 'Sent back for changes', deny: 'Denied' }[decision]
    setMsg({ kind: 'success', text: `${verb}: ${t.label}. ${decision === 'send_back' ? `The ${t.requester} can edit and resubmit it.` : `The ${t.requester} has been notified.`}` })
    setNoting(null)
    await load()
  }

  if (!events) return <Spinner />
  const screening = proposals.filter((p) => p.status === 'pending_review')
  const finals = proposals.filter((p) => p.status === 'pending_admin')
  const standalone = finals.filter((p) => !p.event_id || p.event_approval_status !== 'pending')
  const total = events.length + standalone.length + screening.length + opportunities.length + messages.length

  const actions = (t: Target, college?: { id?: string; name?: string | null }) => oversight && !oversight.actsFor.has(college?.id ?? '') ? (
    <p className="text-xs text-slate-500">Decided by {college?.name ?? 'the college'}’s admins</p>
  ) : (
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy === t.id} onClick={() => void decide(t, 'approve')}>Approve</Button>
      <Button variant="secondary" disabled={busy === t.id} onClick={() => setNoting({ target: t, decision: 'send_back' })}>Send back</Button>
      <Button variant="danger" disabled={busy === t.id} onClick={() => setNoting({ target: t, decision: 'deny' })}>Deny</Button>
    </div>
  )

  return (
    <>
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Pending approvals ({total})</h2>
        {!oversight && <Link to="/university-admin/settings" className="text-sm text-accent-700 hover:underline">Choose what needs approval</Link>}
      </div>
      {total === 0 && <Card><p className="text-sm text-slate-500">You're all caught up.</p></Card>}

      <Group title="Events" count={events.length}>
        {events.map((e) => {
          const withEvent = finals.filter((p) => p.event_id === e.id)
          const flyer = publicUrl('flyers', e.flyer_path)
          const past = new Date(e.starts_at) < new Date()
          const t: Target = { kind: 'event', id: e.id, label: e.name, requester: withEvent.length ? 'club (and partner)' : 'club' }
          return (
            <ReviewCard
              key={e.id}
              kind={`Event${withEvent.length > 0 ? ' + partnership' : ''}`}
              title={e.name}
              subtitle={<>{e.clubs?.name} · {formatEventRange(e.starts_at, e.ends_at, e.time_zone)}{past && <span className="block text-xs text-amber-800">This event's date has already passed.</span>}</>}
              actions={actions(t, { id: e.clubs?.department_id, name: e.clubs?.departments?.name })}
              college={oversight ? e.clubs?.departments?.name : undefined}
              resubmitted={e.denial_reason}
            >
              <div className="grid gap-4 text-sm md:grid-cols-3">
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
                    <p className="mb-2 font-medium">Partnership with {p.partner_name}: decided along with this event</p>
                    <ProposalTerms p={p} />
                  </div>
                ))}
              </div>
            </ReviewCard>
          )
        })}
      </Group>

      <Group title="Partnerships" count={standalone.length}>
        {standalone.map((p) => (
          <ReviewCard
            key={p.id}
            kind="Partnership (accepted by the club)"
            title={`${p.partner_name} → ${p.club_name}`}
            subtitle={`${p.opportunity_title ?? p.event_name ?? 'General sponsorship'} · ${categoryLabel(p.partner_category)}`}
            actions={actions({ kind: 'proposal', id: p.id, label: `partnership with ${p.partner_name}`, requester: 'partner' }, { id: p.department_id, name: p.department_name })}
            college={oversight ? p.department_name : undefined}
            open
          >
            <ProposalTerms p={p} />
            <p className="mt-2 text-xs text-slate-500">Sending it back returns it to the partner to revise; the club then accepts the new terms.</p>
          </ReviewCard>
        ))}
      </Group>

      <Group title="Partner proposals to screen" count={screening.length}>
        {screening.map((p) => (
          <ReviewCard
            key={p.id}
            kind="Proposal (not shown to the club yet)"
            title={`${p.partner_name} → ${p.club_name}`}
            subtitle={`${p.opportunity_title ?? p.event_name ?? 'General sponsorship'} · ${categoryLabel(p.partner_category)}`}
            actions={actions({ kind: 'proposal', id: p.id, label: `proposal from ${p.partner_name}`, requester: 'partner' }, { id: p.department_id, name: p.department_name })}
            college={oversight ? p.department_name : undefined}
            resubmitted={p.denial_reason}
            open
          >
            <ProposalTerms p={p} />
            <p className="mt-2 text-xs text-slate-500">If you approve, the club sees it and decides whether to accept.</p>
          </ReviewCard>
        ))}
      </Group>

      <Group title="Sponsorship opportunities" count={opportunities.length}>
        {opportunities.map((o) => {
          const photo = publicUrl('flyers', o.photo_path)
          return (
            <ReviewCard
              key={o.id}
              kind="Opportunity post"
              title={o.title}
              subtitle={`${o.club_name} · ${supportLabel(o.support_type)}${o.amount_sought ? ` · asking ${usd.format(Number(o.amount_sought))}` : ''}`}
              actions={actions({ kind: 'opportunity', id: o.id, label: o.title, requester: 'club' }, { id: o.department_id, name: o.department_name })}
              college={oversight ? o.department_name : undefined}
              resubmitted={o.review_note}
              open
            >
              <div className="grid gap-4 text-sm md:grid-cols-3">
                <div className="md:col-span-2">
                  {o.event_name && <p className="text-slate-500">For: {o.event_name}</p>}
                  <p className="mt-1 whitespace-pre-line">{o.description || <span className="text-slate-500">No description.</span>}</p>
                </div>
                {photo && <img src={photo} alt="" className="w-full rounded border border-slate-200" />}
              </div>
            </ReviewCard>
          )
        })}
      </Group>

      <Group title="First messages to partners" count={messages.length}>
        {messages.map((m) => (
          <ReviewCard
            key={m.id}
            kind="First message"
            title={m.subject}
            subtitle={`${m.club_name} → ${m.partner_name} (${categoryLabel(m.partner_category)}, ${m.partner_city}, ${m.partner_state})${m.event_name ? ` · about ${m.event_name}` : ''}`}
            actions={actions({ kind: 'message', id: m.id, label: `message to ${m.partner_name}`, requester: 'club' }, { id: m.department_id, name: m.department_name })}
            college={oversight ? m.department_name : undefined}
            resubmitted={m.review_note}
            open
          >
            <p className="whitespace-pre-line rounded-md bg-slate-50 p-3 text-sm">{m.body}</p>
          </ReviewCard>
        ))}
      </Group>

      {recent.length > 0 && (
        <>
          <div className="mb-2 mt-8 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">Recently decided events</h2>
            <Link to={`${base}/history`} className="text-sm text-accent-700 hover:underline">All events →</Link>
          </div>
          <Card className="p-0">
            <ul className="divide-y divide-slate-100 text-sm">
              {recent.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2">
                  <span><Link to={`${base}/events/${e.id}`} className="font-medium text-accent-700 hover:underline">{e.name}</Link> <span className="text-slate-500">· {e.clubs?.name}{oversight && e.clubs?.departments ? ` · ${e.clubs.departments.name}` : ''}</span></span>
                  <StatusBadge status={e.approval_status} />
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <Modal
        open={!!noting}
        onClose={() => setNoting(null)}
        title={noting ? `${noting.decision === 'deny' ? 'Deny' : 'Send back'} ${noting.target.label}` : ''}
      >
        {noting && (
          <NoteForm
            decision={noting.decision}
            requester={noting.target.requester}
            busy={busy === noting.target.id}
            onSubmit={(note) => void decide(noting.target, noting.decision, note)}
          />
        )}
      </Modal>
    </>
  )
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null
  return (
    <section className="mb-6" aria-label={title}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title} ({count})</h3>
      <ul className="space-y-3">{children}</ul>
    </section>
  )
}

/** One item to review: summary line, action buttons, details (collapsible unless `open`). */
function ReviewCard({
  kind, title, subtitle, actions, resubmitted, college, open: startOpen = false, children,
}: {
  kind: string
  /** Shown to organization admins: which college it belongs to. */
  college?: string | null
  title: string
  subtitle: ReactNode
  actions: ReactNode
  /** The note from an earlier send-back, if this is a resubmission. */
  resubmitted?: string | null
  open?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(startOpen)
  return (
    <li>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{college ? `${college} · ` : ''}{kind}</p>
            <h4 className="font-semibold">{title}</h4>
            <p className="text-sm text-slate-600">{subtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!startOpen && (
              <Button variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Review'}</Button>
            )}
            {actions}
          </div>
        </div>
        {resubmitted && (
          <p className="mt-2 rounded-md bg-pop-50 px-3 py-1.5 text-xs text-pop-700">Resubmitted after your note: “{resubmitted}”</p>
        )}
        {open && <div className="mt-4 border-t border-slate-100 pt-4">{children}</div>}
      </Card>
    </li>
  )
}

function NoteForm({ decision, requester, onSubmit, busy }: { decision: 'send_back' | 'deny'; requester: string; onSubmit: (note: string) => void; busy: boolean }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const sendBack = decision === 'send_back'
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!note.trim()) return setError(sendBack ? 'Say what needs to change; the requester sees this note.' : 'Please give a short reason; the requester sees it.')
    onSubmit(note.trim())
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {sendBack && (
        <p className="text-sm text-slate-600">
          It goes back to the {requester} with your note. They can edit it and resubmit, and it comes back to this list.
        </p>
      )}
      {error && <Alert>{error}</Alert>}
      <Field label={sendBack ? 'What needs to change' : 'Reason'} required hint={`Shared with the ${requester}.`}>
        {(id) => <textarea id={id} rows={4} maxLength={2000} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <Button type="submit" variant={sendBack ? 'primary' : 'danger'} className="w-full" disabled={busy}>
        {busy ? 'Saving…' : sendBack ? 'Send back for changes' : 'Deny'}
      </Button>
    </form>
  )
}
