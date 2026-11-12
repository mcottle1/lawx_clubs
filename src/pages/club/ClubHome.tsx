import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabase'
import type { Club } from '../../lib/types'
import { Alert, Card, PageHeader, Spinner } from '../../components/ui'

type ClubRow = Club & { universities: { name: string } | null }

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** Phase 1 placeholder; the full club dashboard arrives in Phase 2. */
export default function ClubHome() {
  const { session } = useAuth()
  const [club, setClub] = useState<ClubRow | null | undefined>(undefined)

  useEffect(() => {
    supabase.from('clubs').select('*, universities(name)').eq('user_id', session!.user.id).maybeSingle()
      .then(({ data }) => setClub(data as ClubRow | null))
  }, [session])

  if (club === undefined) return <Spinner />
  if (club === null) return <Alert>We couldn't find your club record.</Alert>

  return (
    <>
      <PageHeader title={club.name} subtitle={club.universities?.name} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="text-sm font-medium text-slate-600">Annual budget</h2>
          <p className="mt-1 text-2xl font-semibold">{usd.format(Number(club.initial_budget))}</p>
        </Card>
        <Card>
          <h2 className="text-sm font-medium text-slate-600">About</h2>
          <p className="mt-1 text-sm text-slate-700">{club.description || 'No description yet.'}</p>
        </Card>
      </div>
      <Alert kind="info" className="mt-6">
        Your full dashboard (events, calendar, files, members, to-dos) is coming in the next phase.
      </Alert>
    </>
  )
}
