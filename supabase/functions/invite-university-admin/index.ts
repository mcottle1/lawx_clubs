// Creates an administrator invite and emails the link.
//
// POST { kind: "org", university_id, email }         site admins only
//      → invites an organization admin (runs the whole university)
// POST { kind: "department", department_id, email }  site admins, or the
//      organization admin of that college's university
//      → invites a college (department) admin; a college can have several
//
// Returns { invite_id, link, email_status, expires_at }. The link is returned
// so it can be shared by hand if email isn't set up yet.
import { adminClient, siteUrl, userClient } from '../_shared/clients.ts'
import { corsHeaders, errorResponse, json } from '../_shared/cors.ts'
import { sendEmail } from '../_shared/email.ts'
import { randomToken, sha256Hex } from '../_shared/token.ts'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405)

  const caller = userClient(req)
  const { data: userData } = await caller.auth.getUser()
  if (!userData?.user) return errorResponse('Not signed in', 401)
  const [{ data: isSiteAdmin }, { data: orgUniversityId }] = await Promise.all([
    caller.rpc('is_site_admin'),
    caller.rpc('current_org_university_id'),
  ])

  const body = await req.json().catch(() => null)
  const kind = body?.kind === 'org' ? 'org' : 'department'
  const email = String(body?.email ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return errorResponse('A valid email is required')

  const db = adminClient()
  let universityId: string
  let departmentId: string | null = null
  let subject: string
  let intro: string

  if (kind === 'org') {
    if (isSiteAdmin !== true) return errorResponse('Only site administrators can invite organization admins', 403)
    const { data: uni } = await db.from('universities').select('id, name, unit_label').eq('id', String(body?.university_id ?? '')).maybeSingle()
    if (!uni) return errorResponse('University not found', 404)
    universityId = uni.id
    subject = `You're invited to manage ${uni.name} on CampusBridge`
    intro = `You've been invited to be an organization administrator for ${uni.name} on CampusBridge. ` +
      `You'll set up its ${uni.unit_label.toLowerCase()}s, invite their administrators and oversee their clubs.`
  } else {
    const { data: dept } = await db.from('departments')
      .select('id, name, university_id, universities(name, unit_label)').eq('id', String(body?.department_id ?? '')).maybeSingle()
    if (!dept) return errorResponse('Not found', 404)
    if (isSiteAdmin !== true && orgUniversityId !== dept.university_id) {
      return errorResponse('Only the organization admin can invite admins for this college', 403)
    }
    // deno-lint-ignore no-explicit-any
    const uni = (dept as any).universities as { name: string; unit_label: string }
    universityId = dept.university_id
    departmentId = dept.id
    subject = `You're invited to manage ${dept.name} on CampusBridge`
    intro = `You've been invited to be a club administrator for ${dept.name} (${uni.name}) on CampusBridge. ` +
      `You'll approve its clubs' events and sponsorships and review their receipts.`
  }

  // Replace any earlier pending invite for the same person and role.
  let older = db.from('admin_invites').update({ revoked_at: new Date().toISOString() })
    .eq('email', email).eq('kind', kind).eq('university_id', universityId).is('used_at', null).is('revoked_at', null)
  if (departmentId) older = older.eq('department_id', departmentId)
  await older

  const token = randomToken()
  const { data: invite, error } = await db.from('admin_invites')
    .insert({ kind, university_id: universityId, department_id: departmentId, email, token_hash: await sha256Hex(token), created_by: userData.user.id })
    .select('id, expires_at').single()
  if (error || !invite) return errorResponse('Could not create invite', 500)

  const link = `${siteUrl()}#/admin-invite/${token}`
  const emailStatus = await sendEmail(db, {
    to: email,
    template: kind === 'org' ? 'org_admin_invite' : 'university_admin_invite',
    dedupeKey: `admin_invite:${invite.id}`,
    relatedId: invite.id,
    subject,
    text: `${intro}\n\nSet your password and finish setup here (link expires in 7 days):\n${link}\n`,
  })

  return json({ invite_id: invite.id, link, email_status: emailStatus, expires_at: invite.expires_at })
})
