// Sends the email that goes with something the caller just did in the app.
// POST { type, id, kind? }  (called by the browser right after the action succeeds)
//
//   event_submitted    id = event        → university admin: new pending approval
//   message            id = conversation → the other side: new message (max 1/day/thread)
//   proposal_submitted id = proposal     → club: new proposal
//   proposal_responded id = proposal     → partner: accepted/declined (+ admin: pending approval)
//   reviewed           id, kind = 'event' | 'proposal' → club (+ partner): approved/denied
//   report_submitted   id = event        → sponsor: results are in (+ admin: receipts to review)
//   receipt_reviewed   id = receipt      → club: receipt status changed
//
// Every send is checked against what the caller actually did (so this can't
// be used to email arbitrary people) and de-duplicated through email_log.
import { adminClient, userClient } from '../_shared/clients.ts'
import { corsHeaders, errorResponse, json } from '../_shared/cors.ts'
import { sendEmail } from '../_shared/email.ts'
import { adminEmailFor, link, notifyAdminOfEvent } from '../_shared/notifications.ts'

const today = () => new Date().toISOString().slice(0, 10)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405)

  const { data: auth } = await userClient(req).auth.getUser()
  const user = auth?.user
  if (!user) return errorResponse('Not signed in', 401)

  const body = await req.json().catch(() => null)
  const type = String(body?.type ?? '')
  const id = String(body?.id ?? '')
  if (!id) return errorResponse('Missing id')
  const db = adminClient()

  switch (type) {
    case 'event_submitted': {
      const { data: ev } = await db.from('events').select('club_id, clubs(user_id)').eq('id', id).maybeSingle()
      // deno-lint-ignore no-explicit-any
      if (!ev || (ev as any).clubs?.user_id !== user.id) return errorResponse('Not allowed', 403)
      return json({ status: await notifyAdminOfEvent(db, id) })
    }

    case 'message': {
      const { data: conv } = await db.from('conversations')
        .select('id, subject, club_id, partner_id, clubs(name, email, user_id), partners(name, email, user_id)')
        .eq('id', id).maybeSingle()
      if (!conv) return errorResponse('Not found', 404)
      // deno-lint-ignore no-explicit-any
      const c = conv as any
      const side = c.clubs?.user_id === user.id ? 'club' : c.partners?.user_id === user.id ? 'partner' : null
      if (!side) return errorResponse('Not allowed', 403)
      const { data: msg } = await db.from('messages').select('body, created_at').eq('conversation_id', id)
        .eq('sender_user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (!msg) return json({ status: 'skipped' })
      const to = side === 'club' ? c.partners.email : c.clubs.email
      const from = side === 'club' ? c.clubs.name : c.partners.name
      const route = side === 'club' ? `/partner/messages/${id}` : `/club/messages/${id}`
      const preview = msg.body.length > 400 ? msg.body.slice(0, 400) + '…' : msg.body
      const status = await sendEmail(db, {
        to, template: 'new_message', relatedId: id,
        dedupeKey: `message:${id}:${side === 'club' ? 'partner' : 'club'}:${today()}`,
        subject: `New message from ${from}: ${c.subject}`,
        text: `${from} wrote:\n\n${preview}\n\nReply on Law Club Manager:\n${link(route)}\n`,
      })
      return json({ status })
    }

    case 'proposal_submitted': {
      const { data: p } = await db.from('proposals').select('id, club_id, partners(name, user_id), clubs(email), opportunities(title), events(name)').eq('id', id).maybeSingle()
      // deno-lint-ignore no-explicit-any
      const pr = p as any
      if (!pr || pr.partners?.user_id !== user.id) return errorResponse('Not allowed', 403)
      const about = pr.opportunities?.title ?? pr.events?.name ?? 'your club'
      const status = await sendEmail(db, {
        to: pr.clubs.email, template: 'new_proposal', relatedId: id, dedupeKey: `proposal_submitted:${id}`,
        subject: `New sponsorship proposal from ${pr.partners.name}`,
        text: `${pr.partners.name} sent a proposal for "${about}".\n\nReview and accept or decline it here:\n${link('/club/partnerships?tab=proposals')}\n`,
      })
      return json({ status })
    }

    case 'proposal_responded': {
      const { data: p } = await db.from('proposals').select('id, status, club_id, event_id, partners(email), clubs(name, user_id), opportunities(title), events(name, approval_status)').eq('id', id).maybeSingle()
      // deno-lint-ignore no-explicit-any
      const pr = p as any
      if (!pr || pr.clubs?.user_id !== user.id) return errorResponse('Not allowed', 403)
      if (!['pending_admin', 'declined'].includes(pr.status)) return json({ status: 'skipped' })
      const accepted = pr.status === 'pending_admin'
      const about = pr.opportunities?.title ?? pr.events?.name ?? 'their club'
      const status = await sendEmail(db, {
        to: pr.partners.email, template: accepted ? 'proposal_accepted' : 'proposal_declined', relatedId: id,
        dedupeKey: `proposal_responded:${id}:${pr.status}`,
        subject: `${pr.clubs.name} ${accepted ? 'accepted' : 'declined'} your proposal`,
        text: accepted
          ? `${pr.clubs.name} accepted your proposal for "${about}". It now goes to their university for final approval.\n\nSee your proposals:\n${link('/partner/proposals')}\n`
          : `${pr.clubs.name} declined your proposal for "${about}". Thanks for offering!\n\nBrowse other opportunities:\n${link('/partner')}\n`,
      })
      if (accepted) {
        if (pr.event_id && pr.events?.approval_status === 'pending') {
          await notifyAdminOfEvent(db, pr.event_id)
        } else {
          const to = await adminEmailFor(db, pr.club_id)
          if (to) await sendEmail(db, {
            to, template: 'pending_approval', relatedId: id, dedupeKey: `pending_proposal:${id}`,
            subject: `Approval needed: partnership for ${pr.clubs.name}`,
            text: `${pr.clubs.name} accepted a sponsorship for "${about}". It needs your approval.\n\nReview it here:\n${link('/university-admin')}\n`,
          })
        }
      }
      return json({ status })
    }

    case 'reviewed': {
      const kind = body?.kind === 'proposal' ? 'proposal' : 'event'
      const { data: adminRow } = await db.from('university_admins').select('university_id').eq('user_id', user.id).maybeSingle()
      if (!adminRow) return errorResponse('Not allowed', 403)

      let proposals: { id: string; status: string; denial_reason: string | null; partners: { email: string }; clubs: { name: string } }[] = []
      if (kind === 'event') {
        const { data: ev } = await db.from('events').select('id, name, approval_status, denial_reason, reviewed_at, club_id, clubs(name, email, university_id)').eq('id', id).maybeSingle()
        // deno-lint-ignore no-explicit-any
        const e = ev as any
        if (!e || e.clubs?.university_id !== adminRow.university_id || e.approval_status === 'pending') return errorResponse('Not allowed', 403)
        const approved = e.approval_status === 'approved'
        await sendEmail(db, {
          to: e.clubs.email, template: approved ? 'event_approved' : 'event_denied', relatedId: id,
          dedupeKey: `reviewed:event:${id}:${e.reviewed_at}`,
          subject: `${approved ? 'Approved' : 'Not approved'}: ${e.name}`,
          text: approved
            ? `Your event "${e.name}" was approved.\n\nView it here:\n${link(`/club/events/${id}`)}\n`
            : `Your event "${e.name}" was not approved.\nReason: ${e.denial_reason}\n\nYou can edit and resubmit it here:\n${link(`/club/events/${id}`)}\n`,
        })
        // deno-lint-ignore no-explicit-any
        const { data } = await db.from('proposals').select('id, status, denial_reason, partners(email), clubs(name)').eq('event_id', id).eq('reviewed_at', e.reviewed_at) as any
        proposals = data ?? []
      } else {
        // deno-lint-ignore no-explicit-any
        const { data } = await db.from('proposals').select('id, status, denial_reason, partners(email), clubs(name, email, university_id), opportunities(title)').eq('id', id).maybeSingle() as any
        if (!data || data.clubs?.university_id !== adminRow.university_id || !['approved', 'denied'].includes(data.status)) return errorResponse('Not allowed', 403)
        const approved = data.status === 'approved'
        await sendEmail(db, {
          to: data.clubs.email, template: approved ? 'partnership_approved' : 'partnership_denied', relatedId: id,
          dedupeKey: `reviewed:proposal:${id}:club`,
          subject: `Partnership ${approved ? 'approved' : 'not approved'}`,
          text: `Your partnership for "${data.opportunities?.title ?? 'your club'}" was ${approved ? 'approved' : `not approved.\nReason: ${data.denial_reason}`}.\n\nDetails:\n${link('/club/partnerships?tab=proposals')}\n`,
        })
        proposals = [data]
      }
      for (const p of proposals) {
        if (!['approved', 'denied'].includes(p.status)) continue
        const approved = p.status === 'approved'
        await sendEmail(db, {
          to: p.partners.email, template: approved ? 'partnership_approved' : 'partnership_denied', relatedId: p.id,
          dedupeKey: `reviewed:proposal:${p.id}:partner`,
          subject: `Your sponsorship with ${p.clubs.name} was ${approved ? 'approved' : 'not approved'}`,
          text: approved
            ? `The university approved your sponsorship with ${p.clubs.name}. You're all set!\n\nSee it here:\n${link('/partner/proposals')}\n`
            : `The university did not approve your sponsorship with ${p.clubs.name}.\nReason: ${p.denial_reason}\n\nDetails:\n${link('/partner/proposals')}\n`,
        })
      }
      return json({ status: 'ok' })
    }

    case 'report_submitted': {
      const { data: ev } = await db.from('events')
        .select('id, name, club_id, partner_id, clubs(name, user_id), partners(email, name), event_reports(id, attendees, offers_redeemed, notes)')
        .eq('id', id).maybeSingle()
      // deno-lint-ignore no-explicit-any
      const e = ev as any
      if (!e || e.clubs?.user_id !== user.id) return errorResponse('Not allowed', 403)
      const report = Array.isArray(e.event_reports) ? e.event_reports[0] : e.event_reports
      if (!report) return json({ status: 'skipped' })
      const out: Record<string, string> = {}
      if (e.partner_id && e.partners?.email) {
        const lines = [
          `${e.clubs.name} reported on "${e.name}", which you sponsored:`,
          '',
          `Attendees: ${report.attendees}`,
          report.offers_redeemed !== null ? `Offers redeemed: ${report.offers_redeemed}` : null,
          report.notes ? `Notes from the club: ${report.notes}` : null,
          '',
          'See your results and other upcoming opportunities:',
          link('/partner'),
        ].filter((l) => l !== null)
        out.partner = await sendEmail(db, {
          to: e.partners.email, template: 'report_available', relatedId: id, dedupeKey: `report_available:${id}`,
          subject: `Results are in: ${e.name}`,
          text: lines.join('\n') + '\n',
        })
      }
      const { count } = await db.from('receipts').select('id', { count: 'exact', head: true }).eq('event_id', id).eq('status', 'pending')
      if (count) {
        const to = await adminEmailFor(db, e.club_id)
        if (to) {
          out.admin = await sendEmail(db, {
            to, template: 'receipts_submitted', relatedId: id, dedupeKey: `receipts_submitted:${id}:${count}`,
            subject: `Receipts to review: ${e.clubs.name}`,
            text: `${e.clubs.name} submitted ${count} receipt(s) for "${e.name}".\n\nReview them here:\n${link('/university-admin/receipts')}\n`,
          })
        }
      }
      return json(out)
    }

    case 'receipt_reviewed': {
      const { data: r } = await db.from('receipts')
        .select('id, status, amount, admin_note, file_name, club_id, clubs(email, university_id), events(name)')
        .eq('id', id).maybeSingle()
      // deno-lint-ignore no-explicit-any
      const rc = r as any
      const { data: adminRow } = await db.from('university_admins').select('university_id').eq('user_id', user.id).maybeSingle()
      if (!rc || !adminRow || rc.clubs?.university_id !== adminRow.university_id || rc.status === 'pending') {
        return errorResponse('Not allowed', 403)
      }
      const amount = Number(rc.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
      const lines = [
        `Your receipt "${rc.file_name}" (${amount}) for "${rc.events?.name}" was ${rc.status}.`,
        rc.admin_note ? `Note: ${rc.admin_note}` : null,
        '',
        'See your receipts:',
        link('/club'),
      ].filter((l) => l !== null)
      const status = await sendEmail(db, {
        to: rc.clubs.email, template: 'receipt_status', relatedId: id, dedupeKey: `receipt:${id}:${rc.status}`,
        subject: `Receipt ${rc.status}: ${rc.events?.name ?? rc.file_name}`,
        text: lines.join('\n') + '\n',
      })
      return json({ status })
    }

    default:
      return errorResponse('Unknown notification type')
  }
})
