import { usd } from '../lib/format'
import type { ProposalDetail } from '../lib/types'

/** What a partner is offering, as a compact definition list. */
export default function ProposalTerms({ p }: { p: Pick<ProposalDetail, 'headcount' | 'amount' | 'in_kind' | 'student_offer' | 'pitch_minutes' | 'message'> }) {
  const rows: [string, string][] = []
  if (p.headcount) rows.push(['Lunches / people covered', String(p.headcount)])
  if (p.amount) rows.push(['Funding', usd.format(Number(p.amount))])
  if (p.in_kind) rows.push(['In-kind support', p.in_kind])
  if (p.student_offer) rows.push(['Offer for students', p.student_offer])
  if (p.pitch_minutes) rows.push(['Time requested to present', `${p.pitch_minutes} min`])
  return (
    <div className="text-sm">
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {p.message && <p className="mt-2 whitespace-pre-line rounded-md bg-slate-50 p-2 text-slate-700">“{p.message}”</p>}
    </div>
  )
}
