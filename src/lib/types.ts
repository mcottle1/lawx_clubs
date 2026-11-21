/** 'university_admin' is a COLLEGE (department) admin; 'org_admin' runs a whole university. */
export type Role = 'club' | 'partner' | 'university_admin' | 'org_admin' | 'site_admin'

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
  /** What the university calls its units. */
  unit_label: UnitLabel
}

export type UnitLabel = 'College' | 'School' | 'Department'

/** A college/school/department inside a university; clubs belong to one. */
export interface Department {
  id: string
  university_id: string
  name: string
  is_participating: boolean
  created_at: string
}

export interface DepartmentSettings {
  department_id: string
  scheduling_url: string | null
  scheduling_instructions: string | null
  require_message_approval: boolean
  require_opportunity_approval: boolean
  require_proposal_approval: boolean
}

export interface AdminRow {
  id: string
  user_id: string
  email: string
  created_at: string
}

export interface Club {
  id: string
  user_id: string
  university_id: string
  department_id: string
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

/** Fields shared by things a university admin reviews (opportunities, first messages). */
export interface Reviewable {
  approval_status: ApprovalStatus
  review_note: string | null
}

/** 'changes_requested' = sent back to the requester with a note. */
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'changes_requested'
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
  reviewed_at: string | null
  reviewed_by: string | null
  /** Sign-offs for multi-person approval (null = not signed). */
  details_signed_by: string | null
  details_signed_at: string | null
  flyer_signed_by: string | null
  flyer_signed_at: string | null
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
  source: 'manual' | 'roster' | 'members'
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
export type ProposalStatus =
  | 'pending_review' | 'pending_club' | 'declined' | 'pending_admin' | 'approved' | 'denied' | 'withdrawn' | 'changes_requested'

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
  approval_status: ApprovalStatus
  review_note: string | null
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
  department_id: string
  department_name: string
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
  department_id: string
  department_name: string
  reviewed_at: string | null
  reviewed_by: string | null
  /** The partnership part's sign-off (final approval). */
  signed_by: string | null
  signed_at: string | null
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
  approval_status: ApprovalStatus
  review_note: string | null
  department_name: string
}

/** A club's first message to a partner, as the university admin reviews it. */
export interface MessageReview {
  id: string
  subject: string
  club_id: string
  partner_id: string
  event_id: string | null
  approval_status: ApprovalStatus
  review_note: string | null
  submitted_at: string
  reviewed_at: string | null
  club_name: string
  partner_name: string
  partner_category: PartnerCategory
  partner_city: string
  partner_state: string
  event_name: string | null
  body: string | null
  department_id: string
  department_name: string
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
  department_name: string
}

export type ReceiptStatus = 'pending' | 'approved' | 'reimbursed' | 'denied'

export interface Receipt {
  id: string
  club_id: string
  event_id: string
  event_report_id: string
  storage_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  amount: number
  description: string | null
  status: ReceiptStatus
  admin_note: string | null
  reviewed_at: string | null
  reimbursed_at: string | null
  created_at: string
}

export interface PartnerEventResult {
  event_id: string
  event_name: string
  starts_at: string
  time_zone: string
  club_name: string
  university_name: string
  attendees: number
  offers_redeemed: number | null
  notes: string | null
  submitted_at: string
  department_name: string
}

export interface ClubMember {
  id: string
  club_id: string
  name: string
  email: string
  email_key: string
  /** Free-text leadership role; null = regular member. */
  role: string | null
  joined_on: string
  created_at: string
  updated_at: string
}

export type MemberEmailStatus = 'sent' | 'partial' | 'failed' | 'skipped'

export interface MemberEmail {
  id: string
  club_id: string
  audience: 'all' | 'leadership'
  subject: string
  body: string
  recipient_count: number
  delivered_count: number
  attachment_names: string[]
  /** Whether the club's own address got its copy. */
  club_copy: boolean
  status: MemberEmailStatus
  error: string | null
  created_at: string
}
