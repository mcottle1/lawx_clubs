#!/usr/bin/env node
// LOCAL DEVELOPMENT ONLY. After `npx supabase start` (or `db reset`) and
// `npx supabase functions serve`, creates:
//   * site admin                 siteadmin@example.com / password123
//   * BYU organization admin     orgadmin@byu.example  / password123
//   * BYU college "BYU Law" with college admin admin@byu.example / password123
//     (makes BYU and the college participating)
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

// BYU admins through the real invite flow (exercises both Edge Functions).
const site = createClient(st.API_URL, st.ANON_KEY, opts)
await site.auth.signInWithPassword({ email: 'siteadmin@example.com', password: PASSWORD })
const { data: byu } = await site.from('universities').select('id').eq('name', 'Brigham Young University').single()

async function inviteAndAccept(inviter, body, extra = {}) {
  const invite = await inviter.functions.invoke('invite-university-admin', { body })
  if (invite.error) throw new Error((await invite.error.context?.json?.())?.error ?? invite.error.message)
  const token = invite.data.link.split('/').pop()
  const accept = await site.functions.invoke('accept-admin-invite', { body: { action: 'accept', token, password: PASSWORD, ...extra } })
  if (accept.error) throw new Error((await accept.error.context?.json?.())?.error ?? accept.error.message)
}

const { data: existingOrg } = await site.from('org_admins').select('id').eq('email', 'orgadmin@byu.example').maybeSingle()
if (existingOrg) console.log('BYU organization admin already exists')
else {
  await inviteAndAccept(site, { kind: 'org', university_id: byu.id, email: 'orgadmin@byu.example' })
  console.log('Created BYU organization admin orgadmin@byu.example')
}

// The organization admin adds a college and invites its admin.
const org = createClient(st.API_URL, st.ANON_KEY, opts)
await org.auth.signInWithPassword({ email: 'orgadmin@byu.example', password: PASSWORD })
let { data: college } = await org.from('departments').select('id').eq('university_id', byu.id).eq('name', 'BYU Law').maybeSingle()
if (!college) {
  const { data, error } = await org.from('departments').insert({ university_id: byu.id, name: 'BYU Law' }).select('id').single()
  if (error) throw error
  college = data
}
const { data: existingAdmin } = await site.from('department_admins').select('id').eq('email', 'admin@byu.example').maybeSingle()
if (existingAdmin) console.log('BYU Law admin already exists')
else {
  await inviteAndAccept(org, { kind: 'department', department_id: college.id, email: 'admin@byu.example' }, { scheduling_url: 'https://scheduling.byu.example' })
  console.log('Created BYU Law college admin admin@byu.example (BYU is now participating)')
}
