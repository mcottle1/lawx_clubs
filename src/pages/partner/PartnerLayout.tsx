import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabase'
import type { Partner } from '../../lib/types'
import { Alert, Spinner } from '../../components/ui'
import { PartnerContext } from './PartnerContext'

const tabs = [
  { to: '/partner', label: 'Dashboard', end: true },
  { to: '/partner/proposals', label: 'Proposals', end: false },
  { to: '/partner/messages', label: 'Messages', end: false },
  { to: '/partner/profile', label: 'Profile', end: false },
]

export default function PartnerLayout() {
  const { session } = useAuth()
  const userId = session!.user.id
  const [partner, setPartner] = useState<Partner | null | undefined>(undefined)

  const load = useCallback(async () => {
    const { data } = await supabase.from('partners').select('*').eq('user_id', userId).maybeSingle()
    setPartner(data as Partner | null)
  }, [userId])
  useEffect(() => { void load() }, [load])

  if (partner === undefined) return <Spinner />
  if (partner === null) return <Alert>We couldn't find your partner profile.</Alert>

  return (
    <PartnerContext.Provider value={{ partner, userId, refreshPartner: load }}>
      <nav aria-label="Partner" className="-mt-4 mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 text-sm">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => 'whitespace-nowrap border-b-2 px-3 py-2 ' +
              (isActive ? 'border-accent-600 font-medium text-accent-700' : 'border-transparent text-slate-600 hover:text-slate-900')}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </PartnerContext.Provider>
  )
}
