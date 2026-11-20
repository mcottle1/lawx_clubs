import { createContext, useContext } from 'react'
import type { AdminRow, Department, UnitLabel } from '../../lib/types'

export interface PendingInvite { id: string; email: string; department_id: string | null; expires_at: string }

export interface OrgInfo {
  university: { id: string; name: string; unit_label: UnitLabel }
  departments: Department[]
  /** College admins by college id. */
  admins: Record<string, AdminRow[]>
  /** Club counts by college id. */
  clubCounts: Record<string, number>
  invites: PendingInvite[]
  /** Colleges with no admin, where the organization admin approves instead. */
  actsFor: Set<string>
  refresh: () => Promise<void>
}

export const OrgContext = createContext<OrgInfo | null>(null)

export function useOrg(): OrgInfo {
  const ctx = useContext(OrgContext)
  if (!ctx) throw new Error('useOrg must be used inside the organization admin layout')
  return ctx
}
