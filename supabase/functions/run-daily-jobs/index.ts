// Daily scheduled job. Called once a day by the GitHub Actions workflow
// (.github/workflows/daily-jobs.yml) with the shared secret:
//
//   POST /functions/v1/run-daily-jobs        header  x-cron-secret: <CRON_SECRET>
//   POST /functions/v1/run-daily-jobs?dry_run=1   → report what would happen, change nothing
//
// Jobs (all idempotent — safe to run twice on the same day):
//   1. "Find a sponsor" reminders  (events.partner_reminder_days)
//   2. "Book a room" reminders     (events.location_reminder_days, with the university's
//                                   scheduling link/instructions)
//   3. Post-event report request    (the day after the event) + "Submit report" to-do
//   4. One report reminder          (3 days after the request, if still no report)
//   5. Close leftover "find a sponsor"/"book a room" to-dos once an event has passed
//   6. Catch-up: re-send "approval needed" emails the browser didn't trigger
//
// Each email is recorded in email_log with a dedupe key, and the events table
// keeps *_sent_at / report_requested_at stamps, so nothing is sent twice.
import { adminClient } from '../_shared/clients.ts'
import { json } from '../_shared/cors.ts'
import { sendEmail } from '../_shared/email.ts'
import { link, notifyAdminOfEvent, when } from '../_shared/notifications.ts'

const DAY = 24 * 60 * 60 * 1000

