import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabase'
import type { AdminRow, DepartmentSettings, UnitLabel } from '../../lib/types'
import { Alert, Button, Card, Field, inputClass, Spinner } from '../../components/ui'
import ColorSettings from './ColorSettings'

type College = {
  department_id: string
  departments: { name: string; universities: { name: string; unit_label: UnitLabel } | null } | null
}

/** College settings: room-booking info, what needs approval, colors, co-admins. */
export default function UniversityAdminHome() {
  const { session } = useAuth()
  const [college, setCollege] = useState<College | null | undefined>(undefined)
  const [settings, setSettings] = useState<DepartmentSettings | null>(null)
  const [admins, setAdmins] = useState<AdminRow[]>([])
  const [clubCount, setClubCount] = useState<number | null>(null)
  const [form, setForm] = useState({ scheduling_url: '', scheduling_instructions: '' })
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('department_admins')
        .select('department_id, departments(name, universities(name, unit_label))').eq('user_id', session!.user.id).maybeSingle()
      const c = data as College | null
      setCollege(c)
      if (!c) return
      const [s, a] = await Promise.all([
        supabase.from('department_settings').select('*').eq('department_id', c.department_id).single(),
        supabase.from('department_admins').select('id, user_id, email, created_at').eq('department_id', c.department_id).order('created_at'),
      ])
      const st = s.data as DepartmentSettings | null
      setSettings(st)
      setAdmins((a.data as AdminRow[]) ?? [])
      if (st) setForm({ scheduling_url: st.scheduling_url ?? '', scheduling_instructions: st.scheduling_instructions ?? '' })
    })()
    // RLS limits this count to the admin's own college.
    supabase.from('clubs').select('id', { count: 'exact', head: true }).then(({ count }) => setClubCount(count ?? 0))
  }, [session])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    const url = form.scheduling_url.trim()
    const instructions = form.scheduling_instructions.trim()
    if (!url && !instructions) return setMsg({ kind: 'error', text: 'Provide a scheduling link, instructions, or both.' })
    if (url && !/^https?:\/\/\S+$/i.test(url)) return setMsg({ kind: 'error', text: 'The link must start with http:// or https://' })
    setBusy(true)
    const { error } = await supabase.from('department_settings').update({
      scheduling_url: url || null,
      scheduling_instructions: instructions || null,
    }).eq('department_id', college!.department_id)
    setBusy(false)
    setMsg(error ? { kind: 'error', text: error.message } : { kind: 'success', text: 'Saved.' })
  }

  if (college === undefined || (college && !settings)) return <Spinner />
  if (college === null || !settings) return <Alert>We couldn't find your administrator record.</Alert>
  const unit = college.departments?.universities?.unit_label ?? 'College'

  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <h2 className="text-sm font-medium text-slate-600">Clubs registered</h2>
            <p className="mt-1 text-2xl font-semibold">{clubCount ?? '…'}</p>
          </Card>
          <Card>
            <h2 className="text-sm font-medium text-slate-600">{unit} admins</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {admins.map((a) => (
                <li key={a.id} className="truncate">{a.email}{a.user_id === session!.user.id && <span className="text-slate-500"> (you)</span>}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">Approval emails go to every admin. Your university’s organization admin can add or remove admins.</p>
          </Card>
        </div>
        <Card className="md:col-span-2">
          <h2 className="font-medium">Room scheduling for clubs</h2>
          <p className="mt-1 text-sm text-slate-600">Clubs see this when an event still needs a location.</p>
          <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
            {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
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
      <ApprovalSettings row={settings} onSaved={(r) => setSettings({ ...settings, ...r })} />
      <ColorSettings scope="college" universityName={college.departments?.universities?.name ?? 'your university'} />
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

function ApprovalSettings({ row, onSaved }: { row: DepartmentSettings; onSaved: (r: Pick<DepartmentSettings, Toggle>) => void }) {
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
    const { error } = await supabase.from('department_settings').update(values).eq('department_id', row.department_id)
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
