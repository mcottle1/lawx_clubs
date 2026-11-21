import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../lib/supabase'

/** The parts of a request each college admin can be responsible for. */
export type ApprovalPart = 'event' | 'flyer' | 'partnership' | 'receipts'

export const PART_LABEL: Record<ApprovalPart, string> = {
  event: 'Event details', flyer: 'Flyer', partnership: 'Partnership', receipts: 'Receipts',
}
export const PART_COLUMN = {
  event: 'can_approve_events', flyer: 'can_approve_flyers', partnership: 'can_approve_partnerships', receipts: 'can_review_receipts',
} as const

export interface CollegeAdmin {
  user_id: string
  email: string
  department_id: string
  can_approve_events: boolean
  can_approve_flyers: boolean
  can_approve_partnerships: boolean
  can_review_receipts: boolean
}

export interface ApprovalParts {
  loaded: boolean
  /** Whether the signed-in admin can sign this part for a college (the server checks again). */
  canSign: (departmentId: string, part: ApprovalPart) => boolean
  /** Who is responsible for a part at a college (empty = any of its admins). */
  holders: (departmentId: string, part: ApprovalPart) => string[]
  admins: CollegeAdmin[]
  reload: () => void
}

/**
 * Mirrors the database rule: a college admin signs the parts they're assigned,
 * plus any part no one at their college is assigned; an organization admin
 * (stepping in for a college without admins) signs everything.
 */
export function useApprovalParts(): ApprovalParts {
  const { session } = useAuth()
  const me = session?.user.id
  const [admins, setAdmins] = useState<CollegeAdmin[] | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    supabase.from('department_admins')
      .select('user_id, email, department_id, can_approve_events, can_approve_flyers, can_approve_partnerships, can_review_receipts')
      .order('created_at')
      .then(({ data }) => setAdmins((data as CollegeAdmin[]) ?? []))
  }, [version])

  const list = admins ?? []
  const mine = list.find((a) => a.user_id === me)
  const holders = (departmentId: string, part: ApprovalPart) =>
    list.filter((a) => a.department_id === departmentId && a[PART_COLUMN[part]]).map((a) => a.email)
  return {
    loaded: admins !== null,
    admins: list,
    holders,
    canSign: (departmentId, part) => {
      if (!mine) return true // organization admin: only shown actions for colleges without admins
      if (mine.department_id !== departmentId) return false
      return mine[PART_COLUMN[part]] || holders(departmentId, part).length === 0
    },
    reload: () => setVersion((v) => v + 1),
  }
}
