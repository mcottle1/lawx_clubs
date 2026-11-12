import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ROLE_HOME } from '../lib/constants'
import type { Role } from '../lib/types'
import { Spinner } from '../components/ui'
import { useAuth } from './AuthContext'
import AccountProblem from './AccountProblem'

/** Renders children only for logged-in, active users with one of the given roles. */
export default function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { loading, session, profile } = useAuth()
  const location = useLocation()

  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!profile || !profile.is_active) return <AccountProblem />
  if (!roles.includes(profile.role)) return <Navigate to={ROLE_HOME[profile.role]} replace />
  return <>{children}</>
}
