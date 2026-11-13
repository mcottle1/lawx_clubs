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


// =============================================================================
// Phase 2: events, to-dos, member counts, files, budget
// =============================================================================
console.log('\n--- Phase 2 ---')
const service = createClient(URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const clubA = club.c
const { data: clubARow } = await clubA.from('clubs').select('id, user_id').single()
const clubB = await signUp(`clubb${stamp}@example.com`, { role: 'club', club_name: 'Club B', university_id: byu.id, initial_budget: '500' })
const { data: clubBRow } = await clubB.c.from('clubs').select('id').single()
const inDays = (d, h = 12) => { const t = new Date(); t.setDate(t.getDate() + d); t.setHours(h, 0, 0, 0); return t.toISOString() }

const { data: ev, error: evErr } = await clubA.from('events').insert({
  club_id: clubARow.id, name: 'Speaker Lunch', starts_at: inDays(20), ends_at: inDays(20, 13),
  time_zone: 'America/Denver', budget: 300, partner_reminder_days: 7,
}).select().single()
check('club creates future event (pending)', !evErr && ev?.approval_status === 'pending', evErr?.message)
const { data: sysTodos } = await clubA.from('todos').select('system_kind, done, due_on').eq('related_event_id', ev.id)
check('system to-dos created for missing sponsor + room', sysTodos?.length === 2 && sysTodos.every((t) => !t.done))
const sponsorTodo = sysTodos.find((t) => t.system_kind === 'find_sponsor')
const eventDay = new Date(inDays(20)); eventDay.setDate(eventDay.getDate() - 7)
check('find-sponsor due date = event date − reminder days', sponsorTodo?.due_on === eventDay.toLocaleDateString('en-CA', { timeZone: 'America/Denver' }), sponsorTodo?.due_on)

const { error: pastErr } = await clubA.from('events').insert({ club_id: clubARow.id, name: 'Old', starts_at: inDays(-2), ends_at: inDays(-2, 13) })
check('club cannot create a past event', !!pastErr)
const { error: approveIns } = await clubA.from('events').insert({ club_id: clubARow.id, name: 'Sneaky', starts_at: inDays(5), ends_at: inDays(5, 13), approval_status: 'approved' })
check('club cannot insert an approved event', !!approveIns)
const { error: approveUpd } = await clubA.from('events').update({ approval_status: 'approved' }).eq('id', ev.id)
check('club cannot approve its own event', !!approveUpd)
const { error: otherClubIns } = await clubB.c.from('events').insert({ club_id: clubARow.id, name: 'X', starts_at: inDays(5), ends_at: inDays(5, 13) })
check('club cannot create events for another club', !!otherClubIns)

await clubA.from('events').update({ location: 'Room 101' }).eq('id', ev.id)
const { data: roomTodo } = await clubA.from('todos').select('done').eq('related_event_id', ev.id).eq('system_kind', 'book_room').single()
check('adding a location completes "Book a room"', roomTodo?.done === true)

await service.from('events').update({ approval_status: 'approved' }).eq('id', ev.id)
await clubA.from('events').update({ flyer_path: null }).eq('id', ev.id)
const { data: stillApproved } = await clubA.from('events').select('approval_status').eq('id', ev.id).single()
check('cosmetic edit keeps approval', stillApproved?.approval_status === 'approved')
await clubA.from('events').update({ budget: 400 }).eq('id', ev.id)
const { data: reset } = await clubA.from('events').select('approval_status').eq('id', ev.id).single()
check('changing details sends approved event back to pending', reset?.approval_status === 'pending')

const { data: past } = await service.from('events').insert({ club_id: clubARow.id, name: 'Past Mixer', starts_at: inDays(-10), ends_at: inDays(-10, 14), budget: 200, approval_status: 'approved' }).select().single()
const { error: pastEdit } = await clubA.from('events').update({ name: 'Changed' }).eq('id', past.id)
check('club cannot edit a past event', !!pastEdit)
const { error: pastDel } = await clubA.from('events').delete().eq('id', past.id)
check('club cannot delete a past event', !!pastDel)

const { data: bSeesEvents } = await clubB.c.from('events').select('id')
check('other club sees none of club A events', (bSeesEvents ?? []).length === 0)
const { data: bSeesTodos } = await clubB.c.from('todos').select('id').eq('club_id', clubARow.id)
check('other club sees none of club A to-dos', (bSeesTodos ?? []).length === 0)
const { data: adminEvents } = await admin.from('events').select('id, club_id')
check('BYU admin sees BYU events', adminEvents?.some((e) => e.id === ev.id))
const { data: partnerEvents } = await partner.c.from('events').select('id')
check('partner sees no club events (yet)', (partnerEvents ?? []).length === 0)

// to-dos
const { error: sysIns } = await clubA.from('todos').insert({ club_id: clubARow.id, title: 'fake', source: 'system' })
check('club cannot create system to-dos', !!sysIns)
const { data: manual, error: manErr } = await clubA.from('todos').insert({ club_id: clubARow.id, title: 'Order pizza', due_on: '2030-01-01' }).select().single()
check('club adds manual to-do', !manErr && manual?.source === 'manual', manErr?.message)
const { data: doneTodo } = await clubA.from('todos').update({ done: true }).eq('id', manual.id).select().single()
check('completing a to-do stamps done_at', !!doneTodo?.done_at)

// member counts
const today = new Date().toLocaleDateString('en-CA')
const mc1 = await clubA.from('club_member_counts').upsert({ club_id: clubARow.id, count: 40, recorded_on: today }, { onConflict: 'club_id,recorded_on' })
const mc2 = await clubA.from('club_member_counts').upsert({ club_id: clubARow.id, count: 42, recorded_on: today, source: 'roster' }, { onConflict: 'club_id,recorded_on' })
const { data: counts } = await clubA.from('club_member_counts').select('count')
check('member count upsert replaces same-day value', !mc1.error && !mc2.error && counts?.length === 1 && counts[0].count === 42, mc2.error?.message)
const { error: mcOther } = await clubB.c.from('club_member_counts').insert({ club_id: clubARow.id, count: 1 })
check('club cannot record counts for another club', !!mcOther)
const { data: adminCounts } = await admin.from('club_member_counts').select('count')
check('BYU admin reads member counts', adminCounts?.length >= 1)

// storage + club_files
const pdfBlob = new Blob(['%PDF-1.4'], { type: 'application/pdf' })
const flyerPath = `${clubARow.user_id}/flyer-${stamp}.pdf`
const upFlyer = await clubA.storage.from('flyers').upload(flyerPath, pdfBlob)
check('club uploads flyer to own folder', !upFlyer.error, upFlyer.error?.message)
const upWrong = await clubA.storage.from('flyers').upload(`${pu.user.id}/hijack.pdf`, pdfBlob)
check('club cannot upload into another user folder', !!upWrong.error)
const upPartner = await partner.c.storage.from('flyers').upload(`${pu.user.id}/x.pdf`, pdfBlob)
check('partner cannot upload flyers', !!upPartner.error)
const { error: fileErr } = await clubA.from('club_files').insert({ club_id: clubARow.id, file_type: 'flyer', bucket: 'flyers', storage_path: flyerPath, file_name: 'flyer.pdf', event_id: ev.id })
check('club records its flyer file', !fileErr, fileErr?.message)
const { error: fileSpoof } = await clubB.c.from('club_files').insert({ club_id: clubBRow.id, file_type: 'other', bucket: 'flyers', storage_path: flyerPath, file_name: 'x.pdf' })
check('club cannot register another user\'s storage file', !!fileSpoof)
const { error: fileEvSpoof } = await clubA.from('club_files').insert({ club_id: clubARow.id, file_type: 'flyer', bucket: 'flyers', storage_path: `${clubARow.user_id}/y.pdf`, file_name: 'y.pdf', event_id: (await service.from('events').insert({ club_id: clubBRow.id, name: 'B event', starts_at: inDays(9), ends_at: inDays(9, 13) }).select().single()).data.id })
check('club cannot attach files to another club\'s event', !!fileEvSpoof)
const docPath = `${clubARow.user_id}/constitution-${stamp}.pdf`
await clubA.storage.from('club-docs').upload(docPath, pdfBlob)
const signedOwn = await clubA.storage.from('club-docs').createSignedUrl(docPath, 60)
check('club gets signed URL for own private doc', !!signedOwn.data?.signedUrl)
const signedOther = await clubB.c.storage.from('club-docs').createSignedUrl(docPath, 60)
check('other club cannot read private doc', !signedOther.data?.signedUrl)
const exe = await clubA.storage.from('club-docs').upload(`${clubARow.user_id}/x.exe`, new Blob(['MZ'], { type: 'application/x-msdownload' }))
check('club-docs rejects disallowed file types', !!exe.error)

// budget
await service.from('clubs').update({ budget_year_start: '2000-01-01' }).eq('id', clubARow.id)
await service.from('event_reports').insert({ event_id: past.id, attendees: 35, amount_spent: 180.5 })
const { data: budget } = await clubA.from('club_budget_summary').select('*')
check('budget view: remaining = initial − reported spending', budget?.length === 1 && Number(budget[0].remaining) === 1319.5, JSON.stringify(budget?.[0]))
const { data: bBudget } = await clubB.c.from('club_budget_summary').select('club_id')
check('budget view only shows own club', bBudget?.length === 1 && bBudget[0].club_id === clubBRow.id)
const { data: pBudget } = await partner.c.from('club_budget_summary').select('club_id')
check('partner sees no club budgets', (pBudget ?? []).length === 0)
const { data: reports } = await clubA.from('event_reports').select('attendees')
check('club reads own event reports', reports?.length === 1)
const { error: repIns } = await clubA.from('event_reports').insert({ event_id: ev.id, attendees: 1 })
check('club cannot write reports yet (Phase 4)', !!repIns)

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
