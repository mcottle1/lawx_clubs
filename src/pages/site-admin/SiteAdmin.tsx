import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { PARTNER_CATEGORIES } from '../../lib/constants'
import { callFunction, supabase } from '../../lib/supabase'
import type { University } from '../../lib/types'
import { Alert, Button, Card, Field, inputClass, PageHeader, Spinner } from '../../components/ui'
import UniversityPicker from './UniversityPicker'

interface InviteResult { link: string; email_status: 'sent' | 'skipped' | 'failed' }
interface InviteRow { id: string; email: string; created_at: string; expires_at: string; used_at: string | null; revoked_at: string | null; universities: { name: string } | null }
interface AdminRow { user_id: string; contact_email: string; universities: { name: string } | null }
interface ClubRow { user_id: string; name: string; email: string; universities: { name: string } | null }
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
    invites: InviteRow[]; admins: AdminRow[]; clubs: ClubRow[]; partners: PartnerRow[]
    active: Record<string, boolean>; participating: University[]
  } | null>(null)

  const load = useCallback(async () => {
    const [invites, admins, clubs, partners, profiles, unis] = await Promise.all([
      supabase.from('admin_invites').select('id, email, created_at, expires_at, used_at, revoked_at, universities(name)').order('created_at', { ascending: false }).limit(50),
      supabase.from('university_admins').select('user_id, contact_email, universities(name)').order('created_at'),
      supabase.from('clubs').select('user_id, name, email, universities(name)').order('name'),
      supabase.from('partners').select('user_id, name, email, category, city, state').order('name'),
      supabase.from('profiles').select('user_id, is_active'),
      supabase.from('universities').select('*').eq('is_participating', true).order('name'),
    ])
    setData({
      invites: (invites.data ?? []) as unknown as InviteRow[],
      admins: (admins.data ?? []) as unknown as AdminRow[],
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
          <Table head={['University', 'Email', 'Status', 'Sent', 'Expires']}
            rows={data.invites.map((i) => [i.universities?.name, i.email, inviteStatus(i), date(i.created_at), date(i.expires_at)])} />
        </Section>

        <Section title="Participating universities" count={data.participating.length}>
          <Table head={['University', 'Location']}
            rows={data.participating.map((u) => [u.name, [u.city, u.state].filter(Boolean).join(', ')])} />
        </Section>

        <Section title="University administrators" count={data.admins.length}>
          <Table head={['University', 'Contact email', 'Active']}
            rows={data.admins.map((a) => [a.universities?.name, a.contact_email, toggle(a.user_id)])} />
        </Section>

        <Section title="Clubs" count={data.clubs.length}>
          <Table head={['Club', 'University', 'Email', 'Active']}
            rows={data.clubs.map((c) => [c.name, c.universities?.name, c.email, toggle(c.user_id)])} />
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
  const [university, setUniversity] = useState<University | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<InviteResult | null>(null)
  const [copied, setCopied] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!university) return setError('Choose a university.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email.')
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await callFunction<InviteResult>('invite-university-admin', { university_id: university.id, email: email.trim() })
      setResult(res)
      setCopied(false)
      setUniversity(null)
      setEmail('')
      onSent()
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  return (
    <Card>
      <h2 className="font-medium">Invite a university administrator</h2>
      <p className="mt-1 text-sm text-slate-600">
        Verify the person's identity and role first. They'll get an email link (valid 7 days) to set a password.
        Sending a new invite replaces any pending one for that university.
      </p>
      <form onSubmit={onSubmit} className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end" noValidate>
        <UniversityPicker value={university} onChange={setUniversity} />
        <Field label="Administrator email" required>
          {(id) => <input id={id} type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send invite'}</Button>
      </form>
      {error && <Alert className="mt-4">{error}</Alert>}
      {result && (
        <Alert kind={result.email_status === 'sent' ? 'success' : 'warning'} className="mt-4">
          <p>
            {result.email_status === 'sent' && 'Invite email sent. '}
            {result.email_status === 'skipped' && 'Invite created, but email is not configured (RESEND_API_KEY missing) — share this link yourself. '}
            {result.email_status === 'failed' && 'Invite created, but the email failed to send — share this link yourself. '}
            The link is only shown once:
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input readOnly aria-label="Invite link" className={inputClass + ' font-mono text-xs'} value={result.link} onFocus={(e) => e.target.select()} />
            <Button variant="secondary" onClick={() => { void navigator.clipboard.writeText(result.link); setCopied(true) }}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </Alert>
      )}
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
