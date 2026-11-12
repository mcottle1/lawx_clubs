// Phase 1 RLS / sign-up checks against a LOCAL Supabase (npx supabase start).
// Usage: node scripts/test-rls.mjs   (reads URL/keys from `npx supabase status`)
// Expects: universities seeded, BYU participating (accept an admin invite first)
// and a site admin siteadmin@example.com / password123.
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'

const st = JSON.parse(execSync('npx supabase status -o json', { stdio: ['ignore', 'pipe', 'ignore'] }).toString())
const URL = st.API_URL, ANON = st.ANON_KEY
const client = () => createClient(URL, ANON, { auth: { persistSession: false } })
let failures = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failures++ }
const stamp = Date.now()

const anon = client()
const { data: unis } = await anon.from('universities').select('id, name, is_participating')
check('anon can list universities', unis?.length >= 50, `(${unis?.length})`)
const byu = unis.find((u) => u.name === 'Brigham Young University')
const utah = unis.find((u) => u.name === 'University of Utah')
check('BYU is participating', byu?.is_participating === true)

// --- sign-ups ---------------------------------------------------------------
async function signUp(email, data) {
  const c = client()
  const { error } = await c.auth.signUp({ email, password: 'password123', options: { data } })
  if (!error) await c.auth.signInWithPassword({ email, password: 'password123' })
  return { c, error }
}
const club = await signUp(`club${stamp}@example.com`, { role: 'club', club_name: 'Test Club', university_id: byu.id, initial_budget: '1500', description: 'hi' })
check('club sign-up succeeds', !club.error, club.error?.message)
const badUni = await signUp(`club2${stamp}@example.com`, { role: 'club', club_name: 'X', university_id: utah.id })
check('club sign-up at non-participating university fails', !!badUni.error)
const evil = await signUp(`evil${stamp}@example.com`, { role: 'site_admin' })
check('site_admin self sign-up fails', !!evil.error)
const evil2 = await signUp(`evil2${stamp}@example.com`, { role: 'university_admin' })
check('university_admin self sign-up fails', !!evil2.error)
const inv = await signUp(`inv${stamp}@example.com`, { role: 'invited_admin' })
const { data: invProfile } = await inv.c.from('profiles').select('role')
check('"invited_admin" self sign-up gets no profile', (invProfile ?? []).length === 0)
const { data: invPartners } = await inv.c.from('partners').select('id')
check('profile-less user sees no partners', (invPartners ?? []).length === 0)
const partner = await signUp(`partner${stamp}@example.com`, { role: 'partner', partner_name: 'Test Firm', city: 'Provo', state: 'ut', category: 'law_firm', open_to_sponsorships: true })
check('partner sign-up succeeds', !partner.error, partner.error?.message)
const badPartner = await signUp(`partner2${stamp}@example.com`, { role: 'partner', partner_name: 'X', city: 'Provo', state: 'UT', category: 'casino' })
check('partner with invalid category fails', !!badPartner.error)

// --- club permissions -------------------------------------------------------
const { data: myClub } = await club.c.from('clubs').select('*')
check('club sees exactly its own club', myClub?.length === 1 && myClub[0].initial_budget == 1500)
const { error: roleErr } = await club.c.from('profiles').update({ role: 'site_admin' }).eq('user_id', myClub[0].user_id)
check('club cannot change own role', !!roleErr)
const { data: uniUpd } = await club.c.from('clubs').update({ university_id: utah.id }).eq('id', myClub[0].id).select()
check('club cannot move to another university', !uniUpd?.length || uniUpd[0].university_id === byu.id)
const { data: nameUpd } = await club.c.from('clubs').update({ name: 'Renamed Club' }).eq('id', myClub[0].id).select()
check('club can rename itself', nameUpd?.[0]?.name === 'Renamed Club')
const { data: clubSeesAdmin } = await club.c.from('university_admins').select('scheduling_url')
check('club reads its university scheduling info', clubSeesAdmin?.length === 1)
const { data: clubInv } = await club.c.from('admin_invites').select('id')
check('club cannot read invites', (clubInv ?? []).length === 0)
const { error: uniWrite } = await club.c.from('universities').update({ is_participating: true }).eq('id', utah.id)
const { data: utahNow } = await anon.from('universities').select('is_participating').eq('id', utah.id).single()
check('club cannot mark universities participating', utahNow.is_participating === false, uniWrite?.message ?? '')

// --- partner permissions ----------------------------------------------------
const { data: pClubs } = await partner.c.from('clubs').select('id')
check('partner cannot read club rows (budgets)', (pClubs ?? []).length === 0)
const { data: pPartners } = await partner.c.from('partners').select('id, state')
check('partner can read partner directory', pPartners?.length >= 1)
const { data: pOwn } = await partner.c.from('partners').select('state').eq('email', `partner${stamp}@example.com`).single()
check('partner state was upper-cased', pOwn?.state === 'UT')
const { data: pUpdOther } = await partner.c.from('partners').update({ name: 'hijack' }).neq('email', `partner${stamp}@example.com`).select()
check('partner cannot edit other partners', (pUpdOther ?? []).length === 0)

// --- university admin -------------------------------------------------------
const admin = client()
await admin.auth.signInWithPassword({ email: 'admin@byu.example', password: 'password123' })
const { data: aClubs } = await admin.from('clubs').select('id, university_id')
check('BYU admin sees BYU clubs only', aClubs?.length >= 1 && aClubs.every((c) => c.university_id === byu.id))
const { data: aUpd } = await admin.from('university_admins').update({ scheduling_instructions: 'Email rooms@byu.example' }).eq('university_id', byu.id).select()
check('admin updates own scheduling info', aUpd?.length === 1)

// --- site admin + deactivation ---------------------------------------------
const site = client()
await site.auth.signInWithPassword({ email: 'siteadmin@example.com', password: 'password123' })
const { data: allProfiles } = await site.from('profiles').select('user_id, role')
check('site admin sees all profiles', allProfiles?.length >= 4)
const clubUserId = myClub[0].user_id
const { error: deErr } = await site.from('profiles').update({ is_active: false }).eq('user_id', clubUserId)
check('site admin can deactivate a club', !deErr, deErr?.message)
const { data: afterDeact } = await club.c.from('clubs').select('id')
check('deactivated club loses access to its data', (afterDeact ?? []).length === 0)
await site.from('profiles').update({ is_active: true }).eq('user_id', clubUserId)

// --- storage ----------------------------------------------------------------
const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
const { data: pu } = await partner.c.auth.getUser()
const own = await partner.c.storage.from('logos').upload(`${pu.user.id}/logo.png`, png, { upsert: true })
check('partner uploads logo to own folder', !own.error, own.error?.message)
const other = await partner.c.storage.from('logos').upload(`${clubUserId}/logo.png`, png, { upsert: true })
check('partner cannot upload into another user folder', !!other.error)
const pdf = await partner.c.storage.from('logos').upload(`${pu.user.id}/x.pdf`, new Blob(['%PDF'], { type: 'application/pdf' }))
check('logos bucket rejects non-images', !!pdf.error)

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
