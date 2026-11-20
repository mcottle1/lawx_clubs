// Sends an email from a club to its members (or just its leadership).
//
// POST {
//   audience: "all" | "leadership",
//   subject: string, body: string,
//   club_file_ids?: string[],                    // attach files from Club files
//   uploads?: { path: string, name: string }[],  // files uploaded to the email-attachments bucket
//   test?: boolean                               // send only to the club's own email
// }
// → { status, recipient_count, delivered_count, skipped_count, club_copy, error? }
//
// Members are BCC'd (they never see each other's addresses) in batches of 49.
// The club's own address is always in "To" (so the club always gets a copy,
// one per batch) and is the Reply-To. Uses the RESEND_API_KEY
// and EMAIL_FROM secrets like every other email. MEMBER_EMAIL_DAILY_LIMIT
// (default 5) caps how many member emails a club can send per 24 hours.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { adminClient, userClient } from '../_shared/clients.ts'
import { corsHeaders, errorResponse, json } from '../_shared/cors.ts'

const DAILY_LIMIT = Number(Deno.env.get('MEMBER_EMAIL_DAILY_LIMIT') ?? 5)
const MAX_ATTACHMENTS = 10
const MAX_TOTAL_BYTES = 10 * 1024 * 1024
const BCC_BATCH = 49
const RESEND_URL = (Deno.env.get('RESEND_API_URL') || 'https://api.resend.com').replace(/\/+$/, '')
const RESERVED = /@(example\.(com|org|net)|[^@\s]+\.(example|test|invalid|localhost))$/i

interface Attachment { filename: string; content: string }

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

/** "CampusBridge <noreply@x.com>" → "noreply@x.com" */
function addressOf(from: string): string {
  return from.match(/<([^>]+)>/)?.[1] ?? from.trim()
}

