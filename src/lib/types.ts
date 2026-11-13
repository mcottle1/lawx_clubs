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

export type SupportType = 'food' | 'funding' | 'in_kind' | 'speaker' | 'other'
export type OpportunityStatus = 'open' | 'filled' | 'closed'
export type ProposalStatus = 'pending_club' | 'declined' | 'pending_admin' | 'approved' | 'denied' | 'withdrawn'

export interface Opportunity {
  id: string
  club_id: string
  event_id: string | null
  title: string
  description: string
  support_type: SupportType
  amount_sought: number | null
  photo_path: string | null
  status: OpportunityStatus
  created_at: string
}

/** Row of the opportunity_cards view (no budgets). */
export interface OpportunityCard extends Opportunity {
  club_name: string
  club_logo_path: string | null
  university_id: string
  university_name: string
  university_city: string | null
  university_state: string | null
  event_name: string | null
  event_starts_at: string | null
  event_time_zone: string | null
}

/** Row of the proposal_details view. */
export interface ProposalDetail {
  id: string
  club_id: string
  partner_id: string
  opportunity_id: string | null
  event_id: string | null
  conversation_id: string | null
  headcount: number | null
  amount: number | null
  in_kind: string | null
  student_offer: string | null
  pitch_minutes: number | null
  message: string | null
  status: ProposalStatus
  denial_reason: string | null
  created_at: string
  updated_at: string
  partner_name: string
  partner_logo_path: string | null
  partner_email: string
  partner_category: PartnerCategory
  club_name: string
  university_id: string
  university_name: string
  opportunity_title: string | null
  event_name: string | null
  event_starts_at: string | null
  event_time_zone: string | null
  event_approval_status: ApprovalStatus | null
}

export interface ConversationListItem {
  id: string
  subject: string
  club_id: string
  partner_id: string
  event_id: string | null
  opportunity_id: string | null
  started_by: 'club' | 'partner'
  created_at: string
  last_message_at: string
  club_name: string
  club_email: string
  club_logo_path: string | null
  university_name: string
  partner_name: string
  partner_email: string
  partner_logo_path: string | null
  unread: boolean
  last_message: string | null
}

export interface Message {
  id: string
  conversation_id: string
  sender_user_id: string | null
  sender_role: 'club' | 'partner' | 'system'
  body: string
  created_at: string
}

/** Row of the partner_events view (no budget). */
export interface PartnerEvent {
  id: string
  name: string
  starts_at: string
  ends_at: string
  time_zone: string
  description: string
  location: string | null
  flyer_path: string | null
  approval_status: ApprovalStatus
  partner_id: string | null
  club_id: string
  club_name: string
  university_name: string
}
