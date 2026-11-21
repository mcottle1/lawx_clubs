#!/usr/bin/env node
// Clears ALL data from a CampusBridge project except site administrators, so
// you can start over (e.g. then load fresh demo data with seed-demo.mjs).
//
// Deletes:  every account that isn't a site admin (clubs, partners, college and
//           organization admins, half-finished sign-ups) and everything they own
//           (events, reports, receipts, members, opportunities, proposals,
//           messages, files...), all colleges, admin invites, the email log, and
//           every uploaded file.
// Resets:   every university to not participating, default colors, "College".
// Keeps:    site admin accounts, the universities list, and the database structure.
//
// Shows what it would delete unless you add --yes.
//   Local:   node scripts/wipe-data.mjs [--yes]
//   Hosted:  SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/wipe-data.mjs [--yes]
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const doIt = process.argv.includes('--yes')
let url = process.env.SUPABASE_URL
let key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  const st = JSON.parse(execSync('npx supabase status -o json', { stdio: ['ignore', 'pipe', 'ignore'] }).toString())
  url = st.API_URL
  key = st.SERVICE_ROLE_KEY
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data }
const BUCKETS = ['logos', 'flyers', 'club-docs', 'receipts', 'email-attachments']

// ---- what's there -----------------------------------------------------------------
const users = []
for (let page = 1; page < 100; page++) {
  const data = must(await db.auth.admin.listUsers({ page, perPage: 1000 }), 'list users')
  users.push(...data.users)
  if (data.users.length < 1000) break
}
const siteAdmins = new Set(must(await db.from('profiles').select('user_id').eq('role', 'site_admin'), 'site admins').map((p) => p.user_id))
const keep = users.filter((u) => siteAdmins.has(u.id))
const remove = users.filter((u) => !siteAdmins.has(u.id))
if (keep.length === 0) {
  console.error('No site admin account found. Refusing to delete everyone; make yourself a site admin first (README step 10).')
  process.exit(1)
}

async function listFiles(bucket, prefix = '') {
  const out = []
  for (let offset = 0; ; offset += 1000) {
    const items = must(await db.storage.from(bucket).list(prefix, { limit: 1000, offset }), `list ${bucket}/${prefix}`)
    for (const it of items) {
      const path = prefix ? `${prefix}/${it.name}` : it.name
      if (it.id === null) out.push(...await listFiles(bucket, path)) // a folder
      else out.push(path)
    }
    if (items.length < 1000) break
  }
  return out
}
const files = {}
for (const b of BUCKETS) files[b] = await listFiles(b)
const count = async (table) => (await db.from(table).select('*', { count: 'exact', head: true })).count ?? 0

console.log(`Project: ${url}`)
console.log(`Keeping ${keep.length} site admin account(s): ${keep.map((u) => u.email).join(', ')}`)
console.log(`Deleting ${remove.length} other account(s) and everything they own`)
console.log(`  (${await count('clubs')} clubs, ${await count('partners')} partners, ${await count('events')} events, ${await count('proposals')} proposals)`)
console.log(`Deleting ${await count('departments')} colleges, ${await count('admin_invites')} admin invites, ${await count('email_log')} email log rows`)
console.log(`Deleting ${Object.values(files).flat().length} uploaded files (${BUCKETS.map((b) => `${b}: ${files[b].length}`).join(', ')})`)
console.log('Resetting every university to not participating, default colors and "College"')

if (!doIt) {
  console.log('\nNothing was changed. Re-run with --yes to do it.')
  process.exit(0)
}

// ---- delete -------------------------------------------------------------------
for (const b of BUCKETS) {
  for (let i = 0; i < files[b].length; i += 500) must(await db.storage.from(b).remove(files[b].slice(i, i + 500)), `remove files from ${b}`)
}
let n = 0
for (const u of remove) {
  must(await db.auth.admin.deleteUser(u.id), `delete ${u.email}`)
  if (++n % 25 === 0) console.log(`  …${n}/${remove.length} accounts deleted`)
}
const all = (q) => q.not('id', 'is', null) // the API needs a filter to delete/update every row
must(await all(db.from('admin_invites').delete()), 'admin invites')
must(await all(db.from('departments').delete()), 'colleges')
must(await all(db.from('email_log').delete()), 'email log')
must(await all(db.from('universities').update({
  is_participating: false, theme_primary: null, theme_pop: null, theme_fresh: null, unit_label: 'College',
})), 'universities')

console.log(`\nDone. Left: ${await count('profiles')} profile(s) (your site admins), ${await count('clubs')} clubs, ${await count('partners')} partners, ${await count('departments')} colleges.`)
console.log('Load fresh demo data with: node scripts/seed-demo.mjs --yes   (add SUPABASE_URL=... in front for your hosted project)')
