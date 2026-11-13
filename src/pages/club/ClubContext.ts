import { createContext, useContext } from 'react'
import type { Club, UniversityAdmin } from '../../lib/types'

export interface ClubInfo {
  club: Club
  universityName: string
  universityCity: string | null
  universityState: string | null
  /** The university admin's scheduling link/instructions (null if none yet). */
  scheduling: Pick<UniversityAdmin, 'scheduling_url' | 'scheduling_instructions'> | null
  userId: string
  refreshClub: () => Promise<void>
}

export const ClubContext = createContext<ClubInfo | null>(null)

export function useClub(): ClubInfo {
  const ctx = useContext(ClubContext)
  if (!ctx) throw new Error('useClub must be used inside the club layout')
  return ctx
}
