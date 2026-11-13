import { useState, type FormEvent } from 'react'
import { countRoster } from '../../../lib/csv'
import { formatDay, todayIso } from '../../../lib/format'
import { MAX_UPLOAD_BYTES } from '../../../lib/constants'
import { supabase } from '../../../lib/supabase'
import type { MemberCount } from '../../../lib/types'
import Modal from '../../../components/Modal'
import { Alert, Button, Card, Field, inputClass } from '../../../components/ui'

export default function MembersCard({
  clubId,
  counts,
  onSaved,
}: {
  clubId: string
  counts: MemberCount[]
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const latest = counts[counts.length - 1]
  const previous = counts[counts.length - 2]
  const delta = latest && previous ? latest.count - previous.count : null

  return (
    <Card>
      <h2 className="text-sm font-medium text-slate-600">Members</h2>
      {latest ? (
        <>
          <p className="mt-1 text-2xl font-semibold">
            {latest.count}
            {delta !== null && delta !== 0 && (
              <span className={`ml-2 text-sm font-medium ${delta > 0 ? 'text-green-700' : 'text-red-700'}`}>
                {delta > 0 ? '+' : ''}{delta}
              </span>
            )}
          </p>
          <p className="text-xs text-slate-500">as of {formatDay(latest.recorded_on)}</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-slate-500">No member count yet.</p>
      )}
      <button type="button" onClick={() => setOpen(true)} className="mt-1 text-xs text-accent-700 hover:underline">
        Update member count
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Update member count">
        <UpdateMembersForm clubId={clubId} onDone={() => { setOpen(false); onSaved() }} />
      </Modal>
    </Card>
  )
}

function UpdateMembersForm({ clubId, onDone }: { clubId: string; onDone: () => void }) {
  const [mode, setMode] = useState<'manual' | 'roster'>('manual')
  const [count, setCount] = useState('')
  const [date, setDate] = useState(todayIso())
  const [rosterText, setRosterText] = useState<string | null>(null)
  const [hasHeader, setHasHeader] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const roster = rosterText !== null ? countRoster(rosterText, hasHeader ?? undefined) : null
  const value = mode === 'manual' ? Number(count) : roster?.count ?? NaN

  async function onFile(file: File | undefined) {
    setError(null)
    setRosterText(null)
    setHasHeader(null)
    if (!file) return
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') return setError('Please choose a .csv file.')
    if (file.size > MAX_UPLOAD_BYTES) return setError('Files must be 10 MB or smaller.')
    const text = await file.text()
    setRosterText(text)
    setHasHeader(countRoster(text).looksLikeHeader)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!Number.isInteger(value) || value < 0) return setError('Enter a whole number of members (0 or more).')
    if (!date || date > todayIso()) return setError('Choose today or an earlier date.')
    setBusy(true)
    const { error } = await supabase.from('club_member_counts').upsert(
      { club_id: clubId, count: value, recorded_on: date, source: mode },
      { onConflict: 'club_id,recorded_on' },
    )
    setBusy(false)
    if (error) return setError(error.message)
    onDone()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <fieldset className="flex gap-4 text-sm">
        <legend className="sr-only">How to update</legend>
        {(['manual', 'roster'] as const).map((m) => (
          <label key={m} className="flex items-center gap-2">
            <input type="radio" name="mode" className="accent-accent-600" checked={mode === m} onChange={() => { setMode(m); setError(null) }} />
            {m === 'manual' ? 'Enter a number' : 'Upload roster CSV'}
          </label>
        ))}
      </fieldset>
      {error && <Alert>{error}</Alert>}
      {mode === 'manual' ? (
        <Field label="Number of members" required>
          {(id) => <input id={id} type="number" min={0} step={1} inputMode="numeric" className={inputClass} value={count} onChange={(e) => setCount(e.target.value)} />}
        </Field>
      ) : (
        <>
          <Field label="Roster file (.csv)" required hint="One member per row. Export it from Google Sheets or Excel as CSV.">
            {(id) => <input id={id} type="file" accept=".csv,text/csv" className={inputClass} onChange={(e) => void onFile(e.target.files?.[0])} />}
          </Field>
          {roster && (
            <div className="rounded-md bg-slate-50 p-3 text-sm">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 accent-accent-600" checked={hasHeader ?? false} onChange={(e) => setHasHeader(e.target.checked)} />
                <span>
                  First row is a header
                  <span className="block truncate text-xs text-slate-500">First row: {roster.firstRow.join(', ') || '(empty)'}</span>
                </span>
              </label>
              <p className="mt-2 font-medium" role="status">Found {roster.count} member{roster.count === 1 ? '' : 's'}.</p>
            </div>
          )}
        </>
      )}
      <Field label="As of" hint="Entering a count for a date that already has one replaces it.">
        {(id) => <input id={id} type="date" max={todayIso()} className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />}
      </Field>
      <Button type="submit" disabled={busy || (mode === 'roster' && !roster)} className="w-full">
        {busy ? 'Saving…' : 'Save member count'}
      </Button>
    </form>
  )
}
