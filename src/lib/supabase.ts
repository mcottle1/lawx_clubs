import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** True when the Supabase env vars are present. The UI shows a setup hint otherwise. */
export const supabaseConfigured = Boolean(url && anonKey)

// Only the public anon key is ever used in the browser. Row Level Security
// in Postgres is what actually protects data.
export const supabase = createClient(
  url || 'http://localhost:54321',
  anonKey || 'missing-anon-key',
)
