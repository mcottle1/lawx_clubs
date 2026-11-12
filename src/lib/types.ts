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
