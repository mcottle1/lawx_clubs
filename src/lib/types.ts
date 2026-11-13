export type Role = 'club' | 'partner' | 'university_admin' | 'site_admin'

export type InstitutionType =
  | 'university' | 'law_school' | 'medical_school' | 'graduate_school' | 'community_college' | 'other'

export type PartnerCategory =
  | 'law_firm' | 'bar_prep' | 'restaurant_catering' | 'legal_tech' | 'nonprofit' | 'other'

export interface Profile {
  user_id: string
  role: Role
  is_active: boolean
}

export interface University {
  id: string
  name: string
  city: string | null
  state: string | null
  type: InstitutionType
  is_participating: boolean
}

export interface Club {
  id: string
  user_id: string
  university_id: string
  name: string
  email: string
  description: string
  initial_budget: number
  budget_year_start: string
  logo_path: string | null
  social_links: { instagram?: string; tiktok?: string; website?: string }
}

export interface Partner {
  id: string
  user_id: string
  name: string
  email: string
  city: string
  state: string
  category: PartnerCategory
  description: string
  offer_description: string
  open_to_sponsorships: boolean
  logo_path: string | null
  website: string | null
}

export interface UniversityAdmin {
  id: string
  user_id: string
  university_id: string
  contact_email: string
  scheduling_url: string | null
  scheduling_instructions: string | null
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied'
export type ClubFileType = 'flyer' | 'logo' | 'constitution' | 'other'

export interface ClubEvent {
  id: string
  club_id: string
  name: string
  starts_at: string
  ends_at: string
  time_zone: string
  description: string
  location: string | null
  partner_id: string | null
  outside_sponsor_name: string | null
  potential_sponsor_notes: string | null
  flyer_path: string | null
  budget: number
  approval_status: ApprovalStatus
  denial_reason: string | null
  partner_reminder_days: number | null
  location_reminder_days: number | null
  created_at: string
}

export interface EventReport {
  id: string
  event_id: string
  attendees: number
  amount_spent: number
  offers_redeemed: number | null
  notes: string | null
  submitted_at: string
}

export interface Todo {
  id: string
  club_id: string
  title: string
  due_on: string | null
  done: boolean
  done_at: string | null
  source: 'manual' | 'system'
  system_kind: string | null
  related_event_id: string | null
  created_at: string
}

export interface ClubFile {
  id: string
  club_id: string
  file_type: ClubFileType
  bucket: 'logos' | 'flyers' | 'club-docs'
  storage_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  event_id: string | null
  created_at: string
}

export interface MemberCount {
  id: string
  club_id: string
  count: number
  recorded_on: string
  source: 'manual' | 'roster'
}

export interface BudgetSummary {
  club_id: string
  initial_budget: number
  budget_year_start: string
  spent: number
  reported_events: number
  remaining: number
}
