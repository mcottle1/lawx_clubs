import { createContext, useContext } from 'react'
import type { Club, DepartmentSettings, UnitLabel } from '../../lib/types'

export interface ClubInfo {
  club: Club
  universityName: string
  /** The club's college (department) and what the university calls it. */
  departmentName: string
  unitLabel: UnitLabel
  universityCity: string | null
  universityState: string | null
  /** The college's room-booking link/instructions (null if none yet). */
  scheduling: Pick<DepartmentSettings, 'scheduling_url' | 'scheduling_instructions'> | null
  /** What the university requires approval for (affects wording only; the database enforces it). */
  approvals: { message: boolean; opportunity: boolean }
  userId: string
  refreshClub: () => Promise<void>
}

export const ClubContext = createContext<ClubInfo | null>(null)

export function useClub(): ClubInfo {
  const ctx = useContext(ClubContext)
  if (!ctx) throw new Error('useClub must be used inside the club layout')
  return ctx
}
