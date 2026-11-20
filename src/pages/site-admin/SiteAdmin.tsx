import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { PARTNER_CATEGORIES } from '../../lib/constants'
import { callFunction, supabase } from '../../lib/supabase'
import type { Department, University } from '../../lib/types'
import InviteResult, { type InviteResultData } from '../../components/InviteResult'
import { Alert, Button, Card, Field, inputClass, PageHeader, Spinner } from '../../components/ui'
import UniversityPicker from './UniversityPicker'

interface InviteRow {
  id: string; kind: 'org' | 'department'; email: string; created_at: string; expires_at: string; used_at: string | null; revoked_at: string | null
  universities: { name: string } | null; departments: { name: string } | null
}
interface OrgAdminRow { user_id: string; email: string; universities: { name: string } | null }
interface CollegeAdminRow { user_id: string; email: string; departments: { name: string; universities: { name: string } | null } | null }
interface ClubRow { user_id: string; name: string; email: string; universities: { name: string } | null; departments: { name: string } | null }
interface PartnerRow { user_id: string; name: string; email: string; category: string; city: string; state: string }

const date = (s: string) => new Date(s).toLocaleDateString()

function inviteStatus(i: InviteRow): string {
  if (i.used_at) return 'Accepted'
  if (i.revoked_at) return 'Replaced'
  if (new Date(i.expires_at) < new Date()) return 'Expired'
  return 'Pending'
}

export default function SiteAdmin() {
  const { session } = useAuth()
  const [data, setData] = useState<{
    invites: InviteRow[]; orgAdmins: OrgAdminRow[]; collegeAdmins: CollegeAdminRow[]; clubs: ClubRow[]; partners: PartnerRow[]
    active: Record<string, boolean>; participating: University[]
  } | null>(null)

  const load = useCallback(async () => {
    const [invites, orgAdmins, collegeAdmins, clubs, partners, profiles, unis] = await Promise.all([
      supabase.from('admin_invites').select('id, kind, email, created_at, expires_at, used_at, revoked_at, universities(name), departments(name)').order('created_at', { ascending: false }).limit(50),
      supabase.from('org_admins').select('user_id, email, universities(name)').order('created_at'),
      supabase.from('department_admins').select('user_id, email, departments(name, universities(name))').order('created_at'),
      supabase.from('clubs').select('user_id, name, email, universities(name), departments(name)').order('name'),
      supabase.from('partners').select('user_id, name, email, category, city, state').order('name'),
      supabase.from('profiles').select('user_id, is_active'),
      supabase.from('universities').select('*').eq('is_participating', true).order('name'),
    ])
    setData({
      invites: (invites.data ?? []) as unknown as InviteRow[],
      orgAdmins: (orgAdmins.data ?? []) as unknown as OrgAdminRow[],
      collegeAdmins: (collegeAdmins.data ?? []) as unknown as CollegeAdminRow[],
      clubs: (clubs.data ?? []) as unknown as ClubRow[],
      partners: (partners.data ?? []) as PartnerRow[],
      active: Object.fromEntries((profiles.data ?? []).map((p) => [p.user_id, p.is_active])),
      participating: (unis.data ?? []) as University[],
    })
  }, [])
  useEffect(() => { void load() }, [load])

  async function setActive(userId: string, isActive: boolean) {
    const { error } = await supabase.from('profiles').update({ is_active: isActive }).eq('user_id', userId)
    if (error) alert(error.message)
    await load()
  }

  if (!data) return <Spinner />
  const toggle = (userId: string) => (
    userId === session?.user.id ? <span className="text-xs text-slate-500">You</span> : (
      <ActiveToggle active={data.active[userId] ?? false} onChange={(v) => void setActive(userId, v)} />
    )
  )

  return (
    <>
      <PageHeader title="Site administration" subtitle="Invite university administrators and manage accounts." />
      <div className="space-y-6">
        <InviteForm onSent={() => void load()} />

        <Section title="Invites" count={data.invites.length}>
          <Table head={['For', 'Role', 'Email', 'Status', 'Sent', 'Expires']}
            rows={data.invites.map((i) => [
              i.departments ? `${i.departments.name} · ${i.universities?.name}` : i.universities?.name,
              i.kind === 'org' ? 'Organization admin' : 'College admin',
              i.email, inviteStatus(i), date(i.created_at), date(i.expires_at),
            ])} />
        </Section>

        <Section title="Participating universities" count={data.participating.length}>
          <Table head={['University', 'Location']}
            rows={data.participating.map((u) => [u.name, [u.city, u.state].filter(Boolean).join(', ')])} />
        </Section>

        <Section title="Organization administrators" count={data.orgAdmins.length}>
          <Table head={['University', 'Email', 'Active']}
            rows={data.orgAdmins.map((a) => [a.universities?.name, a.email, toggle(a.user_id)])} />
        </Section>

        <Section title="College administrators" count={data.collegeAdmins.length}>
          <Table head={['College', 'University', 'Email', 'Active']}
            rows={data.collegeAdmins.map((a) => [a.departments?.name, a.departments?.universities?.name, a.email, toggle(a.user_id)])} />
        </Section>

        <Section title="Clubs" count={data.clubs.length}>
          <Table head={['Club', 'College', 'University', 'Email', 'Active']}
            rows={data.clubs.map((c) => [c.name, c.departments?.name, c.universities?.name, c.email, toggle(c.user_id)])} />
        </Section>

        <Section title="Partners" count={data.partners.length}>
          <Table head={['Partner', 'Category', 'Location', 'Email', 'Active']}
            rows={data.partners.map((p) => [
              p.name, PARTNER_CATEGORIES.find((c) => c.value === p.category)?.label, `${p.city}, ${p.state}`, p.email, toggle(p.user_id),
            ])} />
        </Section>
      </div>
    </>
  )
}

