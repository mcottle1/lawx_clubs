import { categoryLabel } from '../constants'
import type { Partner, SupportType } from '../types'
import { inferCategories, words } from './keywords'

export interface MatchStats { at_university: number; with_club: number }

export interface PartnerSuggestion {
  partner: Partner
  score: number
  reasons: string[]
}

export interface MatchInput {
  /** Event name + description and/or typed keywords. */
  text: string
  supportType?: SupportType | null
  universityCity: string | null
  universityState: string | null
  partners: Partner[]
  stats: Map<string, MatchStats>
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/**
 * Ranks platform partners for an event with simple, explainable rules:
 *   +30 same state as the university   +20 same city
 *   +30 business category fits the event (from its words / support needed)
 *   +25 has sponsored this club before  +15 has sponsored at this university
 *   +5 per word their "what we offer" shares with the event (max +15)
 * Every point comes with a plain-English reason shown to the club.
 */
export function rankPartners(input: MatchInput): PartnerSuggestion[] {
  const hints = inferCategories(input.text, input.supportType)
  const eventWords = words(input.text)

  return input.partners
    .filter((p) => p.open_to_sponsorships)
    .map((p) => {
      let score = 0
      const reasons: string[] = []
      if (input.universityState && p.state === input.universityState) {
        score += 30
        if (input.universityCity && norm(p.city) === norm(input.universityCity)) {
          score += 20
          reasons.push(`Located in ${p.city}, ${p.state} — same city as your university`)
        } else {
          reasons.push(`Located in ${p.city}, ${p.state}`)
        }
      }
      const hint = hints.find((h) => h.category === p.category)
      if (hint) {
        score += 30
        reasons.push(`${categoryLabel(p.category)} — fits an event about ${hint.because.slice(0, 2).join(', ')}`)
      }
      const s = input.stats.get(p.id)
      if (s?.with_club) {
        score += 25
        reasons.push(`Sponsored your club before (${s.with_club}×)`)
      }
      if (s?.at_university) {
        score += 15
        if (!s.with_club || s.at_university > s.with_club) reasons.push(`Sponsored ${s.at_university} event${s.at_university === 1 ? '' : 's'} at your university`)
      }
      const shared = [...words(`${p.offer_description} ${p.description}`)].filter((w) => eventWords.has(w))
      if (shared.length) score += Math.min(15, shared.length * 5)
      if (p.offer_description) reasons.push(`Offers: ${p.offer_description.length > 90 ? p.offer_description.slice(0, 87) + '…' : p.offer_description}`)
      return { partner: p, score, reasons }
    })
    .sort((a, b) => b.score - a.score || a.partner.name.localeCompare(b.partner.name))
}
