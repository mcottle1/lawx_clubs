import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { Alert, PageHeader, Spinner } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import type { AdminRow, Department, UnitLabel } from '../../lib/types'
import { OrgContext, type OrgInfo, type PendingInvite } from './OrgContext'

/** /org-admin — the organization (university-level) administrator's area. */
export default function OrgLayout() {
  const { session } = useAuth()
  const [info, setInfo] = useState<Omit<OrgInfo, 'refresh'> | null | undefined>(undefined)

  const load = useCallback(async () => {
    const { data: me } = await supabase.from('org_admins')
      .select('university_id, universities(id, name, unit_label)').eq('user_id', session!.user.id).maybeSingle()
    const university = (me as { universities: { id: string; name: string; unit_label: UnitLabel } | null } | null)?.universities
    if (!university) return setInfo(null)
    const [depts, admins, clubs, invites] = await Promise.all([
      supabase.from('departments').select('*').eq('university_id', university.id).order('name'),
      supabase.from('department_admins').select('id, user_id, email, created_at, department_id').order('created_at'),
      supabase.from('clubs').select('department_id'),
      supabase.from('admin_invites').select('id, email, department_id, expires_at').eq('kind', 'department')
        .is('used_at', null).is('revoked_at', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }),
    ])
    const departments = (depts.data as Department[]) ?? []
    const byDept: Record<string, AdminRow[]> = {}
    for (const a of (admins.data ?? []) as (AdminRow & { department_id: string })[]) (byDept[a.department_id] ??= []).push(a)
    const clubCounts: Record<string, number> = {}
    for (const c of clubs.data ?? []) clubCounts[c.department_id] = (clubCounts[c.department_id] ?? 0) + 1
    setInfo({
      university, departments, admins: byDept, clubCounts,
      invites: (invites.data as PendingInvite[]) ?? [],
      actsFor: new Set(departments.filter((d) => !(byDept[d.id]?.length)).map((d) => d.id)),
    })
  }, [session])
  useEffect(() => { void load() }, [load])

  if (info === undefined) return <Spinner />
  if (info === null) return <Alert>We couldn't find your organization administrator record.</Alert>
  const unit = info.university.unit_label
  const tabs = [
    { to: '/org-admin', label: `${unit}s`, end: true },
    { to: '/org-admin/approvals', label: 'Approvals', end: false },
    { to: '/org-admin/calendar', label: 'Calendar', end: false },
    { to: '/org-admin/history', label: 'History', end: false },
    { to: '/org-admin/receipts', label: 'Receipts', end: false },
    { to: '/org-admin/clubs', label: 'Clubs', end: false },
    { to: '/org-admin/settings', label: 'Settings', end: false },
  ]

  return (
    <OrgContext.Provider value={{ ...info, refresh: load }}>
      <PageHeader title={info.university.name} subtitle="Organization administrator" />
      <nav aria-label="Organization" className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 text-sm max-sm:pr-8 max-sm:[mask-image:linear-gradient(to_right,black_80%,transparent)]">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => 'whitespace-nowrap border-b-2 px-3 py-2 ' +
              (isActive ? 'border-pop-500 font-semibold text-accent-800' : 'border-transparent text-slate-600 hover:border-accent-200 hover:text-accent-800')}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </OrgContext.Provider>
  )
}
