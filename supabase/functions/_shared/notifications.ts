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

export type ApprovalPart = 'event' | 'flyer' | 'partnership' | 'receipts'
const PART_COLUMN: Record<ApprovalPart, string> = {
  event: 'can_approve_events', flyer: 'can_approve_flyers', partnership: 'can_approve_partnerships', receipts: 'can_review_receipts',
}

/**
 * Who handles a club's approvals: the active admins of the club's college who
 * are responsible for any of `parts` (for a part nobody is assigned, all of
 * the college's admins), or the university's organization admins when the
 * college has no admin.
 */
export async function adminEmailsFor(db: SupabaseClient, clubId: string, parts: ApprovalPart[] = []): Promise<string[]> {
  const { data: club } = await db.from('clubs').select('university_id, department_id').eq('id', clubId).single()
  if (!club) return []
  const activeIds = async (ids: string[]) => {
    if (!ids.length) return new Set<string>()
    const { data: profiles } = await db.from('profiles').select('user_id').in('user_id', ids).eq('is_active', true)
    return new Set((profiles ?? []).map((p) => p.user_id))
  }
  const { data: deptAdmins } = await db.from('department_admins')
    .select('user_id, email, can_approve_events, can_approve_flyers, can_approve_partnerships, can_review_receipts')
    .eq('department_id', club.department_id)
  const ok = await activeIds((deptAdmins ?? []).map((a) => a.user_id))
  // deno-lint-ignore no-explicit-any
  const admins = ((deptAdmins ?? []) as any[]).filter((a) => ok.has(a.user_id))
  if (admins.length) {
    if (!parts.length) return admins.map((a) => a.email)
    const to = new Set<string>()
    for (const part of parts) {
      const holders = admins.filter((a) => a[PART_COLUMN[part]])
      for (const a of holders.length ? holders : admins) to.add(a.email)
    }
    return [...to]
  }
  const { data: orgAdmins } = await db.from('org_admins').select('user_id, email').eq('university_id', club.university_id)
  const okOrg = await activeIds((orgAdmins ?? []).map((a) => a.user_id))
  return (orgAdmins ?? []).filter((a) => okOrg.has(a.user_id)).map((a) => a.email)
}

/** Sends the same email to each of the club's admins (de-duplicated per address). */
export async function emailAdmins(
  db: SupabaseClient,
  clubId: string,
  input: Omit<EmailInput, 'to'> & { dedupeKey: string },
  parts: ApprovalPart[] = [],
): Promise<EmailStatus | 'no_admin'> {
  const to = await adminEmailsFor(db, clubId, parts)
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
    .select('id, name, club_id, approval_status, updated_at, starts_at, time_zone, partner_id, flyer_path, details_signed_at, flyer_signed_at, clubs(name)')
    .eq('id', eventId).single()
  if (!ev || ev.approval_status !== 'pending') return 'not_pending'
  // Only the people responsible for the parts still waiting.
  const { count: unsignedPartnerships } = await db.from('proposals').select('id', { count: 'exact', head: true })
    .eq('event_id', ev.id).eq('status', 'pending_admin').is('signed_at', null)
  const parts: ApprovalPart[] = [
    ...(!ev.details_signed_at ? ['event' as const] : []),
    ...(ev.flyer_path && !ev.flyer_signed_at ? ['flyer' as const] : []),
    ...(unsignedPartnerships ? ['partnership' as const] : []),
  ]
  // deno-lint-ignore no-explicit-any
  const clubName = (ev as any).clubs?.name ?? 'A club'
  return emailAdmins(db, ev.club_id, {
    template: 'pending_approval', relatedId: ev.id,
    dedupeKey: `pending_event:${ev.id}:${ev.updated_at}`,
    subject: `Approval needed: ${ev.name}`,
    text: `${clubName} submitted "${ev.name}" (${when(ev.starts_at, ev.time_zone)})${ev.partner_id ? ', including a partnership' : ''} for approval.\n\nReview it here:\n${link('/university-admin')}\n`,
  }, parts)
}
