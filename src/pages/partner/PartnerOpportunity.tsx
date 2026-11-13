import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Modal from '../../components/Modal'
import OpportunityCardView from '../../components/OpportunityCardView'
import ProposalForm from '../../components/ProposalForm'
import ProposalStatusBadge from '../../components/ProposalStatusBadge'
import { Alert, Button, Card, Field, inputClass, PageHeader, Spinner } from '../../components/ui'
import { notify } from '../../lib/notify'
import { supabase } from '../../lib/supabase'
import type { OpportunityCard, ProposalDetail } from '../../lib/types'

/** /partner/opportunities/:id — details, respond with a proposal, or ask a question. */
export default function PartnerOpportunity() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [o, setO] = useState<OpportunityCard | null | undefined>(undefined)
  const [mine, setMine] = useState<ProposalDetail[]>([])
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    supabase.from('opportunity_cards').select('*').eq('id', id!).maybeSingle().then(({ data }) => setO(data as OpportunityCard | null))
    supabase.from('proposal_details').select('*').eq('opportunity_id', id!).order('created_at', { ascending: false })
      .then(({ data }) => setMine((data as ProposalDetail[]) ?? []))
  }, [id])

  if (o === undefined) return <Spinner />
  if (o === null) return <Alert>This opportunity isn't available (it may have been filled or closed).</Alert>
  const active = mine.find((p) => p.status === 'pending_club' || p.status === 'pending_admin' || p.status === 'approved')

  return (
    <>
      <PageHeader title={o.title} subtitle={`${o.club_name} · ${o.university_name}`} actions={<Button variant="secondary" onClick={() => setAsking(true)}>Ask a question</Button>} />
      <div className="space-y-4">
        <OpportunityCardView o={o} full />
        <Card>
          <h2 className="font-medium">Respond with a proposal</h2>
          {active ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              You've sent a proposal <ProposalStatusBadge status={active.status} />
              <Link to="/partner/proposals" className="text-accent-700 hover:underline">View your proposals</Link>
            </div>
          ) : o.status !== 'open' ? (
            <p className="mt-2 text-sm text-slate-500">This opportunity is no longer open.</p>
          ) : (
            <div className="mt-3">
              <p className="mb-3 text-sm text-slate-600">Tell the club what you're willing to provide. They'll accept or decline, then their university approves it.</p>
              <ProposalForm opportunityId={o.id} onDone={() => navigate('/partner/proposals', { state: { sent: true } })} />
            </div>
          )}
        </Card>
      </div>
      <Modal open={asking} onClose={() => setAsking(false)} title={`Message ${o.club_name}`}>
        <AskForm opportunityId={o.id} />
      </Modal>
    </>
  )
}

function AskForm({ opportunityId }: { opportunityId: string }) {
  const navigate = useNavigate()
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return setError('Write a message.')
    setBusy(true)
    const { data, error } = await supabase.rpc('start_conversation', { p_opportunity_id: opportunityId, p_body: body.trim() })
    setBusy(false)
    if (error) return setError(error.message)
    notify('message', data as string)
    navigate(`/partner/messages/${data}`)
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <Field label="Message" required>
        {(id) => <textarea id={id} rows={5} maxLength={5000} className={inputClass} value={body} onChange={(e) => setBody(e.target.value)} />}
      </Field>
      <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Sending…' : 'Send'}</Button>
    </form>
  )
}
