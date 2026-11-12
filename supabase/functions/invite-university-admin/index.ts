// Site admin → creates a university-admin invite and emails the link.
// POST { university_id: string, email: string }
// Returns { invite_id, link, email_status }. The link is also returned so the
// site admin can share it manually if email isn't configured yet.
import { adminClient, siteUrl, userClient } from '../_shared/clients.ts'
import { corsHeaders, errorResponse, json } from '../_shared/cors.ts'
import { sendEmail } from '../_shared/email.ts'
import { randomToken, sha256Hex } from '../_shared/token.ts'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405)

  // 1. Caller must be an active site admin.
  const caller = userClient(req)
  const { data: userData } = await caller.auth.getUser()
  const { data: isAdmin } = await caller.rpc('is_site_admin')
  if (!userData?.user || isAdmin !== true) return errorResponse('Only site administrators can send invites', 403)

  // 2. Validate input.
  const body = await req.json().catch(() => null)
  const universityId = String(body?.university_id ?? '')
  const email = String(body?.email ?? '').trim().toLowerCase()
  if (!universityId) return errorResponse('university_id is required')
  if (!EMAIL_RE.test(email)) return errorResponse('A valid email is required')

  const db = adminClient()
  const { data: uni } = await db.from('universities').select('id, name').eq('id', universityId).maybeSingle()
  if (!uni) return errorResponse('University not found', 404)

  const { data: existingAdmin } = await db
    .from('university_admins').select('id').eq('university_id', uni.id).maybeSingle()
  if (existingAdmin) return errorResponse(`${uni.name} already has an administrator`, 409)

  // 3. Revoke older pending invites for this university, then create a new one.
  await db.from('admin_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('university_id', uni.id).is('used_at', null).is('revoked_at', null)

  const token = randomToken()
  const { data: invite, error } = await db.from('admin_invites')
    .insert({ university_id: uni.id, email, token_hash: await sha256Hex(token), created_by: userData.user.id })
    .select('id, expires_at').single()
  if (error || !invite) return errorResponse('Could not create invite', 500)

  // 4. Email the link.
  const link = `${siteUrl()}#/admin-invite/${token}`
  const emailStatus = await sendEmail(db, {
    to: email,
    template: 'university_admin_invite',
    dedupeKey: `admin_invite:${invite.id}`,
    relatedId: invite.id,
    subject: `You're invited to manage ${uni.name} on Law Club Manager`,
    text:
      `You've been invited to be the club administrator for ${uni.name} on Law Club Manager.\n\n` +
      `Set your password and finish setup here (link expires in 7 days):\n${link}\n`,
  })

  return json({ invite_id: invite.id, link, email_status: emailStatus, expires_at: invite.expires_at })
})
