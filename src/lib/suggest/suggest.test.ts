import { describe, expect, it } from 'vitest'
import type { Partner } from '../types'
import { suggestAsk } from './askAmount'
import { inferCategories } from './keywords'
import { rankPartners } from './partnerMatch'
import { searchLinks } from './searchLinks'
import { draftOpportunity, opportunityCaptions, recapPosts, shortName } from './templates'

const partner = (over: Partial<Partner>): Partner => ({
  id: over.name ?? 'x', user_id: 'u', name: 'X', email: 'x@example.com', city: 'Provo', state: 'UT',
  category: 'other', description: '', offer_description: '', open_to_sponsorships: true, logo_path: null, website: null,
  ...over,
})

describe('inferCategories', () => {
  it('maps event words to sponsor categories', () => {
    const cats = inferCategories('Bar Exam Prep Lunch').map((c) => c.category)
    expect(cats).toContain('bar_prep')
    expect(cats).toContain('restaurant_catering')
  })
  it('adds categories from the support type', () => {
    expect(inferCategories('Spring social', 'food').map((c) => c.category)).toContain('restaurant_catering')
  })
})

describe('rankPartners', () => {
  const partners = [
    partner({ id: 'far', name: 'Far Firm', city: 'Austin', state: 'TX', category: 'law_firm' }),
    partner({ id: 'kaplan', name: 'Kaplan', city: 'Provo', state: 'UT', category: 'bar_prep', offer_description: 'Lunch for students studying for the bar exam' }),
    partner({ id: 'deli', name: 'Deli', city: 'Orem', state: 'UT', category: 'restaurant_catering' }),
    partner({ id: 'closed', name: 'Closed', state: 'UT', category: 'bar_prep', open_to_sponsorships: false }),
  ]
  const ranked = rankPartners({
    text: 'Bar exam kickoff lunch', universityCity: 'Provo', universityState: 'UT', partners,
    stats: new Map([['deli', { at_university: 2, with_club: 1 }]]),
  })
  it('puts the best local category match first when nobody has history', () => {
    const fresh = rankPartners({ text: 'Bar exam kickoff lunch', universityCity: 'Provo', universityState: 'UT', partners, stats: new Map() })
    expect(fresh[0].partner.id).toBe('kaplan')
    expect(fresh[0].reasons.join(' ')).toMatch(/same city/)
  })
  it('lets a past sponsor of this club outrank a slightly closer match', () => {
    expect(ranked[0].partner.id).toBe('deli')
  })
  it('rewards past sponsorships with a reason', () => {
    const deli = ranked.find((r) => r.partner.id === 'deli')!
    expect(deli.reasons).toContain('Sponsored your club before (1×)')
  })
  it('ranks out-of-state, off-topic partners last and hides closed ones', () => {
    expect(ranked.at(-1)!.partner.id).toBe('far')
    expect(ranked.some((r) => r.partner.id === 'closed')).toBe(false)
  })
})

describe('suggestAsk', () => {
  it('uses default cost per person without history', () => {
    const s = suggestAsk({ supportType: 'food', headcount: 40, pastReports: [], eventBudget: null, remainingBudget: 2000, comparable: null })
    expect(s.amount).toBe(475) // 40 × $12 = $480 → nearest $25
    expect(s.steps[0]).toMatch(/typical/)
  })
  it('uses the club median and the event budget when larger', () => {
    const s = suggestAsk({
      supportType: 'food', headcount: 30,
      pastReports: [{ attendees: 50, amount_spent: 250 }, { attendees: 20, amount_spent: 200 }, { attendees: 10, amount_spent: 50 }],
      eventBudget: 600, remainingBudget: 100, comparable: null,
    })
    expect(s.amount).toBe(600)
    expect(s.steps.join(' ')).toMatch(/event budget/)
    expect(s.steps.join(' ')).toMatch(/remaining club budget/)
  })
  it('blends with comparable sponsorships', () => {
    const s = suggestAsk({ supportType: 'funding', headcount: 50, pastReports: [], eventBudget: null, remainingBudget: null, comparable: { median: 1000, n: 4, scope: 'university' } })
    expect(s.amount).toBe(750) // (500 + 1000) / 2
  })
  it('suggests no cash ask for speakers', () => {
    expect(suggestAsk({ supportType: 'speaker', headcount: 80, pastReports: [], eventBudget: 500, remainingBudget: 0, comparable: null }).amount).toBe(0)
  })
})

describe('templates', () => {
  it('drafts a description with the chosen perks', () => {
    const d = draftOpportunity({
      clubName: 'Moot Court Society', universityName: 'BYU', eventName: 'Advocacy Night', eventDate: 'Thu, Dec 3',
      headcount: 45, supportType: 'food', benefits: ['present', 'logo'], presentMinutes: 10, clubDescription: '',
    })
    expect(d.title).toBe('Sponsor lunch at Advocacy Night')
    expect(d.description).toMatch(/about 45 students/)
    expect(d.description).toMatch(/10 minutes to present/)
    expect(d.description).toMatch(/Logo on the event flyer/)
  })
  it('makes captions and recaps with real numbers', () => {
    expect(opportunityCaptions({ clubName: 'Moot Court', universityName: 'Brigham Young University', title: 't', eventName: 'E', eventDate: null, headcount: 40, link: 'https://x' })[0]).toMatch(/40\+ law students/)
    const r = recapPosts({ clubName: 'Moot Court', universityName: 'BYU', eventName: 'E', attendees: 48, sponsorName: 'Kaplan', offersRedeemed: 9, notes: null })
    expect(r[0]).toMatch(/48 students/)
    expect(r[0]).toMatch(/Kaplan/)
  })
  it('shortens university names for hashtags', () => {
    expect(shortName('Brigham Young University')).toBe('BYU')
  })
})

describe('searchLinks', () => {
  it('builds map searches near the university', () => {
    const links = searchLinks(['law_firm'], 'Provo', 'UT')
    expect(links[0].label).toBe('Map: law firms near Provo, UT')
    expect(links[0].url).toContain('google.com/maps/search')
  })
})
