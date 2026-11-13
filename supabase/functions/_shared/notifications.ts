// Email helpers shared by `notify` (event-driven) and `run-daily-jobs` (scheduled).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { siteUrl } from './clients.ts'
import { sendEmail, type EmailStatus } from './email.ts'

export const link = (route: string) => `${siteUrl()}#${route}`

/** "Wed, Nov 25, 12:00 PM" in the event's own time zone. */
export function when(startsAt: string, timeZone: string): string {
  return new Date(startsAt).toLocaleString('en-US', {
    timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

/** The active university admin's contact email for a club, or null. */
export async function adminEmailFor(db: SupabaseClient, clubId: string): Promise<string | null> {
  const { data: club } = await db.from('clubs').select('university_id').eq('id', clubId).single()
  const { data: admin } = await db.from('university_admins').select('contact_email, user_id')
    .eq('university_id', club?.university_id).maybeSingle()
  if (!admin) return null
  const { data: profile } = await db.from('profiles').select('is_active').eq('user_id', admin.user_id).single()
  return profile?.is_active ? admin.contact_email : null
}

/** "Approval needed" email to the university admin for a pending event. */
export async function notifyAdminOfEvent(db: SupabaseClient, eventId: string): Promise<EmailStatus | 'not_pending' | 'no_admin'> {
  const { data: ev } = await db.from('events')
    .select('id, name, club_id, approval_status, updated_at, starts_at, time_zone, partner_id, clubs(name)')
    .eq('id', eventId).single()
  if (!ev || ev.approval_status !== 'pending') return 'not_pending'
  const to = await adminEmailFor(db, ev.club_id)
  if (!to) return 'no_admin'
  // deno-lint-ignore no-explicit-any
  const clubName = (ev as any).clubs?.name ?? 'A club'
  return sendEmail(db, {
    to, template: 'pending_approval', relatedId: ev.id,
    dedupeKey: `pending_event:${ev.id}:${ev.updated_at}`,
    subject: `Approval needed: ${ev.name}`,
    text: `${clubName} submitted "${ev.name}" (${when(ev.starts_at, ev.time_zone)})${ev.partner_id ? ', including a partnership' : ''} for approval.\n\nReview it here:\n${link('/university-admin')}\n`,
  })
}
