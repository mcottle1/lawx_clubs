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

/**
 * Colors. scope "organization": the university's colors, used by all its
 * colleges. scope "college": an optional override for one college; without
 * one, the college uses the university's colors.
 */
export default function ColorSettings({ scope, universityName }: { scope: 'organization' | 'college'; universityName: string }) {
  const theme = useUniversityTheme()
  // For a college: its own colors (if any) and the university's.
  const [info, setInfo] = useState<{ override: ThemeColors | null; organization: ThemeColors | null } | null>(
    scope === 'organization' ? { override: theme.colors, organization: null } : null,
  )
  useEffect(() => {
    if (scope !== 'college') return
    void supabase.rpc('department_theme_info').then(({ data }) =>
      setInfo((data as { override: ThemeColors | null; organization: ThemeColors | null } | null) ?? { override: null, organization: null }))
  }, [scope])
  if (!info) return null
  return <ColorEditor scope={scope} universityName={universityName} info={info} onSaved={setInfo} theme={theme} />
}

function ColorEditor({ scope, universityName, info, onSaved, theme }: {
  scope: 'organization' | 'college'
  universityName: string
  info: { override: ThemeColors | null; organization: ThemeColors | null }
  onSaved: (info: { override: ThemeColors | null; organization: ThemeColors | null }) => void
  theme: ReturnType<typeof useUniversityTheme>
}) {
  // What's in effect now: the college's own colors, else the university's, else CampusBridge's.
  const inEffect = info.override ?? info.organization ?? DEFAULT_COLORS
  const [draft, setDraft] = useState<ThemeColors>(inEffect)
  const [text, setText] = useState<ThemeColors>(inEffect)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const saved = inEffect
  const changed = (Object.keys(draft) as (keyof ThemeColors)[]).some((k) => draft[k].toLowerCase() !== saved[k].toLowerCase())
  const isDefault = !info.override

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
    const { error } = await supabase.rpc(scope === 'college' ? 'set_department_theme' : 'set_university_theme', {
      p_primary: colors?.primary ?? null, p_pop: colors?.pop ?? null, p_fresh: colors?.fresh ?? null,
    })
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: error.message })
    // What this admin now sees: their saved colors, or (a college going back) the university's.
    theme.commit(colors ?? (scope === 'college' ? info.organization : null))
    onSaved({ ...info, override: colors })
    const next = colors ?? (scope === 'college' ? info.organization : null) ?? DEFAULT_COLORS
    setDraft(next)
    setText(next)
    setMsg({ kind: 'success', text: colors
      ? 'Colors saved. Your clubs see them the next time they open CampusBridge.'
      : scope === 'college' ? `Back to ${universityName}’s colors.` : 'Back to the CampusBridge colors.' })
  }

  const vars = buildTheme(draft)

  return (
    <Card className="mt-4">
      <h2 className="font-medium">{scope === 'college' ? 'Colors for your clubs' : 'Colors for your university'}</h2>
      <p className="mt-1 text-sm text-slate-600">
        {scope === 'college'
          ? (info.override
            ? 'Your clubs see CampusBridge in these colors, instead of your university’s.'
            : `Your clubs use ${universityName}’s colors. Pick your own here if you’d like.`)
          : 'All your colleges’ clubs and admins see CampusBridge in these colors, unless a college picks its own. Partners and other universities don’t.'}
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
          <Button variant="ghost" disabled={busy} onClick={() => {
            if (confirm(scope === 'college' ? `Go back to ${universityName}’s colors?` : 'Go back to the CampusBridge colors?')) void save(null)
          }}>
            {scope === 'college' ? `Use ${universityName}’s colors` : 'Use CampusBridge colors'}
          </Button>
        )}
      </div>
    </Card>
  )
}
