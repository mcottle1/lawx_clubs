import { useMemo, useState } from 'react'
import { MAX_UPLOAD_BYTES } from '../../../lib/constants'
import { diffRoster, parseRoster, type ParsedRoster } from '../../../lib/roster'
import { supabase } from '../../../lib/supabase'
import type { ClubMember } from '../../../lib/types'
import { Alert, Button, Field, inputClass } from '../../../components/ui'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Upload a roster CSV (names + emails), preview the changes, then apply them. */
export default function ImportRoster({
  clubId,
  members,
  countFollowsList,
  onDone,
}: {
  clubId: string
  members: ClubMember[]
  /** Whether the dashboard member count already follows this list. */
  countFollowsList: boolean
  onDone: (message: string) => void
}) {
  const [parsed, setParsed] = useState<ParsedRoster | null>(null)
  const [fileName, setFileName] = useState('')
  const [importRoles, setImportRoles] = useState(true)
  const [removeMissing, setRemoveMissing] = useState(false)
  const [useForCount, setUseForCount] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const diff = useMemo(
    () => (parsed ? diffRoster(members, parsed.members, importRoles && parsed.hasRoleColumn) : null),
    [parsed, members, importRoles],
  )

  async function onFile(file: File | undefined) {
    setError(null)
    setParsed(null)
    if (!file) return
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') return setError('Please choose a .csv file.')
    if (file.size > MAX_UPLOAD_BYTES) return setError('Files must be 10 MB or smaller.')
    setFileName(file.name)
    setParsed(parseRoster(await file.text()))
  }

  async function apply() {
    if (!diff) return
    setBusy(true)
    setError(null)
    try {
      if (diff.toAdd.length) {
        for (let i = 0; i < diff.toAdd.length; i += 500) {
          const rows = diff.toAdd.slice(i, i + 500).map((m) => ({ club_id: clubId, name: m.name, email: m.email, role: m.role }))
          const { error } = await supabase.from('club_members').insert(rows)
          if (error) throw new Error(error.message)
        }
      }
      for (const u of diff.toUpdate) {
        const { error } = await supabase.from('club_members').update({ name: u.name, role: u.role }).eq('id', u.id)
        if (error) throw new Error(error.message)
      }
      if (removeMissing && diff.notInFile.length) {
        const { error } = await supabase.from('club_members').delete().in('id', diff.notInFile.map((m) => m.id))
        if (error) throw new Error(error.message)
      }
      if (useForCount && !countFollowsList) {
        const { error } = await supabase.rpc('use_member_list_for_count')
        if (error) throw new Error(error.message)
      }
      const parts = [
        diff.toAdd.length && `added ${plural(diff.toAdd.length, 'member')}`,
        diff.toUpdate.length && `updated ${diff.toUpdate.length}`,
        removeMissing && diff.notInFile.length && `removed ${diff.notInFile.length}`,
      ].filter(Boolean)
      onDone(parts.length ? `Roster imported: ${parts.join(', ')}.` : 'Roster imported: no changes needed.')
    } catch (e) {
      setError(`${(e as Error).message} Some changes may have been saved; re-importing the same file is safe.`)
    } finally {
      setBusy(false)
    }
  }

  const changes = diff ? diff.toAdd.length + diff.toUpdate.length + (removeMissing ? diff.notInFile.length : 0) : 0

  return (
    <div className="space-y-4">
      <Field
        label="Roster file (.csv)"
        hint={<>Needs a <strong>Name</strong> column (or First name + Last name) and an <strong>Email</strong> column. An optional <strong>Role</strong> column sets leadership roles. Export from Google Sheets or Excel as CSV.</>}
      >
        {(id) => <input id={id} type="file" accept=".csv,text/csv" className={inputClass} onChange={(e) => void onFile(e.target.files?.[0])} />}
      </Field>
      {error && <Alert>{error}</Alert>}

      {parsed && diff && (
        <div className="space-y-3 rounded-lg bg-slate-50 p-3 text-sm" aria-live="polite">
          <p className="font-medium">
            {fileName}: {plural(parsed.members.length, 'member')} found
            {parsed.problems.length > 0 && `, ${plural(parsed.problems.length, 'row')} skipped`}.
          </p>
          <ul className="space-y-1">
            <li><span className="font-semibold text-fresh-700">{diff.toAdd.length}</span> new</li>
            <li><span className="font-semibold">{diff.toUpdate.length}</span> already on your list with a new name{parsed.hasRoleColumn && importRoles ? ' or role' : ''}</li>
            <li><span className="font-semibold">{diff.unchanged}</span> already on your list, no changes</li>
            <li><span className="font-semibold">{diff.notInFile.length}</span> on your list but not in this file</li>
          </ul>
          {parsed.problems.length > 0 && (
            <details>
              <summary className="cursor-pointer text-accent-700">Skipped rows</summary>
              <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-xs text-slate-600">
                {parsed.problems.slice(0, 50).map((p) => (
                  <li key={p.line}>Row {p.line}: {p.reason} <span className="text-slate-400">({p.raw || 'empty'})</span></li>
                ))}
              </ul>
            </details>
          )}
          {parsed.hasRoleColumn && (
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 accent-accent-600" checked={importRoles} onChange={(e) => setImportRoles(e.target.checked)} />
              <span>Set leadership roles from the Role column <span className="block text-xs text-slate-500">Blank cells keep a member’s current role.</span></span>
            </label>
          )}
          {diff.notInFile.length > 0 && (
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 accent-accent-600" checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)} />
              <span>
                Remove the {plural(diff.notInFile.length, 'member')} who aren’t in this file
                <span className="block text-xs text-slate-500">
                  {diff.notInFile.slice(0, 5).map((m) => m.name).join(', ')}{diff.notInFile.length > 5 && `, and ${diff.notInFile.length - 5} more`}
                </span>
              </span>
            </label>
          )}
          {!countFollowsList && (
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 accent-accent-600" checked={useForCount} onChange={(e) => setUseForCount(e.target.checked)} />
              <span>Use this list for the member count on your dashboard <span className="block text-xs text-slate-500">The count then updates automatically as you add or remove members.</span></span>
            </label>
          )}
        </div>
      )}

      <Button onClick={() => void apply()} disabled={busy || !diff || (changes === 0 && (countFollowsList || !useForCount))} className="w-full">
        {busy ? 'Importing…' : diff && changes === 0 && (countFollowsList || !useForCount) ? 'Nothing to change' : 'Import roster'}
      </Button>
    </div>
  )
}
