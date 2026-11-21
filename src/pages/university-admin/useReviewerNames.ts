import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

/**
 * Maps an admin's user id to their email for "decided by" lines. Only admins
 * the viewer may see are known (college co-admins; for organization admins,
 * every college's admins); anyone else shows as "a university administrator".
 */
export function useReviewerNames(): (userId: string | null | undefined) => string {
  const [map, setMap] = useState<Record<string, string>>({})
  useEffect(() => {
    void Promise.all([
      supabase.from('department_admins').select('user_id, email'),
      supabase.from('org_admins').select('user_id, email'),
    ]).then(([d, o]) => {
      const m: Record<string, string> = {}
      for (const r of [...(d.data ?? []), ...(o.data ?? [])]) m[r.user_id] = r.email
      setMap(m)
    })
  }, [])
  return (userId) => (userId ? map[userId] ?? 'a university administrator' : '—')
}
