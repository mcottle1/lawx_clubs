import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabase'
import { PageHeader } from '../../components/ui'

const tabs = [
  { to: '/university-admin', label: 'Approvals', end: true },
  { to: '/university-admin/receipts', label: 'Receipts', end: false },
  { to: '/university-admin/clubs', label: 'Clubs', end: false },
  { to: '/university-admin/settings', label: 'Settings', end: false },
]

export default function AdminLayout() {
  const { session } = useAuth()
  const [uni, setUni] = useState<string>('')
  useEffect(() => {
    supabase.from('university_admins').select('universities(name)').eq('user_id', session!.user.id).maybeSingle()
      .then(({ data }) => setUni((data as { universities: { name: string } | null } | null)?.universities?.name ?? ''))
  }, [session])
  return (
    <>
      <PageHeader title={uni || 'Your university'} subtitle="University club administrator" />
      <nav aria-label="Administrator" className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 text-sm max-sm:pr-8 max-sm:[mask-image:linear-gradient(to_right,black_80%,transparent)]">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => 'whitespace-nowrap border-b-2 px-3 py-2 ' +
              (isActive ? 'border-pop-500 font-semibold text-accent-800' : 'border-transparent text-slate-600 hover:border-accent-200 hover:text-accent-800')}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  )
}
