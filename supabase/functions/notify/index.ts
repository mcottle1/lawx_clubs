// Sends the email that goes with something the caller just did in the app.
// POST { type, id, kind? }  (called by the browser right after the action succeeds)
//
//   event_submitted    id = event        → university admin: new pending approval
//   message            id = conversation → the other side: new message (max 1/day/thread),
//                                           or the admin if it's a first message awaiting approval
//   opportunity_submitted id = opportunity → university admin: post awaiting approval
//   proposal_submitted id = proposal     → club: new proposal (or the admin, if screening is on)
//   proposal_responded id = proposal     → partner: accepted/declined (+ admin: pending approval)
//   reviewed           id, kind = 'event' | 'proposal' | 'opportunity' | 'message'
//                                         → requester (+ other side): approved / sent back / denied
//   report_submitted   id = event        → sponsor: results are in (+ admin: receipts to review)
//   receipt_reviewed   id = receipt      → club: receipt status changed
//
// Every send is checked against what the caller actually did (so this can't
// be used to email arbitrary people) and de-duplicated through email_log.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { adminClient, userClient } from '../_shared/clients.ts'
import { corsHeaders, errorResponse, json } from '../_shared/cors.ts'
import { sendEmail } from '../_shared/email.ts'
import { emailAdmins, link, notifyAdminOfEvent } from '../_shared/notifications.ts'

