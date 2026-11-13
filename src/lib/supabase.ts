import { createClient, FunctionsHttpError } from '@supabase/supabase-js'

// Keep only the origin, e.g. "https://abcd.supabase.co". People often paste the
// REST endpoint (".../rest/v1/"), which would break every auth/storage call.
function normalizeUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw
  try {
    return new URL(raw.trim()).origin
  } catch {
    return raw
  }
}

const url = normalizeUrl(import.meta.env.VITE_SUPABASE_URL)
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** True when the Supabase env vars are present. The UI shows a setup hint otherwise. */
export const supabaseConfigured = Boolean(url && anonKey)

// Only the public anon key is ever used in the browser. Row Level Security
// in Postgres is what actually protects data.
export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'missing-anon-key', {
  auth: {
    // "implicit" puts tokens in the URL hash, which works from any device
    // (PKCE would require opening email links in the same browser).
    flowType: 'implicit',
    detectSessionInUrl: true,
    persistSession: true,
  },
})

/** Calls an Edge Function and turns its `{ error }` JSON into a thrown Error. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let message = error.message
    if (error instanceof FunctionsHttpError) {
      try {
        const payload = await error.context.json()
        if (payload?.error) message = payload.error
      } catch {
        /* keep default message */
      }
    }
    throw new Error(message)
  }
  return data as T
}
