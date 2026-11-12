import { Navigate } from 'react-router-dom'
import { ROLE_HOME } from '../lib/constants'
import { Spinner } from '../components/ui'
import { useAuth } from './AuthContext'
import AccountProblem from './AccountProblem'

/** /dashboard → the home page for the user's role. */
export default function DashboardRedirect() {
  const { loading, session, profile } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  if (!profile || !profile.is_active) return <AccountProblem />
  return <Navigate to={ROLE_HOME[profile.role]} replace />
}