async function download(db: SupabaseClient, bucket: string, path: string): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(bucket).download(path)
  if (error || !data) throw new Error(`Couldn't read an attachment (${path.split('/').pop()}).`)
  return new Uint8Array(await data.arrayBuffer())
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405)

  const { data: auth } = await userClient(req).auth.getUser()
  const user = auth?.user
  if (!user) return errorResponse('Not signed in', 401)

  const db = adminClient()
  const [{ data: club }, { data: profile }] = await Promise.all([
    db.from('clubs').select('id, name, email').eq('user_id', user.id).maybeSingle(),
    db.from('profiles').select('is_active').eq('user_id', user.id).maybeSingle(),
  ])
  if (!club || !profile?.is_active) return errorResponse('Only club accounts can email members.', 403)

  let input: Record<string, unknown>
  try { input = await req.json() } catch { return errorResponse('Invalid request body') }

  const audience = input.audience === 'leadership' ? 'leadership' : 'all'
  const subject = String(input.subject ?? '').trim()
  const body = String(input.body ?? '').trim()
  const test = input.test === true
  const fileIds = Array.isArray(input.club_file_ids) ? input.club_file_ids.map(String) : []
  const uploads = Array.isArray(input.uploads)
    ? (input.uploads as { path?: unknown; name?: unknown }[]).map((u) => ({ path: String(u?.path ?? ''), name: String(u?.name ?? '') }))
    : []

  // Uploaded attachments are removed whatever happens next (the page re-uploads them for each send).
  const cleanup = async () => {
    const mine = uploads.map((u) => u.path).filter((p) => p.startsWith(`${user.id}/`))
    if (mine.length) await db.storage.from('email-attachments').remove(mine)
  }
  const fail = async (message: string, status = 400) => { await cleanup(); return errorResponse(message, status) }

  if (!subject || subject.length > 200) return fail('Add a subject (up to 200 characters).')
  if (!body || body.length > 20000) return fail('Add a message (up to 20,000 characters).')
  if (fileIds.length + uploads.length > MAX_ATTACHMENTS) return fail(`Attach at most ${MAX_ATTACHMENTS} files.`)
  if (uploads.some((u) => !u.path.startsWith(`${user.id}/`) || u.path.includes('..'))) return fail('Not allowed', 403)

  if (!test) {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { count } = await db
      .from('member_emails')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', club.id)
      .in('status', ['sent', 'partial'])
      .gte('created_at', since)
    if ((count ?? 0) >= DAILY_LIMIT) {
      return fail(`You've reached today's limit of ${DAILY_LIMIT} member emails. Try again tomorrow.`, 429)
    }
  }

  // Recipients
  let recipients: string[] = []
  if (!test) {
    let q = db.from('club_members').select('email, email_key').eq('club_id', club.id)
    if (audience === 'leadership') q = q.not('role', 'is', null)
    const { data: members, error } = await q
    if (error) return fail(error.message, 500)
    const seen = new Set<string>()
    for (const m of members ?? []) {
      if (seen.has(m.email_key)) continue
      seen.add(m.email_key)
      recipients.push(m.email.trim())
    }
    if (recipients.length === 0) {
      return fail(audience === 'leadership' ? 'No members have a leadership role yet.' : 'Add members before sending an email.')
    }
  }
  const total = test ? 1 : recipients.length
  const skippedReserved = recipients.filter((e) => RESERVED.test(e))
  recipients = recipients.filter((e) => !RESERVED.test(e))

  // Attachments
  const attachments: Attachment[] = []
  const attachmentNames: string[] = []
  try {
    let bytes = 0
    if (fileIds.length) {
      const { data: files } = await db
        .from('club_files')
        .select('id, bucket, storage_path, file_name')
        .eq('club_id', club.id)
        .in('id', fileIds)
      if ((files ?? []).length !== new Set(fileIds).size) return fail('One of the selected club files was not found.', 404)
      for (const f of files ?? []) {
        const data = await download(db, f.bucket, f.storage_path)
        bytes += data.length
        attachments.push({ filename: f.file_name, content: toBase64(data) })
        attachmentNames.push(f.file_name)
      }
    }
    for (const u of uploads) {
      const data = await download(db, 'email-attachments', u.path)
      bytes += data.length
      const filename = (u.name || u.path.split('/').pop() || 'attachment').slice(0, 200)
      attachments.push({ filename, content: toBase64(data) })
      attachmentNames.push(filename)
    }
    if (bytes > MAX_TOTAL_BYTES) return fail('Attachments must add up to 10 MB or less.')
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500)
  }

  // Send
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const fromAddress = addressOf(Deno.env.get('EMAIL_FROM') ?? 'CampusBridge <onboarding@resend.dev>')
  const clubName = club.name.replace(/["<>\r\n]/g, '').slice(0, 80)
  const from = `"${clubName} via CampusBridge" <${fromAddress}>`
  const clubReserved = RESERVED.test(club.email)
  const text = `${body}\n\n—\nSent by ${club.name} to its members via CampusBridge.` +
    (clubReserved ? '' : ` Reply to this email to reach ${club.name}.`)

  const batches: string[][] = []
  if (test) {
    if (!clubReserved) batches.push([])
  } else {
    for (let i = 0; i < recipients.length; i += BCC_BATCH) batches.push(recipients.slice(i, i + BCC_BATCH))
    // The club always gets a copy, even if no member address can be emailed.
    if (batches.length === 0 && !clubReserved) batches.push([])
  }

  let delivered = 0
  let clubCopy = false
  const errors: string[] = []
  let status: 'sent' | 'partial' | 'failed' | 'skipped'

  if (!apiKey || batches.length === 0) {
    status = 'skipped'
    if (!apiKey) errors.push('Email sending is not set up (RESEND_API_KEY is missing).')
    else errors.push('No real email addresses to send to (demo/test addresses are never emailed).')
  } else {
    for (const [i, bcc] of batches.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, 600)) // stay under Resend's rate limit
      const payload: Record<string, unknown> = {
        from,
        to: [clubReserved ? fromAddress : club.email],
        subject: test ? `[Test] ${subject}` : subject,
        text,
        ...(clubReserved ? {} : { reply_to: club.email }),
        ...(bcc.length ? { bcc } : {}),
        ...(attachments.length ? { attachments } : {}),
      }
      try {
        const res = await fetch(`${RESEND_URL}/emails`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const out = await res.json().catch(() => ({}))
        if (res.ok) {
          delivered += test ? 1 : bcc.length
          if (!clubReserved) clubCopy = true
        } else errors.push(`${res.status}: ${out.message ?? JSON.stringify(out)}`)
      } catch (e) {
        errors.push(String(e))
      }
    }
    const deliverable = test ? 1 : recipients.length
    status = deliverable === 0
      ? (clubCopy ? 'sent' : 'failed')
      : delivered === 0 ? 'failed' : delivered < deliverable ? 'partial' : 'sent'
  }
  if (skippedReserved.length && status !== 'skipped') {
    errors.push(`${skippedReserved.length} demo/test address(es) skipped.`)
  }

  if (!test) {
    await db.from('member_emails').insert({
      club_id: club.id,
      sent_by: user.id,
      audience,
      subject,
      body,
      recipient_count: total,
      delivered_count: delivered,
      attachment_names: attachmentNames,
      club_copy: clubCopy,
      status,
      error: errors.length ? errors.join(' ').slice(0, 2000) : null,
    })
  }
  await cleanup()

  return json({
    status,
    recipient_count: total,
    delivered_count: delivered,
    skipped_count: skippedReserved.length,
    club_copy: clubCopy,
    error: errors.length ? errors.join(' ') : undefined,
  })
})
