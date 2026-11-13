import type { PartnerCategory } from '../types'

const QUERY: Record<PartnerCategory, string> = {
  law_firm: 'law firms',
  bar_prep: 'bar exam prep courses',
  restaurant_catering: 'catering',
  legal_tech: 'legal technology companies',
  nonprofit: 'legal aid nonprofits',
  other: 'local businesses that sponsor student events',
}

export interface SearchLink { label: string; url: string }

/** Ready-made map/web searches for outside businesses near the university (free, no API). */
export function searchLinks(categories: PartnerCategory[], city: string | null, state: string | null): SearchLink[] {
  const where = [city, state].filter(Boolean).join(', ')
  const cats: PartnerCategory[] = categories.length ? categories : ['law_firm', 'restaurant_catering']
  const links: SearchLink[] = []
  for (const c of [...new Set(cats)].slice(0, 4)) {
    const q = `${QUERY[c]}${where ? ` near ${where}` : ''}`
    links.push({ label: `Map: ${q}`, url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` })
  }
  const web = `companies that sponsor law school student organizations${where ? ` ${where}` : ''}`
  links.push({ label: `Web: ${web}`, url: `https://www.google.com/search?q=${encodeURIComponent(web)}` })
  return links
}
