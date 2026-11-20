// Public endpoint (no login): an invited administrator opens their link.
//   POST { action: "preview", token }
//        → { email, kind, university_name, department_name, unit_label, needs_scheduling }
//   POST { action: "accept", token, password, scheduling_url?, scheduling_instructions? }
//        → creates the account as an organization admin ("org") or a college
//          admin ("department"). The first admin of a college also provides
//          its room-booking info. The browser then signs in normally.
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
    .select('id, kind, email, university_id, department_id, expires_at, used_at, revoked_at, universities(name, unit_label), departments(name)')
    .eq('token_hash', await sha256Hex(token))
    .maybeSingle()

  if (!invite || invite.revoked_at) return errorResponse('This invite link is not valid. Ask for a new one.', 404)
  if (invite.used_at) return errorResponse('This invite has already been used. Log in with your email and password.', 410)
  if (new Date(invite.expires_at) < new Date()) return errorResponse('This invite has expired. Ask for a new one.', 410)
  if (invite.kind === 'department' && !invite.department_id) return errorResponse('This invite link is not valid. Ask for a new one.', 404)

  const uni = invite.universities as unknown as { name: string; unit_label: string } | null
  const dept = invite.departments as unknown as { name: string } | null
  const isOrg = invite.kind === 'org'

  let needsScheduling = false
  if (!isOrg) {
    const { data: settings } = await db.from('department_settings')
      .select('scheduling_url, scheduling_instructions').eq('department_id', invite.department_id).maybeSingle()
    needsScheduling = !settings?.scheduling_url && !settings?.scheduling_instructions
  }

  const preview = {
    email: invite.email,
    kind: invite.kind,
    university_name: uni?.name ?? 'your university',
    department_name: dept?.name ?? null,
    unit_label: uni?.unit_label ?? 'College',
    needs_scheduling: needsScheduling,
  }
  if (body?.action === 'preview') return json(preview)
  if (body?.action !== 'accept') return errorResponse('Unknown action')

  // ---- accept -------------------------------------------------------------
  const password = String(body?.password ?? '')
  const schedulingUrl = String(body?.scheduling_url ?? '').trim() || null
  const schedulingInstructions = String(body?.scheduling_instructions ?? '').trim() || null
  if (password.length < 8) return errorResponse('Password must be at least 8 characters')
  if (needsScheduling && !schedulingUrl && !schedulingInstructions) {
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

  // 'invited_admin' makes the sign-up trigger skip profile creation; the
  // admin's profile and admin row are inserted below with the service role.
  const { data: created, error: createError } = await db.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
    user_metadata: { role: 'invited_admin' },
  })
  if (createError || !created.user) {
    await release()
    const msg = /already|registered|exists/i.test(createError?.message ?? '')
      ? 'An account with this email already exists. Each account has one role, so ask for an invite to a different email.'
      : 'Could not create the account.'
    return errorResponse(msg, 409)
  }

  const userId = created.user.id
  const { error: profileError } = await db.from('profiles')
    .insert({ user_id: userId, role: isOrg ? 'org_admin' : 'university_admin' })
  const { error: adminError } = profileError
    ? { error: profileError }
    : isOrg
      ? await db.from('org_admins').insert({ user_id: userId, university_id: invite.university_id, email: invite.email })
      : await db.from('department_admins').insert({ user_id: userId, department_id: invite.department_id, email: invite.email })
  if (adminError) {
    await db.auth.admin.deleteUser(userId)
    await release()
    return errorResponse('Could not finish setup. Please try again.', 500)
  }

  if (!isOrg) {
    if (schedulingUrl || schedulingInstructions) {
      await db.from('department_settings').update({
        ...(schedulingUrl ? { scheduling_url: schedulingUrl } : {}),
        ...(schedulingInstructions ? { scheduling_instructions: schedulingInstructions } : {}),
      }).eq('department_id', invite.department_id)
    }
    // The college (and its university) now accept club sign-ups.
    await db.from('departments').update({ is_participating: true }).eq('id', invite.department_id)
    await db.from('universities').update({ is_participating: true }).eq('id', invite.university_id)
  }

  return json(preview)
})
