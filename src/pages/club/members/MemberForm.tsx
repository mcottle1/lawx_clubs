import { useState, type FormEvent } from 'react'
import { EMAIL_RE } from '../../../lib/roster'
import { supabase } from '../../../lib/supabase'
import type { ClubMember } from '../../../lib/types'
import { Alert, Button, Field, inputClass } from '../../../components/ui'

const ROLE_SUGGESTIONS = ['President', 'Vice President', 'Treasurer', 'Secretary', 'Events Chair', 'Social Media Chair']

/** Add a member, or edit one (name, email, leadership role). */
export default function MemberForm({
  clubId,
  member,
  roles,
  onDone,
}: {
  clubId: string
  member?: ClubMember
  /** Roles already used in this club, offered as suggestions. */
  roles: string[]
  onDone: (message: string) => void
}) {
  const [name, setName] = useState(member?.name ?? '')
  const [email, setEmail] = useState(member?.email ?? '')
  const [role, setRole] = useState(member?.role ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const suggestions = [...new Set([...roles, ...ROLE_SUGGESTIONS])]

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    const em = email.trim()
    const r = role.trim().replace(/\s+/g, ' ')
    if (!n) return setError('Enter the member’s name.')
    if (!EMAIL_RE.test(em)) return setError('Enter a valid email address.')
    if (r.length > 80) return setError('Keep the role under 80 characters.')
    setBusy(true)
    setError(null)
    const row = { name: n, email: em, role: r || null }
    const { error } = member
      ? await supabase.from('club_members').update(row).eq('id', member.id)
      : await supabase.from('club_members').insert({ ...row, club_id: clubId })
    setBusy(false)
    if (error) {
      return setError(error.code === '23505' ? 'Someone with that email is already on your member list.' : error.message)
    }
    onDone(member ? `Saved ${n}.` : `Added ${n}.`)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <Field label="Name" required>
        {(id) => <input id={id} className={inputClass} value={name} maxLength={200} autoComplete="off" onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label="Email" required>
        {(id) => <input id={id} type="email" className={inputClass} value={email} maxLength={320} autoComplete="off" onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <Field label="Leadership role" hint="Type any title your club uses, like “President” or “3L Representative”. Leave blank for a regular member.">
        {(id) => (
          <>
            <input id={id} list={`${id}-roles`} className={inputClass} value={role} maxLength={80} autoComplete="off" placeholder="None" onChange={(e) => setRole(e.target.value)} />
            <datalist id={`${id}-roles`}>
              {suggestions.map((s) => <option key={s} value={s} />)}
            </datalist>
          </>
        )}
      </Field>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Saving…' : member ? 'Save changes' : 'Add member'}
      </Button>
    </form>
  )
}
