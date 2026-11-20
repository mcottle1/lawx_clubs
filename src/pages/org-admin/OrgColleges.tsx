import { useState, type FormEvent } from 'react'
import InviteResult, { type InviteResultData } from '../../components/InviteResult'
import { Alert, Button, Card, Field, inputClass } from '../../components/ui'
import { callFunction, supabase } from '../../lib/supabase'
import type { AdminRow, Department } from '../../lib/types'
import { useOrg } from './OrgContext'

/** /org-admin — the university's colleges, their admins and pending invites. */
export default function OrgColleges() {
  const org = useOrg()
  const unit = org.university.unit_label
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setMsg({ kind: 'error', text: `Enter the ${unit.toLowerCase()}'s name.` })
    setBusy(true)
    const { error } = await supabase.from('departments').insert({ university_id: org.university.id, name: name.trim() })
    setBusy(false)
    if (error) {
      return setMsg({ kind: 'error', text: error.code === '23505' ? `There's already a ${unit.toLowerCase()} with that name.` : error.message })
    }
    setMsg({ kind: 'success', text: `Added ${name.trim()}. Invite its admin next; clubs can choose it once an admin has joined.` })
    setName('')
    await org.refresh()
  }

  const noAdmin = org.departments.filter((d) => org.actsFor.has(d.id))

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-medium">Add a {unit.toLowerCase()}</h2>
        <p className="mt-1 text-sm text-slate-600">
          Each {unit.toLowerCase()} manages its own clubs with its own admins. Clubs choose their {unit.toLowerCase()} when they sign up.
        </p>
        <form onSubmit={add} className="mt-3 flex flex-col gap-2 sm:flex-row" noValidate>
          <label htmlFor="new-college" className="sr-only">{unit} name</label>
          <input id="new-college" className={inputClass} maxLength={200} placeholder={unit === 'College' ? 'e.g. J. Reuben Clark Law School' : `${unit} name`}
            value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={busy}>{busy ? 'Adding…' : `Add ${unit.toLowerCase()}`}</Button>
        </form>
        {msg && <Alert kind={msg.kind} className="mt-3">{msg.text}</Alert>}
      </Card>

      {noAdmin.length > 0 && (
        <Alert kind="info">
          {noAdmin.length === 1 ? `1 ${unit.toLowerCase()} has` : `${noAdmin.length} ${unit.toLowerCase()}s have`} no admin yet.
          {' '}New clubs can't join {noAdmin.length === 1 ? 'it' : 'them'} until one does; for any clubs already there, you approve their requests yourself.
        </Alert>
      )}

      {org.departments.length === 0 ? (
        <Card><p className="text-sm text-slate-600">No {unit.toLowerCase()}s yet. Add your first one above.</p></Card>
      ) : (
        <ul className="space-y-3">
          {org.departments.map((d) => (
            <li key={d.id}><CollegeCard department={d} /></li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CollegeCard({ department: d }: { department: Department }) {
  const org = useOrg()
  const unit = org.university.unit_label.toLowerCase()
  const admins = org.admins[d.id] ?? []
  const invites = org.invites.filter((i) => i.department_id === d.id)
  const clubs = org.clubCounts[d.id] ?? 0
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(d.name)
  const [email, setEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [result, setResult] = useState<InviteResultData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function rename(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    const { error } = await supabase.from('departments').update({ name: newName.trim() }).eq('id', d.id)
    if (error) return setError(error.code === '23505' ? `There's already a ${unit} with that name.` : error.message)
    setRenaming(false)
    await org.refresh()
  }

  async function invite(e: FormEvent) {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email.')
    setBusy(true)
    setError(null)
    try {
      const res = await callFunction<InviteResultData>('invite-university-admin', { kind: 'department', department_id: d.id, email: email.trim() })
      setResult(res)
      setEmail('')
      await org.refresh()
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  async function removeAdmin(a: AdminRow) {
    if (!confirm(`Remove ${a.email} as an admin of ${d.name}? Their account will be deactivated.`)) return
    const { error } = await supabase.rpc('remove_department_admin', { p_user_id: a.user_id })
    if (error) return setError(error.message)
    await org.refresh()
  }

  async function remove() {
    if (!confirm(`Remove ${d.name}?`)) return
    const { error } = await supabase.from('departments').delete().eq('id', d.id)
    if (error) return setError(`Couldn't remove it: ${error.message}`)
    await org.refresh()
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {renaming ? (
            <form onSubmit={rename} className="flex flex-wrap gap-2">
              <label htmlFor={`rename-${d.id}`} className="sr-only">New name</label>
              <input id={`rename-${d.id}`} className={inputClass.replace('w-full', 'w-64')} maxLength={200} value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Button type="submit" className="px-3 py-1">Save</Button>
              <Button variant="ghost" className="px-3 py-1" onClick={() => { setRenaming(false); setNewName(d.name) }}>Cancel</Button>
            </form>
          ) : (
            <h3 className="font-semibold">{d.name}</h3>
          )}
          <p className="text-sm text-slate-600">
            {clubs} club{clubs === 1 ? '' : 's'} ·{' '}
            {admins.length ? `${admins.length} admin${admins.length === 1 ? '' : 's'}` : <span className="font-medium text-amber-800">No admin yet: you approve for it</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!renaming && <Button variant="ghost" className="px-3 py-1" onClick={() => setRenaming(true)}>Rename</Button>}
          {!inviting && <Button variant="secondary" className="px-3 py-1" onClick={() => setInviting(true)}>Invite admin</Button>}
          {clubs === 0 && admins.length === 0 && <Button variant="ghost" className="px-3 py-1 text-red-700 hover:bg-red-50" onClick={() => void remove()}>Remove</Button>}
        </div>
      </div>

      {(admins.length > 0 || invites.length > 0) && (
        <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100 text-sm">
          {admins.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate">{a.email}</span>
              <Button variant="ghost" className="px-2 py-0.5 text-xs text-red-700 hover:bg-red-50" onClick={() => void removeAdmin(a)} aria-label={`Remove ${a.email}`}>Remove</Button>
            </li>
          ))}
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-slate-600">
              <span className="min-w-0 truncate">{i.email}</span>
              <span className="text-xs">Invited · link expires {new Date(i.expires_at).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      )}

      {inviting && (
        <form onSubmit={invite} className="mt-3 border-t border-slate-100 pt-3" noValidate>
          <Field label={`Invite an admin for ${d.name}`} hint="They get an email link (valid 7 days) to set a password. A college can have several admins.">
            {(id) => (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input id={id} type="email" className={inputClass} placeholder="name@university.edu" value={email} onChange={(e) => setEmail(e.target.value)} />
                <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send invite'}</Button>
                <Button variant="ghost" onClick={() => { setInviting(false); setResult(null) }}>Done</Button>
              </div>
            )}
          </Field>
        </form>
      )}
      {error && <Alert className="mt-3">{error}</Alert>}
      {result && <InviteResult result={result} />}
    </Card>
  )
}
