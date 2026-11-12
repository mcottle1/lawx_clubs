import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Profile } from '../lib/types'

export interface AuthState {
  /** True until the initial session (and profile, if logged in) has loaded. */
  loading: boolean
  session: Session | null
  /** null when logged out, or when the account has no profile (e.g. half-finished admin setup). */
  profile: Profile | null
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
