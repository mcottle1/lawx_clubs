import { useEffect, useMemo, useState } from 'react'
import { AiBadge, AiUsage } from '../../../components/suggest/AiNote'
import { Alert, Button, Card, Field, inputClass } from '../../../components/ui'
import { callAi, useAiStatus } from '../../../lib/ai'
import { usd } from '../../../lib/format'
import { suggestAsk, type AskSuggestion } from '../../../lib/suggest/askAmount'
import { BENEFITS, draftOpportunity, type BenefitKey } from '../../../lib/suggest/templates'
import { supabase } from '../../../lib/supabase'
import type { ClubEvent, SupportType } from '../../../lib/types'
import { useClub } from '../ClubContext'

interface Props {
  supportType: SupportType
  event: ClubEvent | null
  current: { title: string; description: string }
  onDraft: (d: { title?: string; description?: string; amount?: number }) => void
}

/** "Help me write this": template + ask formula (always), optional AI rewrite. */
export default function DraftHelper({ supportType, event, current, onDraft }: Props) {
  const { club, universityName } = useClub()
  const [reports, setReports] = useState<{ attendees: number; amount_spent: number }[]>([])
  const [members, setMembers] = useState<number | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [comparable, setComparable] = useState<{ median: number | null; n: number; scope: 'university' | 'site' | 'none' } | null>(null)
  const [headcount, setHeadcount] = useState('')
  const [benefits, setBenefits] = useState<BenefitKey[]>(['present', 'logo', 'social'])
  const [minutes, setMinutes] = useState('10')
  const [suggestion, setSuggestion] = useState<(AskSuggestion & { source: 'formula' | 'ai' }) | null>(null)
  const [ai, refreshAi] = useAiStatus()
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('event_reports').select('attendees, amount_spent').then(({ data }) =>
      setReports((data ?? []).map((r) => ({ attendees: r.attendees, amount_spent: Number(r.amount_spent) }))))
    supabase.from('club_member_counts').select('count').eq('club_id', club.id).order('recorded_on', { ascending: false }).limit(1)
      .then(({ data }) => setMembers(data?.[0]?.count ?? null))
    supabase.from('club_budget_summary').select('remaining').eq('club_id', club.id).maybeSingle()
      .then(({ data }) => setRemaining(data ? Number(data.remaining) : null))
  }, [club.id])

  useEffect(() => {
    supabase.rpc('proposal_amount_stats', { p_support_type: supportType }).then(({ data }) => {
      const row = (data as { median_amount: number | null; sample_size: number; scope: 'university' | 'site' | 'none' }[] | null)?.[0]
      setComparable(row ? { median: row.median_amount === null ? null : Number(row.median_amount), n: row.sample_size, scope: row.scope } : null)
    })
    setSuggestion(null)
  }, [supportType])

  // Default headcount: average attendance from past reports, else member count.
  const defaultHeadcount = useMemo(() => {
    const att = reports.filter((r) => r.attendees > 0)
    if (att.length) return Math.round(att.reduce((s, r) => s + r.attendees, 0) / att.length)
    return members ?? 30
  }, [reports, members])
  const people = Number(headcount || defaultHeadcount)

  function fromTemplate() {
    const d = draftOpportunity({
      clubName: club.name, universityName, eventName: event?.name ?? null,
      eventDate: event ? new Date(event.starts_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : null,
      headcount: people || null, supportType, benefits, presentMinutes: Number(minutes) || null, clubDescription: club.description,
    })
    onDraft({ title: current.title.trim() ? undefined : d.title, description: d.description })
    const s = suggestAsk({ supportType, headcount: people, pastReports: reports, eventBudget: event ? Number(event.budget) : null, remainingBudget: remaining, comparable })
    setSuggestion({ ...s, source: 'formula' })
  }

  async function improveWithAi() {
    setAiBusy(true)
    setAiError(null)
    const formula = suggestAsk({ supportType, headcount: people, pastReports: reports, eventBudget: event ? Number(event.budget) : null, remainingBudget: remaining, comparable })
    try {
      const res = await callAi<{ title: string; description: string; ask_amount: number; ask_reason: string }>('draft_opportunity', {
        title: current.title, description: current.description, support_type: supportType, headcount: people,
        benefits: benefits.map((b) => (b === 'present' ? `${minutes} minutes to present` : BENEFITS[b])).join('; '),
        formula_amount: formula.amount, formula_steps: formula.steps.join(' '),
      })
      onDraft({ title: res.title, description: res.description })
      setSuggestion({ amount: res.ask_amount, steps: [res.ask_reason, `(The formula suggested ${usd.format(formula.amount)}.)`], source: 'ai' })
    } catch (e) {
      setAiError((e as Error).message)
    }
    setAiBusy(false)
    refreshAi()
  }

  const toggle = (b: BenefitKey) => setBenefits(benefits.includes(b) ? benefits.filter((x) => x !== b) : [...benefits, b])

  return (
    <Card className="space-y-3 border-accent-100 bg-accent-50/40">
      <h2 className="font-medium">Help me write this</h2>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label="Expected attendees" hint={`Default: ${defaultHeadcount}`}>
          {(id) => <input id={id} type="number" min={0} inputMode="numeric" className={inputClass} placeholder={String(defaultHeadcount)} value={headcount} onChange={(e) => setHeadcount(e.target.value)} />}
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-800">What the sponsor gets</legend>
          <div className="grid gap-1 text-sm sm:grid-cols-2">
            {(Object.keys(BENEFITS) as BenefitKey[]).map((b) => (
              <label key={b} className="flex items-center gap-2">
                <input type="checkbox" className="accent-accent-600" checked={benefits.includes(b)} onChange={() => toggle(b)} />
                {b === 'present' ? (
                  <span className="flex items-center gap-1">
                    <input type="number" min={1} max={60} aria-label="Minutes to present" className="w-14 rounded border border-slate-300 px-1 py-0.5 text-sm" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
                    minutes to present
                  </span>
                ) : BENEFITS[b]}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={fromTemplate}>Fill in from template</Button>
        {ai?.enabled && (
          <>
            <Button onClick={() => void improveWithAi()} disabled={aiBusy}>{aiBusy ? 'Writing…' : 'Improve with AI'}</Button>
            <AiBadge />
          </>
        )}
      </div>
      {ai?.enabled && <AiUsage status={ai} kind="draft" />}
      {aiError && <Alert>{aiError}</Alert>}
      {suggestion && (
        <div className="rounded-md border border-slate-200 bg-white p-3 text-sm" role="status">
          <p>
            Suggested ask: <strong>{usd.format(suggestion.amount)}</strong> {suggestion.source === 'ai' && <AiBadge />}
            <Button variant="ghost" className="ml-2 px-2 py-0.5 text-xs" onClick={() => onDraft({ amount: suggestion.amount })}>Use this amount</Button>
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-accent-700">How we got this</summary>
            <ol className="mt-1 list-decimal pl-5 text-xs text-slate-600">{suggestion.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          </details>
        </div>
      )}
    </Card>
  )
}
