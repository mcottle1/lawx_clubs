import { Alert, Button, Card } from '../components/ui'
import { useAuth } from './AuthContext'

/** Shown to logged-in users whose account is deactivated or has no profile. */
export default function AccountProblem() {
  const { profile, signOut } = useAuth()
  const deactivated = profile && !profile.is_active
  return (
    <Card className="mx-auto max-w-md">
      <h1 className="text-lg font-semibold">{deactivated ? 'Account deactivated' : 'Account not set up'}</h1>
      <Alert kind="warning" className="mt-3">
        {deactivated
          ? 'This account has been deactivated by a site administrator. Contact them if you think this is a mistake.'
          : 'This login is not linked to a club, partner, or administrator account. If you were invited as a university administrator, use the link in your invite email.'}
      </Alert>
      <Button className="mt-4" variant="secondary" onClick={() => void signOut()}>
        Log out
      </Button>
    </Card>
  )
}
