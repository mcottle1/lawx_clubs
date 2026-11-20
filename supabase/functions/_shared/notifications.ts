// Email helpers shared by `notify` (event-driven) and `run-daily-jobs` (scheduled).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { siteUrl } from './clients.ts'
import { sendEmail, type EmailInput, type EmailStatus } from './email.ts'

export const link = (route: string) => `${siteUrl()}#${route}`

/** "Wed, Nov 25, 12:00 PM" in the event's own time zone. */
export function when(startsAt: string, timeZone: string): string {
  return new Date(startsAt).toLocaleString('en-US', {
    timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

/**
 * Who handles a club's approvals: every active admin of the club's college,
 * or the university's organization admins when the college has no admin.
 */
export async function adminEmailsFor(db: SupabaseClient, clubId: string): Promise<string[]> {
  const { data: club } = await db.from('clubs').select('university_id, department_id').eq('id', clubId).single()
  if (!club) return []
  const active = async (rows: { user_id: string; email: string }[] | null) => {
    if (!rows?.length) return []
    const { data: profiles } = await db.from('profiles').select('user_id').in('user_id', rows.map((r) => r.user_id)).eq('is_active', true)
    const ok = new Set((profiles ?? []).map((p) => p.user_id))
    return rows.filter((r) => ok.has(r.user_id)).map((r) => r.email)
  }
  const { data: deptAdmins } = await db.from('department_admins').select('user_id, email').eq('department_id', club.department_id)
  const emails = await active(deptAdmins)
  if (emails.length) return emails
  const { data: orgAdmins } = await db.from('org_admins').select('user_id, email').eq('university_id', club.university_id)
  return active(orgAdmins)
}

/** Sends the same email to each of the club's admins (de-duplicated per address). */
export async function emailAdmins(
  db: SupabaseClient,
  clubId: string,
  input: Omit<EmailInput, 'to'> & { dedupeKey: string },
): Promise<EmailStatus | 'no_admin'> {
  const to = await adminEmailsFor(db, clubId)
  if (!to.length) return 'no_admin'
  let status: EmailStatus = 'skipped'
  for (const email of to) {
    const s = await sendEmail(db, { ...input, to: email, dedupeKey: `${input.dedupeKey}:${email}` })
    if (s === 'sent' || (s === 'failed' && status !== 'sent')) status = s
  }
  return status
}

/** "Approval needed" email to the club's admins for a pending event. */
export async function notifyAdminOfEvent(db: SupabaseClient, eventId: string): Promise<EmailStatus | 'not_pending' | 'no_admin'> {
  const { data: ev } = await db.from('events')
    .select('id, name, club_id, approval_status, updated_at, starts_at, time_zone, partner_id, clubs(name)')
    .eq('id', eventId).single()
  if (!ev || ev.approval_status !== 'pending') return 'not_pending'
  // deno-lint-ignore no-explicit-any
  const clubName = (ev as any).clubs?.name ?? 'A club'
  return emailAdmins(db, ev.club_id, {
    template: 'pending_approval', relatedId: ev.id,
    dedupeKey: `pending_event:${ev.id}:${ev.updated_at}`,
    subject: `Approval needed: ${ev.name}`,
    text: `${clubName} submitted "${ev.name}" (${when(ev.starts_at, ev.time_zone)})${ev.partner_id ? ', including a partnership' : ''} for approval.\n\nReview it here:\n${link('/university-admin')}\n`,
  })
}
