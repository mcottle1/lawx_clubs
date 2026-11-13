import type { SupportType } from '../types'

export interface AskInput {
  supportType: SupportType
  headcount: number
  /** The club's past reports (for cost per person). */
  pastReports: { attendees: number; amount_spent: number }[]
  /** This event's planned budget, if tied to an event. */
  eventBudget: number | null
  remainingBudget: number | null
  /** Median of approved sponsorship amounts for this support type. */
  comparable: { median: number | null; n: number; scope: 'university' | 'site' | 'none' } | null
}

export interface AskSuggestion {
  amount: number
  /** Each step of the math, for "How we got this". */
  steps: string[]
}

/** Typical cost per attendee when the club has no history yet. */
export const DEFAULT_PER_HEAD: Record<SupportType, number> = {
  food: 12, funding: 10, in_kind: 5, speaker: 0, other: 8,
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Rounds to the nearest $25 (min $50 when there's anything to ask for). */
function tidy(n: number): number {
  if (n <= 0) return 0
  return Math.max(50, Math.round(n / 25) * 25)
}

/**
 * Suggested amount to ask a sponsor for:
 *   1. estimate = expected headcount × cost per person
 *      (the club's median from past reports, else a default for the support type)
 *   2. if the event has a budget, use the larger of the two (the budget is the plan)
 *   3. blend with what sponsors actually gave for this kind of support
 *      (50/50 with 3+ examples, 75/25 with 1–2)
 *   4. round to the nearest $25
 * Speaker requests default to $0 (speakers usually give time, not money).
 */
export function suggestAsk(input: AskInput): AskSuggestion {
  const steps: string[] = []
  if (input.supportType === 'speaker') {
    return { amount: 0, steps: ['Speakers usually donate their time, so no cash ask is suggested. You could ask them to cover lunch or travel instead.'] }
  }

  const usable = input.pastReports.filter((r) => r.attendees > 0 && r.amount_spent > 0)
  let perHead = DEFAULT_PER_HEAD[input.supportType]
  if (usable.length) {
    perHead = median(usable.map((r) => r.amount_spent / r.attendees))
    steps.push(`Your past events cost about ${usd(perHead)} per attendee (median of ${usable.length} report${usable.length === 1 ? '' : 's'}).`)
  } else {
    steps.push(`No past reports yet, so we used a typical ${usd(perHead)} per attendee.`)
  }
  let estimate = Math.max(0, input.headcount) * perHead
  steps.push(`${input.headcount} expected attendees × ${usd(perHead)} = ${usd(estimate)}.`)

  if (input.eventBudget && input.eventBudget > estimate) {
    estimate = input.eventBudget
    steps.push(`Your event budget is ${usd(input.eventBudget)}, which is higher, so we used that.`)
  }

  const c = input.comparable
  if (c && c.median && c.n > 0) {
    const w = c.n >= 3 ? 0.5 : 0.25
    const blended = estimate * (1 - w) + c.median * w
    steps.push(`Sponsors gave a median of ${usd(c.median)} for this kind of support (${c.n} approved sponsorship${c.n === 1 ? '' : 's'} ${c.scope === 'university' ? 'at your university' : 'on the site'}); weighting that ${Math.round(w * 100)}% gives ${usd(blended)}.`)
    estimate = blended
  }

  const amount = tidy(estimate)
  steps.push(`Rounded to ${usd(amount)}.`)
  if (input.remainingBudget !== null && input.remainingBudget < amount) {
    steps.push(`Your remaining club budget (${usd(Math.max(0, input.remainingBudget))}) wouldn't cover this on its own, so asking for the full amount makes sense.`)
  }
  return { amount, steps }
}
