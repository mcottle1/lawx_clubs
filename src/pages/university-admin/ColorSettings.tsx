import { useEffect, useState } from 'react'
import { useUniversityTheme } from '../../auth/UniversityThemeContext'
import StatusBadge from '../../components/StatusBadge'
import { Alert, Button, Card, inputClass } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { adjustedForReadability, buildTheme, DEFAULT_COLORS, HEX_RE, type ThemeColors } from '../../lib/universityTheme'

const FIELDS: { key: keyof ThemeColors; label: string; hint: string }[] = [
  { key: 'primary', label: 'Main color', hint: 'Buttons, links, headings, the calendar.' },
  { key: 'pop', label: 'Highlight color', hint: 'Bright buttons, the active tab underline, highlights.' },
  { key: 'fresh', label: 'Second accent', hint: 'Positive numbers and the second chart color.' },
]

/** University colors: shown to this university's clubs and its administrator. */
export default function ColorSettings() {
  const theme = useUniversityTheme()
  const [draft, setDraft] = useState<ThemeColors>(theme.colors ?? DEFAULT_COLORS)
  const [text, setText] = useState<ThemeColors>(theme.colors ?? DEFAULT_COLORS)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const saved = theme.colors ?? DEFAULT_COLORS
  const changed = (Object.keys(draft) as (keyof ThemeColors)[]).some((k) => draft[k].toLowerCase() !== saved[k].toLowerCase())
  const isDefault = !theme.colors

  // Live preview while editing; restore the saved colors when leaving the page.
  const { preview, endPreview } = theme
  useEffect(() => { if (changed) preview(draft) }, [draft, changed, preview])
  useEffect(() => () => endPreview(), [endPreview])

  function setColor(key: keyof ThemeColors, value: string) {
    setText((t) => ({ ...t, [key]: value }))
    const v = value.startsWith('#') ? value : `#${value}`
    if (HEX_RE.test(v)) setDraft((d) => ({ ...d, [key]: v.toLowerCase() }))
  }

  async function save(colors: ThemeColors | null) {
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.rpc('set_university_theme', {
      p_primary: colors?.primary ?? null, p_pop: colors?.pop ?? null, p_fresh: colors?.fresh ?? null,
    })
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: error.message })
    theme.commit(colors)
    const next = colors ?? DEFAULT_COLORS
    setDraft(next)
    setText(next)
    setMsg({ kind: 'success', text: colors ? 'Colors saved. Your clubs see them the next time they open CampusBridge.' : 'Back to the CampusBridge colors.' })
  }

  const vars = buildTheme(draft)

  return (
    <Card className="mt-4">
      <h2 className="font-medium">Colors for your university</h2>
      <p className="mt-1 text-sm text-slate-600">
        Your clubs and you see CampusBridge in these colors. Partners and other universities don’t.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label htmlFor={`color-${f.key}`} className="mb-1 block text-sm font-medium text-slate-800">{f.label}</label>
            <div className="flex items-center gap-2">
              <input
                id={`color-${f.key}`}
                type="color"
                className="h-10 w-12 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
                value={draft[f.key]}
                onChange={(e) => setColor(f.key, e.target.value)}
              />
              <input
                aria-label={`${f.label} (hex)`}
                className={inputClass}
                value={text[f.key]}
                maxLength={7}
                spellCheck={false}
                onChange={(e) => setColor(f.key, e.target.value.trim())}
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">{f.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-surface p-4" aria-label="Preview">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Preview</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary button</Button>
          <Button variant="pop">Highlight button</Button>
          <span className="text-sm font-medium text-accent-700 underline">A link</span>
          <StatusBadge status="changes_requested" />
          <span className="rounded-full bg-fresh-50 px-2 py-0.5 text-xs font-semibold text-fresh-700">+12 members</span>
          <span className="flex items-end gap-1" aria-hidden>
            <span className="inline-block h-6 w-3 rounded-sm" style={{ background: vars['--color-accent-600'] }} />
            <span className="inline-block h-9 w-3 rounded-sm" style={{ background: vars['--color-fresh-600'] }} />
            <span className="inline-block h-4 w-3 rounded-sm" style={{ background: vars['--color-pop-500'] }} />
          </span>
        </div>
      </div>
      {adjustedForReadability(draft) && (
        <p className="mt-2 text-xs text-slate-600">
          Your main color is quite light, so buttons use a slightly darker version so white text stays readable.
        </p>
      )}

      {msg && <Alert kind={msg.kind} className="mt-3">{msg.text}</Alert>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={busy || !changed} onClick={() => void save(draft)}>{busy ? 'Saving…' : 'Save colors'}</Button>
        {changed && (
          <Button variant="secondary" disabled={busy} onClick={() => { setDraft(saved); setText(saved); endPreview() }}>Cancel changes</Button>
        )}
        {!isDefault && (
          <Button variant="ghost" disabled={busy} onClick={() => { if (confirm('Go back to the CampusBridge colors?')) void save(null) }}>
            Use CampusBridge colors
          </Button>
        )}
      </div>
    </Card>
  )
}
