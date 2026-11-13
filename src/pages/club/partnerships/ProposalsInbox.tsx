import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ProposalStatusBadge from '../../../components/ProposalStatusBadge'
import ProposalTerms from '../../../components/ProposalTerms'
import { Alert, Button, Card } from '../../../components/ui'
import { categoryLabel } from '../../../lib/constants'
import { notify } from '../../../lib/notify'
import { logoUrl } from '../../../lib/storage'
import { supabase } from '../../../lib/supabase'
import type { ProposalDetail } from '../../../lib/types'

export default function ProposalsInbox() {
  const [items, setItems] = useState<ProposalDetail[] | null>(null)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('proposal_details').select('*').order('created_at', { ascending: false })
    setItems((data as ProposalDetail[]) ?? [])
  }, [])
  useEffect(() => { void load() }, [load])

  async function respond(p: ProposalDetail, accept: boolean) {
    if (!accept && !confirm(`Decline ${p.partner_name}'s proposal?`)) return
    setBusy(p.id)
    const { error } = await supabase.rpc('respond_to_proposal', { p_proposal_id: p.id, p_accept: accept })
    setBusy(null)
    if (error) return setMsg({ kind: 'error', text: error.message })
    notify('proposal_responded', p.id)
    setMsg({ kind: 'success', text: accept
      ? `Accepted. ${p.partner_name} is now listed as the sponsor${p.event_name ? ` of ${p.event_name}` : ''}, pending your university's approval.`
      : 'Proposal declined.' })
    await load()
  }

  if (!items) return <p className="text-sm text-slate-500">Loading…</p>
  const waiting = items.filter((p) => p.status === 'pending_club')
  const rest = items.filter((p) => p.status !== 'pending_club')

  const card = (p: ProposalDetail) => {
    const logo = logoUrl(p.partner_logo_path)
    return (
      <li key={p.id}>
        <Card>
          <div className="flex flex-wrap items-start gap-3">
            {logo && <img src={logo} alt="" className="h-10 w-10 rounded object-cover" />}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{p.partner_name} <span className="text-xs font-normal text-slate-500">({categoryLabel(p.partner_category)})</span></p>
              <p className="text-xs text-slate-500">
                For {p.opportunity_title ? `“${p.opportunity_title}”` : p.event_name ? `“${p.event_name}”` : 'your club'}
                {p.event_name && p.opportunity_title && ` · event: ${p.event_name}`} · {new Date(p.created_at).toLocaleDateString()}
              </p>
            </div>
            <ProposalStatusBadge status={p.status} />
          </div>
          <div className="mt-3"><ProposalTerms p={p} /></div>
          {p.status === 'denied' && p.denial_reason && <Alert className="mt-3">University's reason: {p.denial_reason}</Alert>}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {p.status === 'pending_club' && (
              <>
                <Button disabled={busy === p.id} onClick={() => void respond(p, true)}>Accept</Button>
                <Button variant="secondary" disabled={busy === p.id} onClick={() => void respond(p, false)}>Decline</Button>
              </>
            )}
            {p.conversation_id && <Link to={`/club/messages/${p.conversation_id}`} className="text-accent-700 hover:underline">Open conversation</Link>}
          </div>
        </Card>
      </li>
    )
  }

  return (
    <>
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      <h2 className="mb-2 font-medium">Needs your response ({waiting.length})</h2>
      {waiting.length === 0 ? <p className="mb-6 text-sm text-slate-500">No proposals waiting.</p> : <ul className="mb-6 space-y-3">{waiting.map(card)}</ul>}
      {rest.length > 0 && (
        <>
          <h2 className="mb-2 font-medium">Earlier proposals</h2>
          <ul className="space-y-3">{rest.map(card)}</ul>
        </>
      )}
    </>
  )
}
