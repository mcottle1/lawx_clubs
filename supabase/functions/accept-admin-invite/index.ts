// Public endpoint (no login): the invited university admin opens their link.
//   POST { action: "preview", token }  → { email, university_name }
//   POST { action: "accept", token, password, scheduling_url?, scheduling_instructions? }
//        → creates the account, links it to the university, marks the
//          university as participating. The browser then signs in normally.
import { adminClient } from '../_shared/clients.ts'
import { corsHeaders, errorResponse, json } from '../_shared/cors.ts'
import { sha256Hex } from '../_shared/token.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405)

  const body = await req.json().catch(() => null)
  const token = String(body?.token ?? '')
  if (!token) return errorResponse('Missing invite token')

  const db = adminClient()
  const { data: invite } = await db
    .from('admin_invites')
    .select('id, email, university_id, expires_at, used_at, revoked_at, universities(name)')
    .eq('token_hash', await sha256Hex(token))
    .maybeSingle()

  if (!invite || invite.revoked_at) return errorResponse('This invite link is not valid. Ask the site administrator for a new one.', 404)
  if (invite.used_at) return errorResponse('This invite has already been used. Log in with your email and password.', 410)
  if (new Date(invite.expires_at) < new Date()) return errorResponse('This invite has expired. Ask the site administrator for a new one.', 410)

  const uni = invite.universities as unknown as { name: string } | null
  const universityName = uni?.name ?? 'your university'

  if (body?.action === 'preview') {
    return json({ email: invite.email, university_name: universityName })
  }
  if (body?.action !== 'accept') return errorResponse('Unknown action')

  // ---- accept -------------------------------------------------------------
  const password = String(body?.password ?? '')
  const schedulingUrl = String(body?.scheduling_url ?? '').trim() || null
  const schedulingInstructions = String(body?.scheduling_instructions ?? '').trim() || null
  if (password.length < 8) return errorResponse('Password must be at least 8 characters')
  if (!schedulingUrl && !schedulingInstructions) {
    return errorResponse('Add a scheduling link or written scheduling instructions')
  }
  if (schedulingUrl && !/^https?:\/\/\S+$/i.test(schedulingUrl)) {
    return errorResponse('Scheduling link must start with http:// or https://')
  }

  // Claim the invite first so two simultaneous requests can't both succeed.
  const { data: claimed } = await db.from('admin_invites')
    .update({ used_at: new Date().toISOString() })
    .eq('id', invite.id).is('used_at', null)
    .select('id')
  if (!claimed?.length) return errorResponse('This invite has already been used.', 410)
  const release = () => db.from('admin_invites').update({ used_at: null }).eq('id', invite.id)

  const { data: existingAdmin } = await db
    .from('university_admins').select('id').eq('university_id', invite.university_id).maybeSingle()
  if (existingAdmin) {
    await release()
    return errorResponse(`${universityName} already has an administrator.`, 409)
  }

  // 'invited_admin' makes the sign-up trigger skip profile creation; the
  // university_admin profile is inserted below with the service role.
  const { data: created, error: createError } = await db.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
    user_metadata: { role: 'invited_admin' },
  })
  if (createError || !created.user) {
    await release()
    const msg = /already|registered|exists/i.test(createError?.message ?? '')
      ? 'An account with this email already exists. Ask the site administrator to invite a different email.'
      : 'Could not create the account.'
    return errorResponse(msg, 409)
  }

  const { error: profileError } = await db.from('profiles')
    .insert({ user_id: created.user.id, role: 'university_admin' })
  const { error: adminError } = profileError
    ? { error: profileError }
    : await db.from('university_admins').insert({
        user_id: created.user.id,
        university_id: invite.university_id,
        contact_email: invite.email,
        scheduling_url: schedulingUrl,
        scheduling_instructions: schedulingInstructions,
      })
  if (adminError) {
    await db.auth.admin.deleteUser(created.user.id)
    await release()
    return errorResponse('Could not finish setup. Please try again.', 500)
  }

  await db.from('universities').update({ is_participating: true }).eq('id', invite.university_id)

  return json({ email: invite.email, university_name: universityName })
})
