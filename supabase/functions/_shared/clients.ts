import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided
// automatically to every Edge Function by Supabase.
const url = Deno.env.get('SUPABASE_URL')!

/** Service-role client: bypasses RLS. Only ever used server-side. */
export function adminClient(): SupabaseClient {
  return createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Client that acts as the calling user (RLS applies). */
export function userClient(req: Request): SupabaseClient {
  return createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Public site URL, always ending in "/". Links are built as SITE_URL + "#/route". */
export function siteUrl(): string {
  const raw = Deno.env.get('SITE_URL') ?? 'http://localhost:5173/'
  return raw.endsWith('/') ? raw : raw + '/'
}
