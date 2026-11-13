/** Turns a Supabase sign-up error into a message a user (or the site owner) can act on. */
export function signUpErrorMessage(error: { message: string; code?: string; status?: number }): string {
  const m = error.message
  if (/registered|already exists/i.test(m)) return 'An account with this email already exists. Try logging in.'
  if (/rate limit/i.test(m)) return 'Too many sign-up emails were sent recently. Please wait a while and try again.'
  if (/sending confirmation email/i.test(m)) {
    return "We couldn't send the confirmation email. (Site owner: check Supabase email settings — README step 7.)"
  }
  if (/Database error saving new user/i.test(m)) {
    return 'The server rejected the sign-up details. Check the form and try again. (Site owner: check Supabase → Logs → Postgres for the reason.)'
  }
  // Password rules, invalid email, signups disabled, etc. — Supabase's own wording is clear enough.
  return `Sign-up failed: ${m}`
}
