import { useState } from 'react'
import { formatDay, usd } from '../../../lib/format'
import type { BudgetSummary } from '../../../lib/types'
import { Card } from '../../../components/ui'

/** Remaining budget, with the math one click away. */
export default function BudgetCard({ budget }: { budget: BudgetSummary | null }) {
  const [open, setOpen] = useState(false)
  if (!budget) return <Card><p className="text-sm text-slate-500">Loading budget…</p></Card>
  const remaining = Number(budget.remaining)
  return (
    <Card>
      <h2 className="text-sm font-medium text-slate-600">Budget remaining</h2>
      <p className={`mt-1 text-2xl font-semibold ${remaining < 0 ? 'text-red-700' : ''}`}>{usd.format(remaining)}</p>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mt-1 text-xs text-accent-700 hover:underline">
        {open ? 'Hide the math' : 'How is this calculated?'}
      </button>
      {open && (
        <dl className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-slate-600">Annual budget</dt><dd>{usd.format(Number(budget.initial_budget))}</dd></div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">− Reported spending ({budget.reported_events} event{budget.reported_events === 1 ? '' : 's'})</dt>
            <dd>{usd.format(Number(budget.spent))}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-slate-100 pt-1 font-medium"><dt>= Remaining</dt><dd>{usd.format(remaining)}</dd></div>
          <p className="pt-1 text-xs text-slate-500">
            Counts event reports since {formatDay(budget.budget_year_start)} (your budget year start — change it in Settings).
          </p>
        </dl>
      )}
    </Card>
  )
}
