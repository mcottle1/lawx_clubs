import { useEffect, useState } from 'react'
import { INSTITUTION_TYPE_LABELS } from '../../lib/constants'
import { supabase } from '../../lib/supabase'
import type { University } from '../../lib/types'
import { Field, inputClass } from '../../components/ui'

/** Type-ahead search over the full universities table. */
export default function UniversityPicker({
  value,
  onChange,
}: {
  value: University | null
  onChange: (u: University | null) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<University[]>([])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return
    const timer = setTimeout(async () => {
      const escaped = q.replace(/[%_,()]/g, ' ')
      const { data } = await supabase.from('universities').select('*').ilike('name', `%${escaped}%`).order('name').limit(15)
      setResults((data as University[]) ?? [])
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  if (value) {
    return (
      <div>
        <p className="mb-1 text-sm font-medium text-slate-800">University</p>
        <div className="flex items-center justify-between gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
          <span>{value.name}{value.state ? ` (${value.state})` : ''}</span>
          <button type="button" className="text-accent-700 hover:underline" onClick={() => onChange(null)}>Change</button>
        </div>
      </div>
    )
  }

  const shown = query.trim().length >= 2 ? results : []
  return (
    <Field label="University" required hint="Type at least 2 letters to search.">
      {(id) => (
        <>
          <input id={id} className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Brigham Young" autoComplete="off" />
          {shown.length > 0 && (
            <ul className="mt-1 max-h-64 overflow-auto rounded-md border border-slate-200 bg-white text-sm shadow-sm">
              {shown.map((u) => (
                <li key={u.id}>
                  <button type="button" className="w-full px-3 py-2 text-left hover:bg-accent-50 focus:bg-accent-50"
                    onClick={() => { onChange(u); setQuery('') }}>
                    {u.name}
                    <span className="ml-1 text-xs text-slate-500">
                      {[u.city, u.state].filter(Boolean).join(', ')} · {INSTITUTION_TYPE_LABELS[u.type]}
                      {u.is_participating && ' · participating'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Field>
  )
}
