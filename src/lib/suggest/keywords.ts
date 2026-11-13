import type { PartnerCategory, SupportType } from '../types'

/** Words in an event's name/description that hint at a kind of sponsor. */
const CATEGORY_WORDS: Record<PartnerCategory, string[]> = {
  restaurant_catering: ['lunch', 'dinner', 'breakfast', 'food', 'pizza', 'catering', 'catered', 'snack', 'snacks', 'social', 'mixer', 'banquet', 'reception', 'coffee', 'dessert', 'bbq'],
  bar_prep: ['bar', 'exam', 'lsat', 'mpre', 'study', 'prep', 'outline', 'outlines', 'finals', 'test'],
  law_firm: ['firm', 'firms', 'career', 'careers', 'networking', 'recruiting', 'litigation', 'clerkship', 'interview', 'interviews', 'panel', 'attorney', 'attorneys', 'lawyer', 'lawyers', 'corporate', 'practice', 'moot', 'trial', 'advocacy', 'negotiation', 'mentor', 'mentorship'],
  legal_tech: ['tech', 'technology', 'ai', 'software', 'data', 'privacy', 'cyber', 'cybersecurity', 'innovation', 'startup', 'startups', 'blockchain'],
  nonprofit: ['pro', 'bono', 'service', 'volunteer', 'volunteering', 'public', 'interest', 'nonprofit', 'community', 'clinic', 'justice', 'charity', 'outreach'],
  other: [],
}

/** Which partner categories usually provide each kind of support. */
const SUPPORT_TO_CATEGORIES: Record<SupportType, PartnerCategory[]> = {
  food: ['restaurant_catering'],
  funding: ['law_firm', 'bar_prep'],
  in_kind: ['bar_prep', 'legal_tech'],
  speaker: ['law_firm', 'nonprofit', 'legal_tech'],
  other: [],
}

const STOP = new Set(['the', 'and', 'for', 'with', 'our', 'your', 'you', 'are', 'will', 'from', 'this', 'that', 'into', 'about', 'event', 'students', 'student', 'law', 'club', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'we', 'is', 'be', 'or', 'by'])

/** Lower-cased meaningful words (3+ letters, no stop words). */
export function words(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter((w) => (w.length >= 3 || w === 'ai') && !STOP.has(w)),
  )
}

export interface CategoryHint {
  category: PartnerCategory
  /** The words that triggered it, for the "why" text. */
  because: string[]
}

/** Infers sponsor categories from free text and an optional support type. */
export function inferCategories(text: string, support?: SupportType | null): CategoryHint[] {
  const w = words(text)
  const hints = new Map<PartnerCategory, string[]>()
  for (const [cat, list] of Object.entries(CATEGORY_WORDS) as [PartnerCategory, string[]][]) {
    const hit = list.filter((x) => w.has(x))
    if (hit.length) hints.set(cat, hit)
  }
  if (support) {
    for (const cat of SUPPORT_TO_CATEGORIES[support]) {
      if (!hints.has(cat)) hints.set(cat, [`needs ${support === 'in_kind' ? 'in-kind support' : support}`])
    }
  }
  return [...hints].map(([category, because]) => ({ category, because }))
}
