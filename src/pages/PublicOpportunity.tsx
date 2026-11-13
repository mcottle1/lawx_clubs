import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import OpportunityCardView from '../components/OpportunityCardView'
import { Alert, ButtonLink, Card, Spinner } from '../components/ui'
import { supabase } from '../lib/supabase'
import type { OpportunityCard } from '../lib/types'

/** /o/:id — public share link for an open opportunity (works logged out). */
export default function PublicOpportunity() {
  const { id } = useParams()
  const { profile } = useAuth()
  const [o, setO] = useState<OpportunityCard | null | undefined>(undefined)

  useEffect(() => {
    supabase.rpc('get_public_opportunity', { p_id: id }).then(({ data }) => setO((data as OpportunityCard | null) ?? null))
  }, [id])

  if (o === undefined) return <Spinner />
  if (o === null) return <Alert kind="warning">This sponsorship opportunity is no longer open.</Alert>

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <p className="text-sm font-medium uppercase tracking-wide text-accent-700">Sponsorship opportunity</p>
      <h1 className="text-2xl font-semibold">{o.title}</h1>
      <OpportunityCardView o={o} full />
      <Card className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-700">Interested in sponsoring {o.club_name}?</p>
        {profile?.role === 'partner' ? (
          <ButtonLink to={`/partner/opportunities/${o.id}`}>Respond to this opportunity</ButtonLink>
        ) : (
          <div className="flex gap-2">
            <ButtonLink to="/signup/partner">Sign up as a partner</ButtonLink>
            <ButtonLink to="/login" state={{ from: `/partner/opportunities/${o.id}` }} variant="secondary">Log in</ButtonLink>
          </div>
        )}
      </Card>
    </div>
  )
}
