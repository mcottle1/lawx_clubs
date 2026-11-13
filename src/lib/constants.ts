import type { InstitutionType, PartnerCategory, Role } from './types'

export const MIN_PASSWORD_LENGTH = 8

/** Upload limits (the storage buckets enforce the same limits server-side). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export const PARTNER_CATEGORIES: { value: PartnerCategory; label: string }[] = [
  { value: 'law_firm', label: 'Law firm' },
  { value: 'bar_prep', label: 'Bar prep / test prep' },
  { value: 'restaurant_catering', label: 'Restaurant / catering' },
  { value: 'legal_tech', label: 'Legal tech' },
  { value: 'nonprofit', label: 'Nonprofit' },
  { value: 'other', label: 'Other' },
]

export const INSTITUTION_TYPE_LABELS: Record<InstitutionType, string> = {
  university: 'University / college',
  law_school: 'Law school',
  medical_school: 'Medical school',
  graduate_school: 'Graduate school',
  community_college: 'Community college',
  other: 'Other',
}

export const ROLE_LABELS: Record<Role, string> = {
  club: 'Club',
  partner: 'Partner',
  university_admin: 'University admin',
  site_admin: 'Site admin',
}

/** Where each role lands after logging in. */
export const ROLE_HOME: Record<Role, string> = {
  club: '/club',
  partner: '/partner',
  university_admin: '/university-admin',
  site_admin: '/site-admin',
}

export const US_STATES: [string, string][] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'],
  ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'],
  ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'], ['PR', 'Puerto Rico'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'],
  ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
]

export const SUPPORT_TYPES: { value: import('./types').SupportType; label: string }[] = [
  { value: 'food', label: 'Food / catering' },
  { value: 'funding', label: 'Funding' },
  { value: 'in_kind', label: 'In-kind (supplies, prizes, swag)' },
  { value: 'speaker', label: 'Speaker / presentation' },
  { value: 'other', label: 'Other' },
]

export const supportLabel = (v: string) => SUPPORT_TYPES.find((s) => s.value === v)?.label ?? v
export const categoryLabel = (v: string) => PARTNER_CATEGORIES.find((c) => c.value === v)?.label ?? v
