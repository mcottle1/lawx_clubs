import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabase'
import type { UniversityAdmin } from '../../lib/types'
import { Alert, Button, Card, Field, inputClass, Spinner } from '../../components/ui'

type AdminRow = UniversityAdmin & { universities: { name: string } | null }

/** University settings: what needs approval, plus room-scheduling info for clubs. */
export default function UniversityAdminHome() {
  const { session } = useAuth()
  const [row, setRow] = useState<AdminRow | null | undefined>(undefined)
  const [clubCount, setClubCount] = useState<number | null>(null)
  const [form, setForm] = useState({ contact_email: '', scheduling_url: '', scheduling_instructions: '' })
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  useEffect(() => {
    supabase.from('university_admins').select('*, universities(name)').eq('user_id', session!.user.id).maybeSingle()
      .then(({ data }) => {
        const r = data as AdminRow | null
        setRow(r)
        if (r) setForm({
          contact_email: r.contact_email,
          scheduling_url: r.scheduling_url ?? '',
          scheduling_instructions: r.scheduling_instructions ?? '',
        })
      })
    // RLS limits this count to the admin's own university.
    supabase.from('clubs').select('id', { count: 'exact', head: true }).then(({ count }) => setClubCount(count ?? 0))
  }, [session])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    const url = form.scheduling_url.trim()
    const instructions = form.scheduling_instructions.trim()
    if (!url && !instructions) return setMsg({ kind: 'error', text: 'Provide a scheduling link, instructions, or both.' })
    if (url && !/^https?:\/\/\S+/i.test(url)) return setMsg({ kind: 'error', text: 'The link must start with http:// or https://' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email.trim())) return setMsg({ kind: 'error', text: 'Enter a valid contact email.' })
    setBusy(true)
    const { error } = await supabase.from('university_admins').update({
      contact_email: form.contact_email.trim(),
      scheduling_url: url || null,
      scheduling_instructions: instructions || null,
    }).eq('id', row!.id)
    setBusy(false)
    setMsg(error ? { kind: 'error', text: error.message } : { kind: 'success', text: 'Saved.' })
  }

  if (row === undefined) return <Spinner />
  if (row === null) return <Alert>We couldn't find your administrator record.</Alert>

  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <h2 className="text-sm font-medium text-slate-600">Clubs registered</h2>
          <p className="mt-1 text-2xl font-semibold">{clubCount ?? '…'}</p>
        </Card>
        <Card className="md:col-span-2">
          <h2 className="font-medium">Room scheduling for clubs</h2>
          <p className="mt-1 text-sm text-slate-600">Clubs see this when an event still needs a location.</p>
          <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
            {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
            <Field label="Contact email">
              {(id) => <input id={id} type="email" className={inputClass} value={form.contact_email} onChange={set('contact_email')} />}
            </Field>
            <Field label="Scheduling system link">
              {(id) => <input id={id} type="url" placeholder="https://" className={inputClass} value={form.scheduling_url} onChange={set('scheduling_url')} />}
            </Field>
            <Field label="Scheduling instructions">
              {(id) => <textarea id={id} rows={4} maxLength={5000} className={inputClass} value={form.scheduling_instructions} onChange={set('scheduling_instructions')} />}
            </Field>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </form>
        </Card>
      </div>
      <ApprovalSettings row={row} onSaved={(r) => setRow({ ...row, ...r })} />
    </>
  )
}

type Toggle = 'require_message_approval' | 'require_opportunity_approval' | 'require_proposal_approval'
const TOGGLES: { key: Toggle; label: string; hint: string }[] = [
  {
    key: 'require_message_approval',
    label: 'A club’s first message to a partner',
    hint: 'The partner only receives it after you approve. Replies after that don’t need approval.',
  },
  {
    key: 'require_opportunity_approval',
    label: 'Sponsorship opportunities clubs post',
    hint: 'Partners only see a post after you approve it, and again after the club edits it.',
  },
  {
    key: 'require_proposal_approval',
    label: 'Partner proposals, before the club sees them',
    hint: 'You screen each proposal first. Accepted partnerships still come to you for final approval.',
  },
]

function ApprovalSettings({ row, onSaved }: { row: AdminRow; onSaved: (r: Pick<AdminRow, Toggle>) => void }) {
  const [values, setValues] = useState<Record<Toggle, boolean>>({
    require_message_approval: row.require_message_approval,
    require_opportunity_approval: row.require_opportunity_approval,
    require_proposal_approval: row.require_proposal_approval,
  })
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const changed = TOGGLES.some((t) => values[t.key] !== row[t.key])

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.from('university_admins').update(values).eq('id', row.id)
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: error.message })
    onSaved(values)
    setMsg({ kind: 'success', text: 'Approval settings saved. They apply to new submissions; anything already waiting stays in your queue.' })
  }

  return (
    <Card className="mt-4">
      <h2 className="font-medium">What needs your approval</h2>
      <p className="mt-1 text-sm text-slate-600">
        Events and final partnership agreements always need your approval. Choose what else does.
      </p>
      <form onSubmit={save} className="mt-4 space-y-3" noValidate>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        {TOGGLES.map((t) => (
          <label key={t.key} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
            <input
              type="checkbox"
              role="switch"
              className="mt-0.5 h-4 w-4 accent-accent-600"
              checked={values[t.key]}
              onChange={(e) => setValues({ ...values, [t.key]: e.target.checked })}
            />
            <span>
              <span className="font-medium">{t.label}</span>
              <span className="block text-xs text-slate-500">{t.hint}</span>
            </span>
          </label>
        ))}
        <Button type="submit" disabled={busy || !changed}>{busy ? 'Saving…' : 'Save approval settings'}</Button>
      </form>
    </Card>
  )
}
