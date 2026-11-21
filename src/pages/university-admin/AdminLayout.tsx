import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabase'
import { PageHeader } from '../../components/ui'

const tabs = [
  { to: '/university-admin', label: 'Approvals', end: true },
  { to: '/university-admin/calendar', label: 'Calendar', end: false },
  { to: '/university-admin/history', label: 'History', end: false },
  { to: '/university-admin/receipts', label: 'Receipts', end: false },
  { to: '/university-admin/clubs', label: 'Clubs', end: false },
  { to: '/university-admin/settings', label: 'Settings', end: false },
]

export default function AdminLayout() {
  const { session } = useAuth()
  const [where, setWhere] = useState<{ college: string; university: string; unit: string } | null>(null)
  useEffect(() => {
    supabase.from('department_admins').select('departments(name, universities(name, unit_label))').eq('user_id', session!.user.id).maybeSingle()
      .then(({ data }) => {
        const d = (data as { departments: { name: string; universities: { name: string; unit_label: string } | null } | null } | null)?.departments
        if (d) setWhere({ college: d.name, university: d.universities?.name ?? '', unit: d.universities?.unit_label ?? 'College' })
      })
  }, [session])
  return (
    <>
      <PageHeader
        title={where?.college ?? 'Your college'}
        subtitle={where ? `${where.college !== where.university ? `${where.university} · ` : ''}${where.unit} club administrator` : 'Club administrator'}
      />
      <nav aria-label="Administrator" className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 text-sm max-sm:pr-8 max-sm:[mask-image:linear-gradient(to_right,black_80%,transparent)]">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => 'whitespace-nowrap border-b-2 px-3 py-2 ' +
              (isActive ? 'border-pop-500 font-semibold text-accent-800' : 'border-transparent text-slate-600 hover:border-accent-200 hover:text-accent-800')}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={where} />
    </>
  )
}
