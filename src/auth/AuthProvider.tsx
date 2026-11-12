import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'
import { AuthContext } from './AuthContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileFor, setProfileFor] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionLoaded(true)
    })
    // Don't call other Supabase methods inside this callback (can deadlock);
    // the profile is loaded by the effect below instead.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null

  const loadProfile = useCallback(async (id: string | null) => {
    if (!id) {
      setProfile(null)
      setProfileFor(null)
      return
    }
    const { data } = await supabase.from('profiles').select('user_id, role, is_active').eq('user_id', id).maybeSingle()
    setProfile((data as Profile | null) ?? null)
    setProfileFor(id)
  }, [])

  useEffect(() => {
    void loadProfile(userId)
  }, [userId, loadProfile])

  const value = useMemo(
    () => ({
      loading: !sessionLoaded || (userId !== null && profileFor !== userId),
      session,
      profile,
      refreshProfile: () => loadProfile(userId),
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }),
    [sessionLoaded, userId, profileFor, session, profile, loadProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
