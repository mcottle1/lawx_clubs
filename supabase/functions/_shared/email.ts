import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface EmailInput {
  to: string
  template: string
  subject: string
  text: string
  /** If set, an email with this key that was already sent is never sent again. */
  dedupeKey?: string
  relatedId?: string
}

export type EmailStatus = 'sent' | 'skipped' | 'failed'

/**
 * Sends a plain-text email through Resend and records it in email_log.
 * Without RESEND_API_KEY (e.g. local dev) the email is logged as "skipped".
 */
export async function sendEmail(db: SupabaseClient, input: EmailInput): Promise<EmailStatus> {
  if (input.dedupeKey) {
    const { data } = await db
      .from('email_log')
      .select('id')
      .eq('dedupe_key', input.dedupeKey)
      .eq('status', 'sent')
      .maybeSingle()
    if (data) return 'skipped'
  }

  // Demo/test accounts use reserved domains (example.com, *.test, ...): never actually send to them.
  const reserved = /@(example\.(com|org|net)|[^@\s]+\.(example|test|invalid|localhost))$/i.test(input.to)
  const apiKey = reserved ? undefined : Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('EMAIL_FROM') ?? 'CampusBridge <onboarding@resend.dev>'
  let status: EmailStatus = 'skipped'
  let providerId: string | null = null
  let error: string | null = reserved ? 'reserved demo/test address' : apiKey ? null : 'RESEND_API_KEY not set'

  if (apiKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        status = 'sent'
        providerId = body.id ?? null
      } else {
        status = 'failed'
        error = `${res.status}: ${body.message ?? JSON.stringify(body)}`
      }
    } catch (e) {
      status = 'failed'
      error = String(e)
    }
  }

  // A failed/skipped row may already hold this dedupe_key; replace it.
  if (input.dedupeKey) {
    await db.from('email_log').delete().eq('dedupe_key', input.dedupeKey).neq('status', 'sent')
  }
  await db.from('email_log').insert({
    to_email: input.to,
    template: input.template,
    dedupe_key: input.dedupeKey ?? null,
    related_id: input.relatedId ?? null,
    status,
    provider_id: providerId,
    error,
  })
  return status
}
