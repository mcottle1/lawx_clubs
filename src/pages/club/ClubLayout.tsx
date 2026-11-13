import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabase'
import type { Club } from '../../lib/types'
import { Alert, Spinner } from '../../components/ui'
import { ClubContext, type ClubInfo } from './ClubContext'

const tabs = [
  { to: '/club', label: 'Dashboard', end: true },
  { to: '/club/events/new', label: 'New event', end: false },
  { to: '/club/partnerships', label: 'Partnerships', end: false },
  { to: '/club/messages', label: 'Messages', end: false },
  { to: '/club/files', label: 'Files', end: false },
  { to: '/club/settings', label: 'Settings', end: false },
]

/** Loads the signed-in club once and provides it to every club page. */
export default function ClubLayout() {
  const { session } = useAuth()
  const userId = session!.user.id
  const [info, setInfo] = useState<Omit<ClubInfo, 'refreshClub'> | null | undefined>(undefined)

  const load = useCallback(async () => {
    const { data } = await supabase.from('clubs').select('*, universities(name, city, state)').eq('user_id', userId).maybeSingle()
    if (!data) return setInfo(null)
    const { universities, ...club } = data as Club & { universities: { name: string; city: string | null; state: string | null } | null }
    const { data: admin } = await supabase
      .from('university_admins').select('scheduling_url, scheduling_instructions')
      .eq('university_id', club.university_id).maybeSingle()
    setInfo({
      club, universityName: universities?.name ?? '', universityCity: universities?.city ?? null,
      universityState: universities?.state ?? null, scheduling: admin ?? null, userId,
    })
  }, [userId])

  useEffect(() => { void load() }, [load])

  if (info === undefined) return <Spinner />
  if (info === null) return <Alert>We couldn't find your club record.</Alert>

  return (
    <ClubContext.Provider value={{ ...info, refreshClub: load }}>
      <nav aria-label="Club" className="-mt-4 mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 text-sm">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              'whitespace-nowrap border-b-2 px-3 py-2 ' +
              (isActive ? 'border-accent-600 font-medium text-accent-700' : 'border-transparent text-slate-600 hover:text-slate-900')
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </ClubContext.Provider>
  )
}
