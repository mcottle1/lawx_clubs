import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import ProposalStatusBadge from '../../components/ProposalStatusBadge'
import ProposalTerms from '../../components/ProposalTerms'
import { Alert, Button, Card, PageHeader, Spinner } from '../../components/ui'
import { formatEventRange } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { ProposalDetail } from '../../lib/types'

export default function PartnerProposals() {
  const location = useLocation()
  const sent = (location.state as { sent?: boolean } | null)?.sent
  const [items, setItems] = useState<ProposalDetail[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('proposal_details').select('*').order('created_at', { ascending: false })
    setItems((data as ProposalDetail[]) ?? [])
  }, [])
  useEffect(() => { void load() }, [load])

  async function withdraw(p: ProposalDetail) {
    if (!confirm('Withdraw this proposal?')) return
    const { error } = await supabase.rpc('withdraw_proposal', { p_proposal_id: p.id })
    if (error) setError(error.message)
    await load()
  }

  if (!items) return <Spinner />
  return (
    <>
      <PageHeader title="Your proposals" subtitle="Each proposal goes to the club, then to their university for approval." />
      {sent && <Alert kind="success" className="mb-4">Proposal sent! The club has been notified.</Alert>}
      {error && <Alert className="mb-4">{error}</Alert>}
      {items.length === 0 ? (
        <Card><p className="text-sm text-slate-500">No proposals yet. <Link to="/partner" className="text-accent-700 hover:underline">Browse open opportunities</Link>.</p></Card>
      ) : (
        <ul className="space-y-3">
          {items.map((p) => (
            <li key={p.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{p.club_name} <span className="text-xs font-normal text-slate-500">· {p.university_name}</span></p>
                    <p className="text-xs text-slate-500">
                      {p.opportunity_title ?? p.event_name ?? 'General sponsorship'}
                      {p.event_starts_at && p.event_time_zone && ` · ${formatEventRange(p.event_starts_at, p.event_starts_at, p.event_time_zone).split(' · ')[0]}`}
                      {' · sent '}{new Date(p.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <ProposalStatusBadge status={p.status} />
                </div>
                <div className="mt-3"><ProposalTerms p={p} /></div>
                {p.status === 'denied' && p.denial_reason && <Alert className="mt-3">University's reason: {p.denial_reason}</Alert>}
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  {p.conversation_id && <Link to={`/partner/messages/${p.conversation_id}`} className="text-accent-700 hover:underline">Conversation</Link>}
                  {(p.status === 'pending_club' || p.status === 'pending_admin') && (
                    <Button variant="ghost" className="px-2 py-0.5" onClick={() => void withdraw(p)}>Withdraw</Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
