import { createContext, useContext } from 'react'
import type { Partner } from '../../lib/types'

export interface PartnerInfo {
  partner: Partner
  userId: string
  refreshPartner: () => Promise<void>
}

export const PartnerContext = createContext<PartnerInfo | null>(null)

export function usePartner(): PartnerInfo {
  const ctx = useContext(PartnerContext)
  if (!ctx) throw new Error('usePartner must be used inside the partner layout')
  return ctx
}
