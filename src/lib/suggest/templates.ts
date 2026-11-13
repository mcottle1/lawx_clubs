import type { SupportType } from '../types'

/** Things a club can offer a sponsor (checkboxes on the opportunity form). */
export const BENEFITS = {
  present: 'Time to present to students',
  logo: 'Logo on the event flyer',
  social: 'Thank-you post on our social media',
  table: 'A table or booth at the event',
  email: 'Mention in our email to members',
  thanks: 'Thank-you at the start of the event',
} as const
export type BenefitKey = keyof typeof BENEFITS

const SUPPORT_PHRASE: Record<SupportType, string> = {
  food: 'covering food for the event',
  funding: 'helping fund the event',
  in_kind: 'providing supplies, prizes or materials',
  speaker: 'sending a speaker or panelist',
  other: 'supporting the event',
}

export interface OpportunityDraftInput {
  clubName: string
  universityName: string
  eventName: string | null
  eventDate: string | null // already formatted, e.g. "Thu, Dec 3"
  headcount: number | null
  supportType: SupportType
  benefits: BenefitKey[]
  presentMinutes: number | null
  clubDescription: string
}

export interface OpportunityDraft { title: string; description: string }

/** Fill-in-the-blanks opportunity title + description. */
export function draftOpportunity(i: OpportunityDraftInput): OpportunityDraft {
  const what = i.eventName ? `${i.eventName}${i.eventDate ? ` on ${i.eventDate}` : ''}` : 'our upcoming events'
  const title =
    i.supportType === 'food' ? `Sponsor lunch at ${i.eventName ?? `${i.clubName} events`}`
    : i.supportType === 'speaker' ? `Speak at ${i.eventName ?? i.clubName}`
    : `Sponsor ${i.eventName ?? i.clubName}`

  const who = i.headcount ? `about ${i.headcount} students` : 'students'
  const lines: string[] = []
  lines.push(`${i.clubName} at ${i.universityName} is looking for a sponsor for ${what}. We expect ${who} to attend.`)
  if (i.clubDescription.trim()) lines.push(i.clubDescription.trim())
  lines.push(`We're hoping for help ${SUPPORT_PHRASE[i.supportType]}.`)
  const perks = i.benefits.map((b) => (b === 'present' && i.presentMinutes ? `${i.presentMinutes} minutes to present to students` : BENEFITS[b]))
  if (perks.length) lines.push(`In return, our sponsor gets:\n${perks.map((p) => `• ${p}`).join('\n')}`)
  lines.push('Interested? Send us a proposal here or message us with questions.')
  return { title: title.slice(0, 200), description: lines.join('\n\n') }
}

function tag(s: string): string {
  return '#' + s.replace(/[^A-Za-z0-9]+/g, '')
}

/** Short hashtag-style name, e.g. "Brigham Young University" → "#BYU"-ish initials. */
export function shortName(name: string): string {
  const initials = name.split(/[\s-]+/).filter((w) => /^[A-Z]/.test(w) && !['of', 'the', 'at'].includes(w.toLowerCase())).map((w) => w[0]).join('')
  return initials.length >= 2 && initials.length <= 6 ? initials : name.split(/\s+/)[0]
}

export interface CaptionInput {
  clubName: string
  universityName: string
  title: string
  eventName: string | null
  eventDate: string | null
  headcount: number | null
  link: string
}

/** Social captions for sharing an open opportunity (Instagram/TikTok). */
export function opportunityCaptions(i: CaptionInput): string[] {
  const tags = `${tag(i.clubName)} ${tag(shortName(i.universityName))} #LawSchool #Sponsorship`
  const when = i.eventDate ? ` on ${i.eventDate}` : ''
  const crowd = i.headcount ? `${i.headcount}+ law students` : 'law students'
  return [
    `📣 We're looking for a sponsor! ${i.clubName} is hosting ${i.eventName ?? 'an event'}${when} for ${crowd}. Want to get in front of future lawyers? Details: ${i.link}\n\n${tags}`,
    `Local businesses & firms: partner with ${i.clubName} at ${i.universityName}! "${i.title}" — see what's included and send us a proposal: ${i.link}\n\n${tags}`,
    `Help us make ${i.eventName ?? 'our next event'} happen 🙌 Sponsor ${i.clubName} and meet ${crowd}${when}. Link: ${i.link}\n\n${tags}`,
  ]
}

export interface RecapInput {
  clubName: string
  universityName: string
  eventName: string
  attendees: number
  sponsorName: string | null
  offersRedeemed: number | null
  notes: string | null
}

/** Post-event recap ideas filled in with the report's numbers. */
export function recapPosts(i: RecapInput): string[] {
  const tags = `${tag(i.clubName)} ${tag(shortName(i.universityName))} #LawSchool`
  const thanks = i.sponsorName ? ` Huge thanks to ${i.sponsorName} for sponsoring!` : ''
  const offers = i.offersRedeemed ? ` ${i.offersRedeemed} students took advantage of their offer.` : ''
  return [
    `That's a wrap on ${i.eventName}! 🎉 ${i.attendees} students joined us.${thanks}${offers}\n\n${tags}`,
    `${i.attendees} people, one great event. Thanks to everyone who came out to ${i.eventName}${i.sponsorName ? ` and to ${i.sponsorName} for making it possible` : ''}. See you at the next one!\n\n${tags}`,
    `📸 Recap: ${i.eventName} with ${i.clubName}.${thanks} Missed it? Follow us so you don't miss the next event.\n\n${tags}`,
  ]
}