const today = () => new Date().toISOString().slice(0, 10)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405)

  const callerDb = userClient(req)
  const { data: auth } = await callerDb.auth.getUser()
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
        .select('id, subject, club_id, partner_id, approval_status, submitted_at, clubs(name, email, user_id), partners(name, email, user_id)')
        .eq('id', id).maybeSingle()
      if (!conv) return errorResponse('Not found', 404)
      // deno-lint-ignore no-explicit-any
      const c = conv as any
      const side = c.clubs?.user_id === user.id ? 'club' : c.partners?.user_id === user.id ? 'partner' : null
      if (!side) return errorResponse('Not allowed', 403)
      // A first message waiting for approval goes to the university admin, not the partner.
      if (c.approval_status !== 'approved') {
        if (side !== 'club' || c.approval_status !== 'pending') return json({ status: 'skipped' })
        const status = await emailAdmins(db, c.club_id, {
          template: 'pending_approval', relatedId: id, dedupeKey: `pending_message:${id}:${c.submitted_at}`,
          subject: `Approval needed: ${c.clubs.name}'s message to ${c.partners.name}`,
          text: `${c.clubs.name} wants to message ${c.partners.name} ("${c.subject}"). It needs your approval before it's sent.\n\nReview it here:\n${link('/university-admin')}\n`,
        }, ['partnership'])
        return json({ status })
      }
      return json({ status: await emailNewMessage(db, c, side, user.id) })
    }

    case 'opportunity_submitted': {
      const { data: o } = await db.from('opportunities')
        .select('id, title, club_id, approval_status, submitted_at, clubs(name, user_id)').eq('id', id).maybeSingle()
      // deno-lint-ignore no-explicit-any
      const op = o as any
      if (!op || op.clubs?.user_id !== user.id) return errorResponse('Not allowed', 403)
      if (op.approval_status !== 'pending') return json({ status: 'skipped' })
      const status = await emailAdmins(db, op.club_id, {
        template: 'pending_approval', relatedId: id, dedupeKey: `pending_opportunity:${id}:${op.submitted_at}`,
        subject: `Approval needed: ${op.clubs.name}'s opportunity "${op.title}"`,
        text: `${op.clubs.name} posted a sponsorship opportunity, "${op.title}". Partners see it once you approve it.\n\nReview it here:\n${link('/university-admin')}\n`,
      }, ['partnership'])
      return json({ status })
    }

    case 'proposal_submitted': {
      const { data: p } = await db.from('proposals')
        .select('id, club_id, status, submitted_at, partners(name, user_id), clubs(name, email), opportunities(title), events(name)').eq('id', id).maybeSingle()
      // deno-lint-ignore no-explicit-any
      const pr = p as any
      if (!pr || pr.partners?.user_id !== user.id) return errorResponse('Not allowed', 403)
      const about = pr.opportunities?.title ?? pr.events?.name ?? 'your club'
      if (pr.status === 'pending_review') {
        const status = await emailAdmins(db, pr.club_id, {
          template: 'pending_approval', relatedId: id, dedupeKey: `pending_proposal_review:${id}:${pr.submitted_at}`,
          subject: `Approval needed: proposal from ${pr.partners.name} to ${pr.clubs.name}`,
          text: `${pr.partners.name} sent ${pr.clubs.name} a sponsorship proposal for "${about}". The club sees it once you approve it.\n\nReview it here:\n${link('/university-admin')}\n`,
        }, ['partnership'])
        return json({ status })
      }
      if (pr.status !== 'pending_club') return json({ status: 'skipped' })
      return json({ status: await emailNewProposal(db, pr, about) })
    }

    case 'proposal_responded': {
      const { data: p } = await db.from('proposals').select('id, status, club_id, event_id, club_responded_at, partners(email), clubs(name, user_id), opportunities(title), events(name, approval_status)').eq('id', id).maybeSingle()
      // deno-lint-ignore no-explicit-any
      const pr = p as any
      if (!pr || pr.clubs?.user_id !== user.id) return errorResponse('Not allowed', 403)
      if (!['pending_admin', 'declined'].includes(pr.status)) return json({ status: 'skipped' })
      const accepted = pr.status === 'pending_admin'
      const about = pr.opportunities?.title ?? pr.events?.name ?? 'their club'
      const status = await sendEmail(db, {
        to: pr.partners.email, template: accepted ? 'proposal_accepted' : 'proposal_declined', relatedId: id,
        dedupeKey: `proposal_responded:${id}:${pr.status}:${pr.club_responded_at}`,
        subject: `${pr.clubs.name} ${accepted ? 'accepted' : 'declined'} your proposal`,
        text: accepted
          ? `${pr.clubs.name} accepted your proposal for "${about}". It now goes to their university for final approval.\n\nSee your proposals:\n${link('/partner/proposals')}\n`
          : `${pr.clubs.name} declined your proposal for "${about}". Thanks for offering!\n\nBrowse other opportunities:\n${link('/partner')}\n`,
      })
      if (accepted) {
        if (pr.event_id && pr.events?.approval_status === 'pending') {
          await notifyAdminOfEvent(db, pr.event_id)
        } else {
          await emailAdmins(db, pr.club_id, {
            template: 'pending_approval', relatedId: id, dedupeKey: `pending_proposal:${id}:${pr.club_responded_at}`,
            subject: `Approval needed: partnership for ${pr.clubs.name}`,
            text: `${pr.clubs.name} accepted a sponsorship for "${about}". It needs your approval.\n\nReview it here:\n${link('/university-admin')}\n`,
          }, ['partnership'])
        }
      }
      return json({ status })
    }

    case 'reviewed': {
      const kind = ['event', 'proposal', 'opportunity', 'message'].includes(body?.kind) ? body.kind as string : 'event'
      // Only someone acting as the club's admin (its college admin, or the
      // organization admin for a college without one) can trigger these.
      const mine = async (clubId: string | undefined) =>
        !!clubId && (await callerDb.rpc('is_admin_of_club', { p_club_id: clubId })).data === true
      const noteLine = (label: string, note: string | null) => (note ? `${label}: ${note}\n` : '')

      if (kind === 'opportunity') {
        const { data } = await db.from('opportunities').select('id, title, approval_status, review_note, reviewed_at, club_id, clubs(email, university_id)').eq('id', id).maybeSingle()
        // deno-lint-ignore no-explicit-any
        const o = data as any
        if (!o || !(await mine(o.club_id)) || o.approval_status === 'pending') return errorResponse('Not allowed', 403)
        const s = o.approval_status as string
        await sendEmail(db, {
          to: o.clubs.email, template: `opportunity_${s}`, relatedId: id, dedupeKey: `reviewed:opportunity:${id}:${o.reviewed_at}`,
          subject: s === 'approved' ? `Your opportunity is live: ${o.title}` : s === 'denied' ? `Not approved: ${o.title}` : `Changes requested: ${o.title}`,
          text: s === 'approved'
            ? `Your university approved "${o.title}". Partners can see it now.\n\nShare it:\n${link('/club/partnerships?tab=opportunities')}\n`
            : s === 'denied'
              ? `Your university didn't approve "${o.title}".\n${noteLine('Reason', o.review_note)}\nDetails:\n${link('/club/partnerships?tab=opportunities')}\n`
              : `Your university sent "${o.title}" back for changes.\n${noteLine('Note', o.review_note)}\nEdit and resubmit it here:\n${link('/club/partnerships?tab=opportunities')}\n`,
        })
        return json({ status: 'ok' })
      }

      if (kind === 'message') {
        const { data } = await db.from('conversations')
          .select('id, subject, club_id, partner_id, approval_status, review_note, reviewed_at, clubs(name, email, user_id, university_id), partners(name, email, user_id)')
          .eq('id', id).maybeSingle()
        // deno-lint-ignore no-explicit-any
        const c = data as any
        if (!c || !(await mine(c.club_id)) || c.approval_status === 'pending') return errorResponse('Not allowed', 403)
        const s = c.approval_status as string
        await sendEmail(db, {
          to: c.clubs.email, template: `message_${s}`, relatedId: id, dedupeKey: `reviewed:message:${id}:${c.reviewed_at}`,
          subject: s === 'approved' ? `Sent: your message to ${c.partners.name}` : s === 'denied' ? `Not approved: your message to ${c.partners.name}` : `Changes requested: your message to ${c.partners.name}`,
          text: s === 'approved'
            ? `Your university approved your message to ${c.partners.name} ("${c.subject}"), and it has been sent.\n\nConversation:\n${link(`/club/messages/${id}`)}\n`
            : s === 'denied'
              ? `Your university didn't approve your message to ${c.partners.name}, so it wasn't sent.\n${noteLine('Reason', c.review_note)}\nDetails:\n${link(`/club/messages/${id}`)}\n`
              : `Your university asked for changes to your message to ${c.partners.name} before it's sent.\n${noteLine('Note', c.review_note)}\nEdit and resubmit it here:\n${link(`/club/messages/${id}`)}\n`,
        })
        if (s === 'approved') await emailNewMessage(db, c, 'club', c.clubs.user_id)
        return json({ status: 'ok' })
      }

      let proposals: { id: string; status: string; denial_reason: string | null; reviewed_at: string; club_visible: boolean; partners: { email: string; name: string }; clubs: { name: string; email: string } }[] = []
      if (kind === 'event') {
        const { data: ev } = await db.from('events').select('id, name, approval_status, denial_reason, reviewed_at, club_id, clubs(name, email, university_id)').eq('id', id).maybeSingle()
        // deno-lint-ignore no-explicit-any
        const e = ev as any
        if (!e || !(await mine(e.club_id)) || e.approval_status === 'pending') return errorResponse('Not allowed', 403)
        const s = e.approval_status as string
        await sendEmail(db, {
          to: e.clubs.email, template: `event_${s}`, relatedId: id,
          dedupeKey: `reviewed:event:${id}:${e.reviewed_at}`,
          subject: `${s === 'approved' ? 'Approved' : s === 'denied' ? 'Not approved' : 'Changes requested'}: ${e.name}`,
          text: s === 'approved'
            ? `Your event "${e.name}" was approved.\n\nView it here:\n${link(`/club/events/${id}`)}\n`
            : s === 'denied'
              ? `Your event "${e.name}" was not approved.\nReason: ${e.denial_reason}\n\nYou can edit and resubmit it here:\n${link(`/club/events/${id}`)}\n`
              : `Your university sent "${e.name}" back for changes.\nNote: ${e.denial_reason}\n\nEdit and resubmit it here:\n${link(`/club/events/${id}`)}\n`,
        })
        if (s === 'changes_requested') return json({ status: 'ok' })
        // deno-lint-ignore no-explicit-any
        const { data } = await db.from('proposals').select('id, status, denial_reason, reviewed_at, club_visible, partners(email, name), clubs(name, email)').eq('event_id', id).eq('reviewed_at', e.reviewed_at) as any
        proposals = data ?? []
      } else {
        // deno-lint-ignore no-explicit-any
        const { data } = await db.from('proposals').select('id, club_id, status, denial_reason, reviewed_at, club_visible, submitted_at, partners(email, name), clubs(name, email, university_id), opportunities(title), events(name)').eq('id', id).maybeSingle() as any
        if (!data || !(await mine(data.club_id)) || !data.reviewed_at) return errorResponse('Not allowed', 403)
        const about = data.opportunities?.title ?? data.events?.name ?? 'your club'
        const key = `reviewed:proposal:${id}:${data.reviewed_at}`
        if (data.status === 'pending_club') {
          // Screening approved: the club sees it now.
          await emailNewProposal(db, data, about)
          await sendEmail(db, {
            to: data.partners.email, template: 'proposal_screened', relatedId: id, dedupeKey: `${key}:partner`,
            subject: `Your proposal was sent to ${data.clubs.name}`,
            text: `${data.clubs.name}'s university approved your proposal for "${about}", and the club can see it now.\n\nSee your proposals:\n${link('/partner/proposals')}\n`,
          })
          return json({ status: 'ok' })
        }
        if (data.status === 'changes_requested') {
          await sendEmail(db, {
            to: data.partners.email, template: 'proposal_changes_requested', relatedId: id, dedupeKey: `${key}:partner`,
            subject: `Changes requested: your proposal to ${data.clubs.name}`,
            text: `${data.clubs.name}'s university asked for changes to your proposal for "${about}".\n${noteLine('Note', data.denial_reason)}\nEdit and resubmit it here:\n${link('/partner/proposals')}\n`,
          })
          if (data.club_visible) await sendEmail(db, {
            to: data.clubs.email, template: 'proposal_changes_requested', relatedId: id, dedupeKey: `${key}:club`,
            subject: `Partnership sent back to ${data.partners.name}`,
            text: `Your university sent the partnership with ${data.partners.name} for "${about}" back to them to revise.\n${noteLine('Note', data.denial_reason)}\nYou'll be asked to accept the new terms.\n\nDetails:\n${link('/club/partnerships?tab=proposals')}\n`,
          })
          return json({ status: 'ok' })
        }
        if (!['approved', 'denied'].includes(data.status)) return errorResponse('Not allowed', 403)
        const approved = data.status === 'approved'
        if (data.club_visible) await sendEmail(db, {
          to: data.clubs.email, template: approved ? 'partnership_approved' : 'partnership_denied', relatedId: id,
          dedupeKey: `${key}:club`,
          subject: `Partnership ${approved ? 'approved' : 'not approved'}`,
          text: `Your partnership for "${about}" was ${approved ? 'approved' : `not approved.\nReason: ${data.denial_reason}`}.\n\nDetails:\n${link('/club/partnerships?tab=proposals')}\n`,
        })
        proposals = [data]
      }
      for (const p of proposals) {
        if (!['approved', 'denied'].includes(p.status)) continue
        const approved = p.status === 'approved'
        await sendEmail(db, {
          to: p.partners.email, template: approved ? 'partnership_approved' : 'partnership_denied', relatedId: p.id,
          dedupeKey: `reviewed:proposal:${p.id}:${p.reviewed_at}:partner`,
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
          report.offers_redeemed !== null ? `Offers extended: ${report.offers_redeemed}` : null,
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
        {
          out.admin = await emailAdmins(db, e.club_id, {
            template: 'receipts_submitted', relatedId: id, dedupeKey: `receipts_submitted:${id}:${count}`,
            subject: `Receipts to review: ${e.clubs.name}`,
            text: `${e.clubs.name} submitted ${count} receipt(s) for "${e.name}".\n\nReview them here:\n${link('/university-admin/receipts')}\n`,
          }, ['receipts'])
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
      const { data: actsForClub } = rc ? await callerDb.rpc('is_admin_of_club', { p_club_id: rc.club_id }) : { data: false }
      if (!rc || actsForClub !== true || rc.status === 'pending') {
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

/** "New message" email to the other side (at most one per thread per day). */
// deno-lint-ignore no-explicit-any
async function emailNewMessage(db: SupabaseClient, c: any, side: 'club' | 'partner', senderUserId: string) {
  const { data: msg } = await db.from('messages').select('body, created_at').eq('conversation_id', c.id)
    .eq('sender_user_id', senderUserId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!msg) return 'skipped'
  const to = side === 'club' ? c.partners.email : c.clubs.email
  const from = side === 'club' ? c.clubs.name : c.partners.name
  const route = side === 'club' ? `/partner/messages/${c.id}` : `/club/messages/${c.id}`
  const preview = msg.body.length > 400 ? msg.body.slice(0, 400) + '…' : msg.body
  return sendEmail(db, {
    to, template: 'new_message', relatedId: c.id,
    dedupeKey: `message:${c.id}:${side === 'club' ? 'partner' : 'club'}:${today()}`,
    subject: `New message from ${from}: ${c.subject}`,
    text: `${from} wrote:\n\n${preview}\n\nReply on CampusBridge:\n${link(route)}\n`,
  })
}

/** "New proposal" email to the club (once per submission). */
// deno-lint-ignore no-explicit-any
async function emailNewProposal(db: SupabaseClient, pr: any, about: string) {
  return sendEmail(db, {
    to: pr.clubs.email, template: 'new_proposal', relatedId: pr.id, dedupeKey: `proposal_submitted:${pr.id}:${pr.submitted_at}`,
    subject: `New sponsorship proposal from ${pr.partners.name}`,
    text: `${pr.partners.name} sent a proposal for "${about}".\n\nReview and accept or decline it here:\n${link('/club/partnerships?tab=proposals')}\n`,
  })
}