/** YYYY-MM-DD for an instant in a given IANA time zone. */
function localDate(d: Date, timeZone: string): string {
  return d.toLocaleDateString('en-CA', { timeZone })
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

interface EventRow {
  id: string
  name: string
  club_id: string
  starts_at: string
  ends_at: string
  time_zone: string
  approval_status: string
  partner_id: string | null
  outside_sponsor_name: string | null
  location: string | null
  partner_reminder_days: number | null
  location_reminder_days: number | null
  partner_reminder_sent_at: string | null
  location_reminder_sent_at: string | null
  report_requested_at: string | null
  report_reminder_sent_at: string | null
  created_at: string
  clubs: { name: string; email: string; university_id: string } | null
  event_reports: { id: string }[] | { id: string } | null
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET')
  const given = req.headers.get('x-cron-secret') ?? ''
  if (!secret || !safeEqual(given, secret)) return json({ error: 'Unauthorized' }, 401)

  const dryRun = new URL(req.url).searchParams.get('dry_run') === '1'
  const now = new Date()
  const db = adminClient()
  const actions: string[] = []
  const counts = { partner_reminders: 0, location_reminders: 0, report_requests: 0, report_reminders: 0, todos_closed: 0, approval_catchups: 0 }

  const select = 'id, name, club_id, starts_at, ends_at, time_zone, approval_status, partner_id, outside_sponsor_name, location, ' +
    'partner_reminder_days, location_reminder_days, partner_reminder_sent_at, location_reminder_sent_at, ' +
    'report_requested_at, report_reminder_sent_at, created_at, clubs(name, email, university_id), event_reports(id)'

  // ---------------------------------------------------------------- 1 & 2
  const { data: upcoming, error: upErr } = await db.from('events').select(select)
    .gt('starts_at', now.toISOString()).neq('approval_status', 'denied')
  if (upErr) return json({ error: upErr.message }, 500)

  const schedulingCache = new Map<string, { scheduling_url: string | null; scheduling_instructions: string | null } | null>()
  async function schedulingFor(universityId: string) {
    if (!schedulingCache.has(universityId)) {
      const { data } = await db.from('university_admins').select('scheduling_url, scheduling_instructions')
        .eq('university_id', universityId).maybeSingle()
      schedulingCache.set(universityId, data ?? null)
    }
    return schedulingCache.get(universityId)!
  }

  for (const e of (upcoming ?? []) as unknown as EventRow[]) {
    if (!e.clubs) continue
    const today = localDate(now, e.time_zone)
    const eventDay = localDate(new Date(e.starts_at), e.time_zone)

    const needsSponsor = !e.partner_id && !e.outside_sponsor_name
    if (needsSponsor && e.partner_reminder_days && !e.partner_reminder_sent_at && today >= addDays(eventDay, -e.partner_reminder_days)) {
      actions.push(`partner reminder → ${e.clubs.email} (${e.name})`)
      counts.partner_reminders++
      if (!dryRun) {
        await sendEmail(db, {
          to: e.clubs.email, template: 'partner_reminder', relatedId: e.id, dedupeKey: `partner_reminder:${e.id}`,
          subject: `Reminder: find a sponsor for ${e.name}`,
          text: `"${e.name}" (${when(e.starts_at, e.time_zone)}) doesn't have a sponsor yet.\n\nBrowse partners and post an opportunity:\n${link('/club/partnerships')}\n`,
        })
        await db.from('events').update({ partner_reminder_sent_at: now.toISOString() }).eq('id', e.id)
      }
    }

    if (!e.location && e.location_reminder_days && !e.location_reminder_sent_at && today >= addDays(eventDay, -e.location_reminder_days)) {
      actions.push(`location reminder → ${e.clubs.email} (${e.name})`)
      counts.location_reminders++
      if (!dryRun) {
        const s = await schedulingFor(e.clubs.university_id)
        const how = [
          s?.scheduling_url ? `Book a room here: ${s.scheduling_url}` : null,
          s?.scheduling_instructions ? `How to book a room:\n${s.scheduling_instructions}` : null,
        ].filter(Boolean).join('\n\n') || 'Contact your university to book a room.'
        await sendEmail(db, {
          to: e.clubs.email, template: 'location_reminder', relatedId: e.id, dedupeKey: `location_reminder:${e.id}`,
          subject: `Reminder: book a room for ${e.name}`,
          text: `"${e.name}" (${when(e.starts_at, e.time_zone)}) doesn't have a location yet.\n\n${how}\n\nThen add the location to your event:\n${link(`/club/events/${e.id}/edit`)}\n`,
        })
        await db.from('events').update({ location_reminder_sent_at: now.toISOString() }).eq('id', e.id)
      }
    }
  }

  // ---------------------------------------------------------------- 3 & 4
  // Approved events that ended in the last 60 days and have no report.
  const { data: ended, error: endErr } = await db.from('events').select(select)
    .lt('ends_at', now.toISOString()).gt('ends_at', new Date(now.getTime() - 60 * DAY).toISOString())
    .eq('approval_status', 'approved')
  if (endErr) return json({ error: endErr.message }, 500)

  for (const e of (ended ?? []) as unknown as EventRow[]) {
    const hasReport = Array.isArray(e.event_reports) ? e.event_reports.length > 0 : !!e.event_reports
    if (hasReport || !e.clubs) continue
    const today = localDate(now, e.time_zone)
    const endDay = localDate(new Date(e.ends_at), e.time_zone)
    if (today <= endDay) continue // wait until the day after the event
    const reportLink = link(`/club/events/${e.id}/report`)

    if (!e.report_requested_at) {
      actions.push(`report request → ${e.clubs.email} (${e.name})`)
      counts.report_requests++
      if (!dryRun) {
        await sendEmail(db, {
          to: e.clubs.email, template: 'report_request', relatedId: e.id, dedupeKey: `report_request:${e.id}`,
          subject: `How did ${e.name} go?`,
          text: `Please report on "${e.name}": attendance, what you spent (it's deducted from your budget), any offers redeemed, notes, and receipts for reimbursement.\n\nSubmit your report:\n${reportLink}\n`,
        })
        await db.from('events').update({ report_requested_at: now.toISOString() }).eq('id', e.id)
        const { data: existing } = await db.from('todos').select('id')
          .eq('related_event_id', e.id).eq('system_kind', 'submit_report').maybeSingle()
        if (!existing) {
          await db.from('todos').insert({
            club_id: e.club_id, title: `Submit report for ${e.name}`, due_on: addDays(today, 3),
            source: 'system', system_kind: 'submit_report', related_event_id: e.id,
          })
        }
      }
    } else if (!e.report_reminder_sent_at && now.getTime() - new Date(e.report_requested_at).getTime() >= 3 * DAY - 60 * 60 * 1000) {
      // (an hour of slack so a daily run at a slightly earlier time still counts as "3 days")
      actions.push(`report reminder → ${e.clubs.email} (${e.name})`)
      counts.report_reminders++
      if (!dryRun) {
        await sendEmail(db, {
          to: e.clubs.email, template: 'report_reminder', relatedId: e.id, dedupeKey: `report_reminder:${e.id}`,
          subject: `Reminder: report for ${e.name}`,
          text: `We haven't received your report for "${e.name}" yet. It only takes a minute:\n${reportLink}\n`,
        })
        await db.from('events').update({ report_reminder_sent_at: now.toISOString() }).eq('id', e.id)
      }
    }
  }

  // ---------------------------------------------------------------- 5
  const { data: stale } = await db.from('todos').select('id, events!inner(starts_at)')
    .eq('done', false).in('system_kind', ['find_sponsor', 'book_room']).lt('events.starts_at', now.toISOString())
  counts.todos_closed = stale?.length ?? 0
  if (counts.todos_closed) actions.push(`closed ${counts.todos_closed} leftover sponsor/room to-dos`)
  if (!dryRun && stale?.length) {
    await db.from('todos').update({ done: true }).in('id', stale.map((t) => t.id))
  }

  // ---------------------------------------------------------------- 6
  const { data: pending } = await db.from('events').select('id, name, created_at')
    .eq('approval_status', 'pending').gt('starts_at', now.toISOString())
    .lt('updated_at', new Date(now.getTime() - 60 * 60 * 1000).toISOString())
  for (const e of pending ?? []) {
    const { count } = await db.from('email_log').select('id', { count: 'exact', head: true })
      .like('dedupe_key', `pending_event:${e.id}:%`)
    if (count) continue
    actions.push(`approval catch-up (${e.name})`)
    counts.approval_catchups++
    if (!dryRun) await notifyAdminOfEvent(db, e.id)
  }

  return json({ ok: true, dry_run: dryRun, ran_at: now.toISOString(), counts, actions })
})
