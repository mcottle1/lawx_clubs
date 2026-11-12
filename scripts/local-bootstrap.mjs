#!/usr/bin/env node
// LOCAL DEVELOPMENT ONLY. After `npx supabase start` (or `db reset`) and
// `npx supabase functions serve`, creates:
//   * site admin       siteadmin@example.com / password123
//   * BYU admin        admin@byu.example     / password123  (makes BYU participating)
// Refuses to run against anything but localhost.
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const st = JSON.parse(execSync('npx supabase status -o json', { stdio: ['ignore', 'pipe', 'ignore'] }).toString())
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(st.API_URL)) throw new Error('Not a local Supabase — refusing.')
const opts = { auth: { persistSession: false } }
const service = createClient(st.API_URL, st.SERVICE_ROLE_KEY, opts)
const PASSWORD = 'password123'

// Site admin: create a profile-less user, then insert the profile with the service role.
let { data: created, error } = await service.auth.admin.createUser({
  email: 'siteadmin@example.com', password: PASSWORD, email_confirm: true, user_metadata: { role: 'invited_admin' },
})
if (error && !/already/i.test(error.message)) throw error
if (created?.user) {
  const { error: pErr } = await service.from('profiles').insert({ user_id: created.user.id, role: 'site_admin' })
  if (pErr) throw pErr
  console.log('Created site admin siteadmin@example.com')
} else console.log('Site admin already exists')

// BYU admin through the real invite flow (exercises both Edge Functions).
const site = createClient(st.API_URL, st.ANON_KEY, opts)
await site.auth.signInWithPassword({ email: 'siteadmin@example.com', password: PASSWORD })
const { data: byu } = await site.from('universities').select('id').eq('name', 'Brigham Young University').single()
const invite = await site.functions.invoke('invite-university-admin', { body: { university_id: byu.id, email: 'admin@byu.example' } })
if (invite.error) {
  console.log('BYU admin invite skipped:', (await invite.error.context?.json?.())?.error ?? invite.error.message)
} else {
  const token = invite.data.link.split('/').pop()
  const accept = await site.functions.invoke('accept-admin-invite', {
    body: { action: 'accept', token, password: PASSWORD, scheduling_url: 'https://scheduling.byu.example' },
  })
  if (accept.error) throw accept.error
  console.log('Created BYU admin admin@byu.example (BYU is now participating)')
}
