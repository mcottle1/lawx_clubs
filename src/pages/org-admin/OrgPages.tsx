import { useState, type FormEvent } from 'react'
import { Alert, Button, Card, Field, inputClass } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import type { UnitLabel } from '../../lib/types'
import AdminCalendar from '../university-admin/AdminCalendar'
import AdminEventDetail from '../university-admin/AdminEventDetail'
import Approvals from '../university-admin/Approvals'
import EventHistory from '../university-admin/EventHistory'
import ClubsOverview from '../university-admin/ClubsOverview'
import ColorSettings from '../university-admin/ColorSettings'
import ReceiptsQueue from '../university-admin/ReceiptsQueue'
import { useOrg } from './OrgContext'

/** Every college's approvals; the organization admin decides only where a college has no admin. */
export function OrgApprovals() {
  const { actsFor } = useOrg()
  return (
    <>
      <p className="mb-4 text-sm text-slate-600">
        Everything waiting at your university. Each {useOrg().university.unit_label.toLowerCase()}’s admins decide their own; you decide for any without an admin.
      </p>
      <Approvals oversight={{ actsFor }} />
    </>
  )
}

export function OrgCalendar() {
  const { university } = useOrg()
  return <AdminCalendar base="/org-admin" orgName={university.name} />
}

export function OrgHistory() {
  const { actsFor } = useOrg()
  return <EventHistory base="/org-admin" oversight={{ actsFor }} />
}

export function OrgEventDetail() {
  const { actsFor } = useOrg()
  return <AdminEventDetail base="/org-admin" oversight={{ actsFor }} />
}

export function OrgReceipts() {
  const { actsFor } = useOrg()
  return <ReceiptsQueue oversight={{ actsFor }} />
}

export function OrgClubs() {
  const { departments, refresh } = useOrg()
  return <ClubsOverview departments={departments} key={departments.length} onMoved={() => void refresh()} />
}

const UNITS: UnitLabel[] = ['College', 'School', 'Department']

export function OrgSettings() {
  const org = useOrg()
  const [unit, setUnit] = useState<UnitLabel>(org.university.unit_label)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.rpc('update_organization', { p_unit_label: unit })
    if (error) return setMsg({ kind: 'error', text: error.message })
    setMsg({ kind: 'success', text: 'Saved.' })
    await org.refresh()
  }

  return (
    <>
      <Card>
        <h2 className="font-medium">What do you call your units?</h2>
        <p className="mt-1 text-sm text-slate-600">Clubs see this word when they sign up, e.g. “Choose your college”.</p>
        <form onSubmit={save} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end" noValidate>
          <Field label="Name for units">
            {(id) => (
              <select id={id} className={inputClass.replace('w-full', 'w-48')} value={unit} onChange={(e) => setUnit(e.target.value as UnitLabel)}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            )}
          </Field>
          <Button type="submit" disabled={unit === org.university.unit_label}>Save</Button>
        </form>
        {msg && <Alert kind={msg.kind} className="mt-3">{msg.text}</Alert>}
      </Card>
      <ColorSettings scope="organization" universityName={org.university.name} />
    </>
  )
}