function InviteForm({ onSent }: { onSent: () => void }) {
  const [kind, setKind] = useState<'org' | 'department'>('org')
  const [university, setUniversity] = useState<University | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [departmentId, setDepartmentId] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<InviteResultData | null>(null)

  useEffect(() => {
    setDepartmentId('')
    setDepartments([])
    if (!university) return
    supabase.from('departments').select('*').eq('university_id', university.id).order('name')
      .then(({ data }) => setDepartments((data as Department[]) ?? []))
  }, [university])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!university) return setError('Choose a university.')
    if (kind === 'department' && !departmentId) return setError('Choose a college.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email.')
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await callFunction<InviteResultData>('invite-university-admin', kind === 'org'
        ? { kind, university_id: university.id, email: email.trim() }
        : { kind, department_id: departmentId, email: email.trim() })
      setResult(res)
      setEmail('')
      onSent()
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  return (
    <Card>
      <h2 className="font-medium">Invite an administrator</h2>
      <p className="mt-1 text-sm text-slate-600">
        Verify the person's identity and role first. They'll get an email link (valid 7 days) to set a password.
        An <strong>organization admin</strong> runs a whole university: they add its colleges and invite each college's admins.
        A <strong>college admin</strong> approves that college's clubs' events and sponsorships.
      </p>
      <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="sr-only">Role</legend>
          {(['org', 'department'] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="radio" name="invite-kind" className="accent-accent-600" checked={kind === k} onChange={() => setKind(k)} />
              {k === 'org' ? 'Organization admin' : 'College admin'}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <UniversityPicker value={university} onChange={setUniversity} />
          {kind === 'department' ? (
            <Field label="College" required hint={university && departments.length === 0 ? 'This university has no colleges yet. Its organization admin adds them.' : undefined}>
              {(id) => (
                <select id={id} className={inputClass} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} disabled={!university}>
                  <option value="">{university ? 'Choose a college…' : 'Choose a university first'}</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
            </Field>
          ) : <span className="hidden md:block" />}
          <span className="hidden md:block" />
        </div>
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <Field label="Administrator email" required>
            {(id) => <input id={id} type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send invite'}</Button>
        </div>
      </form>
      {error && <Alert className="mt-4">{error}</Alert>}
      {result && <InviteResult result={result} />}
    </Card>
  )
}

function ActiveToggle({ active, onChange }: { active: boolean; onChange: (v: boolean) => void }) {
  return (
    <Button variant={active ? 'secondary' : 'danger'} className="px-2 py-1 text-xs"
      aria-label={active ? 'Active — click to deactivate' : 'Deactivated — click to reactivate'}
      onClick={() => {
        if (!active || confirm('Deactivate this account? They will lose access until reactivated.')) onChange(!active)
      }}>
      {active ? 'Active' : 'Deactivated'}
    </Button>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <Card>
      <h2 className="font-medium">{title} <span className="text-sm font-normal text-slate-500">({count})</span></h2>
      <div className="mt-3">{count === 0 ? <p className="text-sm text-slate-500">None yet.</p> : children}</div>
    </Card>
  )
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <tr>{head.map((h) => <th key={h} scope="col" className="py-2 pr-4 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className="py-2 pr-4 align-middle">{c ?? '—'}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
