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
// Any university that isn't participating (earlier test runs may have activated some).
const utah = unis.find((u) => !u.is_participating && u.name !== 'Utah State University')
check('BYU is participating', byu?.is_participating === true)
const { data: byuLaw } = await anon.from('departments').select('id, is_participating').eq('university_id', byu.id).eq('name', 'BYU Law').single()
check('BYU Law (a college with an admin) is participating', byuLaw?.is_participating === true)

// --- sign-ups ---------------------------------------------------------------
async function signUp(email, data) {
  const c = client()
  const { error } = await c.auth.signUp({ email, password: 'password123', options: { data } })
  if (!error) await c.auth.signInWithPassword({ email, password: 'password123' })
  return { c, error }
}
const club = await signUp(`club${stamp}@example.com`, { role: 'club', club_name: 'Test Club', university_id: byu.id, department_id: byuLaw.id, initial_budget: '1500', description: 'hi' })
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
const { data: clubSeesAdmin } = await club.c.from('department_settings').select('scheduling_url')
check('club reads its college scheduling info', clubSeesAdmin?.length === 1)
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
const { data: aUpd } = await admin.from('department_settings').update({ scheduling_instructions: 'Email rooms@byu.example' }).eq('department_id', byuLaw.id).select()
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
const clubB = await signUp(`clubb${stamp}@example.com`, { role: 'club', club_name: 'Club B', university_id: byu.id, department_id: byuLaw.id, initial_budget: '500' })
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
check('club cannot report on an event that has not happened', !!repIns)


// =============================================================================
// Phase 3: opportunities, conversations, proposals, approvals
// =============================================================================
console.log('\n--- Phase 3 ---')
const partnerC = partner.c
// This section covers the flow without approval steps; the "Approvals" section turns them on.
const { error: settingsErr } = await admin.from('department_settings')
  .update({ require_message_approval: false, require_opportunity_approval: false, require_proposal_approval: false })
  .eq('department_id', byuLaw.id)
check('admin turns approval settings off', !settingsErr, settingsErr?.message)
const { data: partnerRow } = await partnerC.from('partners').select('id').eq('email', `partner${stamp}@example.com`).single()

// A second university with its own admin (idempotent across runs).
const { data: usu } = await anon.from('universities').select('id').eq('name', 'Utah State University').single()
// (a college admin at Utah State; the site admin adds the college)
let { data: usuLaw } = await site.from('departments').select('id').eq('university_id', usu.id).eq('name', 'USU College').maybeSingle()
if (!usuLaw) usuLaw = (await site.from('departments').insert({ university_id: usu.id, name: 'USU College' }).select('id').single()).data
const { data: usuExisting } = await site.from('department_admins').select('id').eq('email', 'admin@usu.example').maybeSingle()
const inv2 = usuExisting ? { error: 'exists' } : await site.functions.invoke('invite-university-admin', { body: { kind: 'department', department_id: usuLaw.id, email: 'admin@usu.example' } })
if (!inv2.error) {
  await site.functions.invoke('accept-admin-invite', { body: { action: 'accept', token: inv2.data.link.split('/').pop(), password: 'password123', scheduling_instructions: 'Email rooms@usu.example' } })
}
const usuAdmin = client()
await usuAdmin.auth.signInWithPassword({ email: 'admin@usu.example', password: 'password123' })

// opportunities
await service.from('events').update({ approval_status: 'approved', partner_id: null, outside_sponsor_name: null }).eq('id', ev.id)
const { data: opp, error: oppErr } = await clubA.from('opportunities').insert({
  club_id: clubARow.id, event_id: ev.id, title: 'Sponsor our Speaker Lunch', description: 'Lunch for 40 students',
  support_type: 'food', amount_sought: 400,
}).select().single()
check('club posts an opportunity for its event', !oppErr, oppErr?.message)
const { data: bEvent } = await service.from('events').select('id').eq('club_id', clubBRow.id).limit(1).single()
const { error: oppBad } = await clubA.from('opportunities').insert({ club_id: clubARow.id, event_id: bEvent.id, title: 'x' })
check('club cannot link an opportunity to another club\'s event', !!oppBad)
const { data: cards } = await partnerC.from('opportunity_cards').select('*').eq('id', opp.id)
check('partner sees open opportunity with club + university names', cards?.length === 1 && cards[0].club_name && cards[0].university_name)
check('opportunity card exposes no budget fields', cards?.[0] && !('initial_budget' in cards[0]) && !('budget' in cards[0]))
const { data: bCards } = await clubB.c.from('opportunity_cards').select('id').eq('id', opp.id)
check('another club cannot see the opportunity', (bCards ?? []).length === 0)
const { error: oppUpd } = await partnerC.from('opportunities').update({ title: 'hijack' }).eq('id', opp.id)
const { data: oppAfter } = await clubA.from('opportunities').select('title').eq('id', opp.id).single()
check('partner cannot edit opportunities', oppAfter.title !== 'hijack', oppUpd?.message ?? '')
const { data: pub } = await anon.rpc('get_public_opportunity', { p_id: opp.id })
check('public share page shows open opportunity (no login)', pub?.title === 'Sponsor our Speaker Lunch' && !('budget' in (pub ?? {})))

// conversations + messages
const { data: convId, error: convErr } = await clubA.rpc('start_conversation', { p_partner_id: partnerRow.id, p_subject: 'Lunch?', p_body: 'Would you sponsor our lunch?' })
check('club starts a conversation with a partner', !convErr && !!convId, convErr?.message)
const { data: inbox } = await partnerC.from('conversation_list').select('*').eq('id', convId)
check('partner sees the new conversation as unread', inbox?.[0]?.unread === true && inbox[0].club_name)
const { data: pu2 } = await partnerC.auth.getUser()
const { error: replyErr } = await partnerC.from('messages').insert({ conversation_id: convId, sender_user_id: pu2.user.id, sender_role: 'partner', body: 'Happy to talk!' })
check('partner replies in the conversation', !replyErr, replyErr?.message)
const { error: spoofRole } = await partnerC.from('messages').insert({ conversation_id: convId, sender_user_id: pu2.user.id, sender_role: 'club', body: 'fake' })
check('partner cannot post as the club', !!spoofRole)
const { data: bUser } = await clubB.c.auth.getUser()
const { error: outsider } = await clubB.c.from('messages').insert({ conversation_id: convId, sender_user_id: bUser.user.id, sender_role: 'club', body: 'hi' })
check('outsider cannot post in the conversation', !!outsider)
const { data: bMsgs } = await clubB.c.from('messages').select('id').eq('conversation_id', convId)
check('outsider cannot read the conversation', (bMsgs ?? []).length === 0)
await partnerC.rpc('mark_conversation_read', { p_conversation_id: convId })
const { data: inbox2 } = await partnerC.from('conversation_list').select('unread').eq('id', convId).single()
check('mark read clears unread', inbox2?.unread === false)

// proposals
const { error: emptyProp } = await partnerC.rpc('submit_proposal', { p_opportunity_id: opp.id, p_message: 'just saying hi' })
check('proposal must offer something', !!emptyProp)
const { data: propId, error: propErr } = await partnerC.rpc('submit_proposal', { p_opportunity_id: opp.id, p_headcount: 40, p_pitch_minutes: 10, p_student_offer: '15% off', p_message: 'We can do it.' })
check('partner submits a proposal', !propErr && !!propId, propErr?.message)
const { error: dupProp } = await partnerC.rpc('submit_proposal', { p_opportunity_id: opp.id, p_amount: 100 })
check('no duplicate open proposals', !!dupProp)
const { data: clubProps } = await clubA.from('proposal_details').select('*').eq('id', propId)
check('club sees proposal (pending_club) with partner name', clubProps?.[0]?.status === 'pending_club' && clubProps[0].partner_name === 'Test Firm')
const { error: pResp } = await partnerC.rpc('respond_to_proposal', { p_proposal_id: propId, p_accept: true })
check('partner cannot accept its own proposal', !!pResp)
const { error: bResp } = await clubB.c.rpc('respond_to_proposal', { p_proposal_id: propId, p_accept: true })
check('another club cannot accept the proposal', !!bResp)
const { error: propIns } = await partnerC.from('proposals').insert({ club_id: clubARow.id, partner_id: partnerRow.id, amount: 5 })
check('proposals cannot be inserted directly', !!propIns)
const { data: accStatus, error: accErr } = await clubA.rpc('respond_to_proposal', { p_proposal_id: propId, p_accept: true })
check('club accepts → pending_admin', !accErr && accStatus === 'pending_admin', accErr?.message)
const { data: evAfter } = await clubA.from('events').select('partner_id, approval_status').eq('id', ev.id).single()
check('accepting puts partner on the event and sends it back for approval', evAfter.partner_id === partnerRow.id && evAfter.approval_status === 'pending')
const { data: oppFilled } = await clubA.from('opportunities').select('status').eq('id', opp.id).single()
check('opportunity marked filled', oppFilled.status === 'filled')
const { data: pEvents } = await partnerC.from('partner_events').select('*')
check('partner sees the sponsored event (no budget column)', pEvents?.some((e) => e.id === ev.id) && !('budget' in pEvents[0]))

// approvals
const { error: clubReview } = await clubA.rpc('review_event', { p_event_id: ev.id, p_approve: true })
check('club cannot approve its own event', !!clubReview)
const { error: usuReview } = await usuAdmin.rpc('review_event', { p_event_id: ev.id, p_approve: true })
check('another university\'s admin cannot review it', !!usuReview)
const { data: usuProps } = await usuAdmin.from('proposal_details').select('id').eq('id', propId)
check('another university\'s admin cannot see the proposal', (usuProps ?? []).length === 0)
const { error: noReason } = await admin.rpc('review_event', { p_event_id: ev.id, p_approve: false, p_reason: '  ' })
check('deny requires a reason', !!noReason)
const { error: apprErr } = await admin.rpc('review_event', { p_event_id: ev.id, p_approve: true })
const { data: evApproved } = await clubA.from('events').select('approval_status').eq('id', ev.id).single()
const { data: propApproved } = await clubA.from('proposals').select('status').eq('id', propId).single()
check('approving the event approves the partnership with it', !apprErr && evApproved.approval_status === 'approved' && propApproved.status === 'approved', apprErr?.message)
const { error: again } = await admin.rpc('review_event', { p_event_id: ev.id, p_approve: true })
check('already-reviewed event cannot be reviewed again', !!again)

// standalone partnership (opportunity without an event) → deny
const { data: opp2 } = await clubA.from('opportunities').insert({ club_id: clubARow.id, title: 'Year-long sponsor', support_type: 'funding', amount_sought: 1000 }).select().single()
const { data: prop2 } = await partnerC.rpc('submit_proposal', { p_opportunity_id: opp2.id, p_amount: 500 })
await clubA.rpc('respond_to_proposal', { p_proposal_id: prop2, p_accept: true })
const { error: denyErr } = await admin.rpc('review_proposal', { p_proposal_id: prop2, p_approve: false, p_reason: 'Conflicts with university sponsor policy' })
const { data: prop2After } = await partnerC.from('proposal_details').select('status, denial_reason').eq('id', prop2).single()
const { data: opp2After } = await clubA.from('opportunities').select('status').eq('id', opp2.id).single()
check('admin denies standalone partnership with reason; opportunity reopens', !denyErr && prop2After.status === 'denied' && prop2After.denial_reason && opp2After.status === 'open', denyErr?.message)

// proposal in a club-started conversation → withdraw
const { data: prop3, error: p3err } = await partnerC.rpc('submit_proposal', { p_conversation_id: convId, p_in_kind: 'Branded notebooks' })
check('partner proposes within a club-started conversation', !p3err && !!prop3, p3err?.message)
const { error: wErr } = await partnerC.rpc('withdraw_proposal', { p_proposal_id: prop3 })
const { data: prop3After } = await clubA.from('proposals').select('status').eq('id', prop3).single()
check('partner withdraws a proposal', !wErr && prop3After.status === 'withdrawn')
const { error: declineWithdrawn } = await clubA.rpc('respond_to_proposal', { p_proposal_id: prop3, p_accept: true })
check('withdrawn proposal cannot be accepted', !!declineWithdrawn)

// club decline path
const { data: opp3 } = await clubA.from('opportunities').insert({ club_id: clubARow.id, title: 'Snacks', support_type: 'food' }).select().single()
const { data: prop4 } = await partnerC.rpc('submit_proposal', { p_opportunity_id: opp3.id, p_headcount: 20 })
const { data: decl } = await clubA.rpc('respond_to_proposal', { p_proposal_id: prop4, p_accept: false })
check('club declines a proposal', decl === 'declined')
await clubA.from('opportunities').update({ status: 'closed' }).eq('id', opp3.id)
const { data: pubClosed } = await anon.rpc('get_public_opportunity', { p_id: opp3.id })
check('closed opportunity is not public', pubClosed === null)
const { error: closedProp } = await partnerC.rpc('submit_proposal', { p_opportunity_id: opp3.id, p_headcount: 5 })
check('cannot propose on a closed opportunity', !!closedProp)


// =============================================================================
// Phase 4: reports, receipts, partner results
// =============================================================================
console.log('\n--- Phase 4 ---')
const { data: ended } = await service.from('events').insert({
  club_id: clubARow.id, name: 'Ended Lunch', starts_at: inDays(-3), ends_at: inDays(-3, 13),
  approval_status: 'approved', partner_id: partnerRow.id, budget: 200, location: 'Room 9',
}).select().single()
const { data: deniedEnded } = await service.from('events').insert({
  club_id: clubARow.id, name: 'Denied Past', starts_at: inDays(-3), ends_at: inDays(-3, 13), approval_status: 'denied',
}).select().single()

const { data: rep, error: repErr } = await clubA.from('event_reports').insert({ event_id: ended.id, attendees: 52, amount_spent: 180, offers_redeemed: 7, notes: 'Packed room' }).select().single()
check('club reports on its ended event', !repErr && !!rep, repErr?.message)
const { data: fu } = await clubA.from('todos').select('title').eq('related_event_id', ended.id).eq('system_kind', 'follow_up').maybeSingle()
check('report adds "Follow up with sponsor" to-do', fu?.title?.startsWith('Follow up with Test Firm'))
const { error: futureRep } = await clubA.from('event_reports').insert({ event_id: ev.id, attendees: 1 })
check('cannot report on an event that has not ended', !!futureRep)
const { error: deniedRep } = await clubA.from('event_reports').insert({ event_id: deniedEnded.id, attendees: 1 })
check('cannot report on a denied event', !!deniedRep)
const { data: bEnded } = await service.from('events').insert({ club_id: clubBRow.id, name: 'B ended', starts_at: inDays(-2), ends_at: inDays(-2, 13), approval_status: 'approved' }).select().single()
const { error: otherRep } = await clubA.from('event_reports').insert({ event_id: bEnded.id, attendees: 1 })
check('cannot report on another club\'s event', !!otherRep)
const { data: repUpd } = await clubA.from('event_reports').update({ attendees: 55 }).eq('id', rep.id).select().single()
check('club can correct its report', repUpd?.attendees === 55)

// receipts
const rcptPath = `${clubARow.user_id}/receipt-${stamp}.pdf`
const upR = await clubA.storage.from('receipts').upload(rcptPath, pdfBlob)
check('club uploads receipt file to own folder', !upR.error, upR.error?.message)
const { data: rcpt, error: rcptErr } = await clubA.from('receipts').insert({
  club_id: clubARow.id, event_id: ended.id, event_report_id: rep.id, storage_path: rcptPath, file_name: 'pizza.pdf', amount: 180,
}).select().single()
check('club records receipt', !rcptErr && rcpt?.status === 'pending', rcptErr?.message)
const { error: rcptSpoof } = await clubB.c.from('receipts').insert({ club_id: clubBRow.id, event_id: ended.id, event_report_id: rep.id, storage_path: `${bUser.user.id}/x.pdf`, file_name: 'x', amount: 1 })
check('club cannot attach receipts to another club\'s report', !!rcptSpoof)
const { error: statusSpoof } = await clubA.from('receipts').update({ status: 'reimbursed' }).eq('id', rcpt.id)
const { data: rcptStill } = await clubA.from('receipts').select('status').eq('id', rcpt.id).single()
check('club cannot change receipt status', rcptStill.status === 'pending', statusSpoof?.message ?? '')
const { data: bR } = await clubB.c.from('receipts').select('id')
check('other club cannot see receipts', (bR ?? []).length === 0)
const bFile = await clubB.c.storage.from('receipts').createSignedUrl(rcptPath, 60)
check('other club cannot open receipt file', !bFile.data?.signedUrl)
const { data: pR } = await partnerC.from('receipts').select('id')
check('partner cannot see receipts', (pR ?? []).length === 0)
const adminFile = await admin.storage.from('receipts').createSignedUrl(rcptPath, 60)
check('university admin can open receipt file', !!adminFile.data?.signedUrl, adminFile.error?.message)
const usuFile = await usuAdmin.storage.from('receipts').createSignedUrl(rcptPath, 60)
check('other university admin cannot open receipt file', !usuFile.data?.signedUrl)
const { data: usuR } = await usuAdmin.from('receipts').select('id')
check('other university admin cannot see receipts', (usuR ?? []).length === 0)

const { error: skip } = await admin.rpc('review_receipt', { p_receipt_id: rcpt.id, p_status: 'reimbursed' })
check('cannot skip from pending straight to reimbursed', !!skip)
const { error: denyNoNote } = await admin.rpc('review_receipt', { p_receipt_id: rcpt.id, p_status: 'denied', p_note: '' })
check('denying a receipt needs a note', !!denyNoNote)
const { error: usuRev } = await usuAdmin.rpc('review_receipt', { p_receipt_id: rcpt.id, p_status: 'approved' })
check('other university admin cannot review the receipt', !!usuRev)
const { error: clubRev } = await clubA.rpc('review_receipt', { p_receipt_id: rcpt.id, p_status: 'approved' })
check('club cannot review its own receipt', !!clubRev)
const { error: apprR } = await admin.rpc('review_receipt', { p_receipt_id: rcpt.id, p_status: 'approved' })
const { error: paidR } = await admin.rpc('review_receipt', { p_receipt_id: rcpt.id, p_status: 'reimbursed', p_note: 'Check #1042' })
const { data: rcptDone } = await clubA.from('receipts').select('status, reimbursed_at, admin_note').eq('id', rcpt.id).single()
check('admin approves then marks reimbursed', !apprR && !paidR && rcptDone.status === 'reimbursed' && rcptDone.reimbursed_at && rcptDone.admin_note === 'Check #1042')
await clubA.from('receipts').delete().eq('id', rcpt.id)
const { data: rcptKept } = await clubA.from('receipts').select('id').eq('id', rcpt.id)
check('club cannot delete a processed receipt', rcptKept?.length === 1)

// partner results
const { data: results } = await partnerC.from('partner_event_results').select('*')
const mineRes = results?.find((r) => r.event_id === ended.id)
check('partner sees results for sponsored event', mineRes?.attendees === 55 && mineRes?.offers_redeemed === 7 && mineRes?.notes === 'Packed room')
check('partner results do not include spending', mineRes && !('amount_spent' in mineRes))
const { data: bResults } = await clubB.c.from('partner_event_results').select('event_id')
check('non-partners see no partner results', (bResults ?? []).length === 0)


// =============================================================================
// Phase 5: suggestion helpers return aggregates only
// =============================================================================
console.log('\n--- Phase 5 ---')
const { data: stats, error: statsErr } = await clubA.rpc('partner_match_stats')
const mineStats = stats?.find((r) => r.partner_id === partnerRow.id)
check('club gets partner sponsorship counts', !statsErr && mineStats?.with_club >= 1 && mineStats?.at_university >= 1, statsErr?.message ?? JSON.stringify(mineStats))
check('stats are aggregates only (no club or event details)', mineStats && Object.keys(mineStats).sort().join(',') === 'at_university,last_sponsored_at,partner_id,with_club')
const { data: bStats } = await clubB.c.rpc('partner_match_stats')
check('stats are relative to the calling club', (bStats ?? []).find((r) => r.partner_id === partnerRow.id)?.with_club === 0)
const { data: pStats } = await partnerC.rpc('partner_match_stats')
check('partners get no stats', (pStats ?? []).length === 0)
const { error: anonStats } = await anon.rpc('partner_match_stats')
check('logged-out users cannot call stats', !!anonStats)
const { data: amt, error: amtErr } = await clubA.rpc('proposal_amount_stats', { p_support_type: 'funding' })
check('club gets a median-amount summary', !amtErr && amt?.length === 1 && ['university', 'site', 'none'].includes(amt[0].scope), amtErr?.message)
const { data: pAmt } = await partnerC.rpc('proposal_amount_stats', { p_support_type: 'funding' })
check('partners get no amount summary', (pAmt ?? []).length === 0)
const { data: aiRows } = await partnerC.from('ai_usage').select('id')
check('partners cannot read AI usage', (aiRows ?? []).length === 0)

// =============================================================================
// Members, leadership roles, emailing members
// =============================================================================
console.log('\n--- Members ---')
const { data: addM, error: addMErr } = await clubA.from('club_members').insert([
  { club_id: clubARow.id, name: 'Ann Lee', email: `ann${stamp}@example.com`, role: 'President' },
  { club_id: clubARow.id, name: 'Bo Park', email: `bo${stamp}@example.com` },
]).select()
check('club adds members', !addMErr && addM?.length === 2, addMErr?.message)
const { error: dupM } = await clubA.from('club_members').insert({ club_id: clubARow.id, name: 'Dup', email: `ANN${stamp}@example.com` })
check('duplicate member email (any case) is rejected', dupM?.code === '23505', dupM?.message)
const { error: badEmail } = await clubA.from('club_members').insert({ club_id: clubARow.id, name: 'X', email: 'not-an-email' })
check('invalid member email is rejected', !!badEmail)
const { error: otherClubM } = await clubA.from('club_members').insert({ club_id: clubBRow.id, name: 'X', email: `x${stamp}@example.com` })
check('club cannot add members to another club', !!otherClubM)
const { data: bSeesM } = await clubB.c.from('club_members').select('id')
check('other clubs cannot see members', (bSeesM ?? []).length === 0)
const { data: pSeesM } = await partner.c.from('club_members').select('id')
check('partners cannot see members', (pSeesM ?? []).length === 0)
const { data: aSeesM } = await admin.from('club_members').select('id')
check('university admins cannot see member emails', (aSeesM ?? []).length === 0)
const { data: siteSeesM } = await site.from('club_members').select('id').eq('club_id', clubARow.id)
check('site admin can read members', siteSeesM?.length === 2)
const { data: bUpdM } = await clubB.c.from('club_members').update({ role: 'Hacker' }).eq('club_id', clubARow.id).select()
check('other clubs cannot edit members', (bUpdM ?? []).length === 0)
const { error: moveM } = await clubA.from('club_members').update({ club_id: clubBRow.id }).eq('id', addM[1].id)
check('club cannot move a member to another club', !!moveM)
const { data: roleUpd } = await clubA.from('club_members').update({ role: 'Treasurer' }).eq('id', addM[1].id).select()
check('club sets a free-text leadership role', roleUpd?.[0]?.role === 'Treasurer')

// member count follows the list once the club opts in
await service.from('club_member_counts').delete().eq('club_id', clubARow.id)
await service.from('club_member_counts').insert({ club_id: clubARow.id, count: 61, recorded_on: '2026-01-01', source: 'manual' })
await clubA.from('club_members').insert({ club_id: clubARow.id, name: 'Cy Diaz', email: `cy${stamp}@example.com` })
const latestCount = async () => (await clubA.from('club_member_counts').select('count, source').order('recorded_on', { ascending: false }).limit(1).single()).data
check('a manual count is not overwritten by list changes', (await latestCount())?.count === 61)
const { data: used, error: usedErr } = await clubA.rpc('use_member_list_for_count')
check('club switches the count to follow the list', !usedErr && used === 3, usedErr?.message)
await clubA.from('club_members').delete().eq('email', `cy${stamp}@example.com`)
const afterDel = await latestCount()
check('count follows the list after removing a member', afterDel?.count === 2 && afterDel?.source === 'members', JSON.stringify(afterDel))
const { error: pUseList } = await partner.c.rpc('use_member_list_for_count')
check('partners cannot call use_member_list_for_count', !!pUseList)

// email log + attachments bucket
const { error: logSpoof } = await clubA.from('member_emails').insert({ club_id: clubARow.id, audience: 'all', subject: 's', body: 'b', status: 'sent' })
check('clubs cannot write the member email log', !!logSpoof)
const attPath = `${clubARow.user_id}/email-${stamp}.pdf`
const attUp = await clubA.storage.from('email-attachments').upload(attPath, pdfBlob)
check('club uploads an email attachment to its own folder', !attUp.error, attUp.error?.message)
const attOther = await clubB.c.storage.from('email-attachments').download(attPath)
check('other clubs cannot read email attachments', !!attOther.error)
const attSpoof = await clubB.c.storage.from('email-attachments').upload(`${clubARow.user_id}/evil.pdf`, pdfBlob)
check('clubs cannot upload into another user\'s folder', !!attSpoof.error)
const attPartner = await partner.c.storage.from('email-attachments').upload(`${(await partner.c.auth.getUser()).data.user.id}/p.pdf`, pdfBlob)
check('partners cannot upload email attachments', !!attPartner.error)

// email-members function: who may call it and what it accepts (works with or without RESEND_API_KEY)
const callFn = async (c, body) => {
  const token = (await c.auth.getSession()).data.session?.access_token
  const res = await fetch(`${URL}/functions/v1/email-members`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
const fnPartner = await callFn(partner.c, { audience: 'all', subject: 'Hi', body: 'Hello' })
check('partners cannot email club members', fnPartner.status === 403, JSON.stringify(fnPartner))
const fnNoSubject = await callFn(clubA, { audience: 'all', subject: '', body: 'Hello' })
check('email requires a subject', fnNoSubject.status === 400)
const fnBPath = await callFn(clubB.c, { audience: 'all', subject: 'Hi', body: 'Hello', uploads: [{ path: attPath, name: 'x.pdf' }] })
check('a club cannot attach another club\'s upload', fnBPath.status === 403, JSON.stringify(fnBPath))
const { data: aFile } = await clubA.from('club_files').select('id').limit(1).single()
await clubB.c.from('club_members').insert({ club_id: clubBRow.id, name: 'Dee', email: `dee${stamp}@example.com` })
const fnBFile = await callFn(clubB.c, { audience: 'all', subject: 'Hi', body: 'Hello', club_file_ids: [aFile.id] })
check('a club cannot attach another club\'s files', fnBFile.status === 404, JSON.stringify(fnBFile))
const fnSend = await callFn(clubA, { audience: 'leadership', subject: 'Officer meeting', body: 'See you Tuesday.', club_file_ids: [aFile.id], uploads: [{ path: attPath, name: 'agenda.pdf' }] })
// Demo addresses (example.com) are never emailed, so this is logged as "skipped".
check('club emails its leadership (demo addresses skipped)', fnSend.status === 200 && fnSend.body.recipient_count === 2 && fnSend.body.status === 'skipped', JSON.stringify(fnSend))
const { data: logRows } = await clubA.from('member_emails').select('subject, audience, attachment_names, status')
check('the send is in the club\'s email history', logRows?.some((r) => r.subject === 'Officer meeting' && r.attachment_names.length === 2))
const { data: bLog } = await clubB.c.from('member_emails').select('id')
check('other clubs cannot read the email history', (bLog ?? []).length === 0)
const { data: leftover } = await service.storage.from('email-attachments').list(clubARow.user_id)
check('uploaded attachments are deleted after sending', !(leftover ?? []).some((f) => attPath.endsWith(f.name)))

// =============================================================================
// Approval settings and "send back for changes"
// =============================================================================
console.log('\n--- Approvals ---')
{
const { data: clubUpdSettings } = await clubA.from('department_settings').update({ require_message_approval: false }).eq('department_id', byuLaw.id).select()
check('clubs cannot change approval settings', (clubUpdSettings ?? []).length === 0)
const { data: pSettings } = await partnerC.from('department_settings').select('require_message_approval')
check('partners cannot read approval settings', (pSettings ?? []).length === 0)
await admin.from('department_settings').update({ require_message_approval: true, require_opportunity_approval: true, require_proposal_approval: false }).eq('department_id', byuLaw.id)

// --- first message needs approval
const { data: convId, error: convErr } = await clubA.rpc('start_conversation', { p_partner_id: partnerRow.id, p_subject: 'Sponsor our trivia night?', p_body: 'Hi! Would you sponsor pizza?' })
check('club starts a conversation (approval on)', !convErr, convErr?.message)
const convStatus = async () => (await clubA.from('conversation_list').select('approval_status, review_note').eq('id', convId).single()).data
check('first message waits for approval', (await convStatus())?.approval_status === 'pending')
const { data: pConv } = await partnerC.from('conversation_list').select('id').eq('id', convId)
const { data: pMsgs } = await partnerC.from('messages').select('id').eq('conversation_id', convId)
check('partner cannot see a message waiting for approval', (pConv ?? []).length === 0 && (pMsgs ?? []).length === 0)
const { error: clubMore } = await clubA.from('messages').insert({ conversation_id: convId, sender_user_id: clubARow.user_id, sender_role: 'club', body: 'Also…' })
check('club cannot add messages before approval', !!clubMore)
const { data: review } = await admin.from('message_reviews').select('body, partner_name, club_name').eq('id', convId)
check('admin sees the message to review', review?.[0]?.body === 'Hi! Would you sponsor pizza?')
const { data: usuMsgReview } = await usuAdmin.from('message_reviews').select('id').eq('id', convId)
const { data: bReview } = await clubB.c.from('message_reviews').select('id').eq('id', convId)
check('other admins and clubs cannot see it', (usuMsgReview ?? []).length === 0 && (bReview ?? []).length === 0)
const { error: pDecide } = await partnerC.rpc('decide_conversation', { p_conversation_id: convId, p_decision: 'approve' })
const { error: cDecide } = await clubA.rpc('decide_conversation', { p_conversation_id: convId, p_decision: 'approve' })
check('only the university admin can decide', !!pDecide && !!cDecide)
const { error: noNote } = await admin.rpc('decide_conversation', { p_conversation_id: convId, p_decision: 'send_back' })
check('sending back requires a note', !!noNote)
const { error: sbErr } = await admin.rpc('decide_conversation', { p_conversation_id: convId, p_decision: 'send_back', p_note: 'Please mention the date.' })
const afterSb = await convStatus()
check('admin sends the message back with a note', !sbErr && afterSb?.approval_status === 'changes_requested' && afterSb?.review_note === 'Please mention the date.', sbErr?.message)
const { data: resub, error: resubErr } = await clubA.rpc('resubmit_conversation', { p_conversation_id: convId, p_subject: 'Trivia night Dec 4', p_body: 'Hi! Would you sponsor pizza for trivia on Dec 4?' })
check('club edits and resubmits', !resubErr && resub === 'pending', resubErr?.message)
await admin.rpc('decide_conversation', { p_conversation_id: convId, p_decision: 'approve' })
const { data: pConv2 } = await partnerC.from('conversation_list').select('subject, unread, last_message').eq('id', convId)
check('after approval the partner sees the edited message, unread', pConv2?.[0]?.subject === 'Trivia night Dec 4' && pConv2[0].unread === true && /Dec 4/.test(pConv2[0].last_message), JSON.stringify(pConv2))
const { error: pReply } = await partnerC.from('messages').insert({ conversation_id: convId, sender_user_id: (await partnerC.auth.getUser()).data.user.id, sender_role: 'partner', body: 'Sure!' })
check('the conversation is open after approval', !pReply, pReply?.message)
const { data: conv2 } = await clubA.rpc('start_conversation', { p_partner_id: partnerRow.id, p_subject: 'Spam', p_body: 'Buy our stuff' })
await admin.rpc('decide_conversation', { p_conversation_id: conv2, p_decision: 'deny', p_note: 'Not appropriate.' })
const { data: pConv3 } = await partnerC.from('conversation_list').select('id').eq('id', conv2)
check('a denied message never reaches the partner', (pConv3 ?? []).length === 0)

// --- opportunity posts need approval
const { data: oppP, error: oppPErr } = await clubA.from('opportunities').insert({ club_id: clubARow.id, title: 'Sponsor trivia', description: 'Pizza for 40', support_type: 'food' }).select().single()
check('new opportunity waits for approval', !oppPErr && oppP?.approval_status === 'pending', oppPErr?.message)
const { error: spoofApproved } = await clubA.from('opportunities').update({ approval_status: 'approved' }).eq('id', oppP.id)
check('club cannot approve its own opportunity', !!spoofApproved)
const partnerSees = async () => ((await partnerC.from('opportunity_cards').select('id').eq('id', oppP.id)).data ?? []).length === 1
const { data: pub } = await anon.rpc('get_public_opportunity', { p_id: oppP.id })
check('partners and the public cannot see it yet', !(await partnerSees()) && !pub)
const { error: earlyProposal } = await partnerC.rpc('submit_proposal', { p_opportunity_id: oppP.id, p_headcount: 40 })
check('partners cannot propose on an unapproved opportunity', !!earlyProposal)
await admin.rpc('decide_opportunity', { p_opportunity_id: oppP.id, p_decision: 'send_back', p_note: 'Add the date.' })
const oppNow = async () => (await clubA.from('opportunities').select('approval_status, review_note').eq('id', oppP.id).single()).data
check('admin sends the opportunity back with a note', (await oppNow())?.approval_status === 'changes_requested' && (await oppNow())?.review_note === 'Add the date.')
await clubA.from('opportunities').update({ title: 'Sponsor trivia (Dec 4)' }).eq('id', oppP.id)
check('editing it resubmits it', (await oppNow())?.approval_status === 'pending')
await admin.rpc('decide_opportunity', { p_opportunity_id: oppP.id, p_decision: 'approve' })
check('approved opportunity is visible to partners', await partnerSees())
await clubA.from('opportunities').update({ status: 'closed' }).eq('id', oppP.id)
await clubA.from('opportunities').update({ status: 'open' }).eq('id', oppP.id)
check('closing and reopening does not need re-approval', (await oppNow())?.approval_status === 'approved')
await clubA.from('opportunities').update({ description: 'Pizza for 60' }).eq('id', oppP.id)
check('editing what partners see needs re-approval', (await oppNow())?.approval_status === 'pending' && !(await partnerSees()))
await admin.rpc('decide_opportunity', { p_opportunity_id: oppP.id, p_decision: 'send_back', p_note: 'Fine, resubmit as is.' })
const { data: reOpp } = await clubA.rpc('resubmit_opportunity', { p_opportunity_id: oppP.id })
check('club resubmits without changes', reOpp === 'pending')
await admin.rpc('decide_opportunity', { p_opportunity_id: oppP.id, p_decision: 'approve' })

// --- proposal screening (off by default)
const { data: ua } = await clubA.from('department_settings').select('require_message_approval, require_opportunity_approval, require_proposal_approval').single()
check('defaults: messages and posts on, proposal screening off (club can read)', ua && ua.require_proposal_approval === false)
await admin.from('department_settings').update({ require_proposal_approval: true }).eq('department_id', byuLaw.id)
const { data: spId, error: spErr } = await partnerC.rpc('submit_proposal', { p_opportunity_id: oppP.id, p_headcount: 40, p_message: 'Happy to help' })
const spNow = async (c) => (await c.from('proposal_details').select('status, denial_reason, headcount, conversation_id').eq('id', spId)).data?.[0]
check('with screening on, the proposal waits for the university', !spErr && (await spNow(partnerC))?.status === 'pending_review', spErr?.message)
const { data: cProps } = await clubA.from('proposals').select('id').eq('id', spId)
check('the club cannot see it yet', (cProps ?? []).length === 0 && !(await spNow(clubA)))
check('the admin can', (await spNow(admin))?.status === 'pending_review')
await admin.rpc('decide_proposal', { p_proposal_id: spId, p_decision: 'send_back', p_note: 'Please add a student offer.' })
check('admin sends it back to the partner', (await spNow(partnerC))?.status === 'changes_requested' && (await spNow(partnerC))?.denial_reason === 'Please add a student offer.')
const { error: wrongResub } = await clubA.rpc('resubmit_proposal', { p_proposal_id: spId, p_headcount: 40 })
check('only the partner can resubmit it', !!wrongResub)
const { data: reSp, error: rePropErr } = await partnerC.rpc('resubmit_proposal', { p_proposal_id: spId, p_headcount: 45, p_student_offer: '10% off', p_message: 'Updated' })
check('partner edits and resubmits', !rePropErr && reSp === 'pending_review', rePropErr?.message)
await admin.rpc('decide_proposal', { p_proposal_id: spId, p_decision: 'approve' })
const clubView = await spNow(clubA)
check('once approved, the club sees the revised proposal', clubView?.status === 'pending_club' && clubView?.headcount === 45)
const { data: sumMsg } = await clubA.from('messages').select('body').eq('conversation_id', clubView?.conversation_id)
check('and its summary message', (sumMsg ?? []).some((m) => /45 lunches.*10% off/.test(m.body)))
await clubA.rpc('respond_to_proposal', { p_proposal_id: spId, p_accept: true })
await admin.rpc('decide_proposal', { p_proposal_id: spId, p_decision: 'send_back', p_note: 'Terms need the dean’s sign-off.' })
const { data: oppAfter } = await clubA.from('opportunities').select('status').eq('id', oppP.id).single()
check('sending back a final approval goes to the partner and reopens the opportunity', (await spNow(partnerC))?.status === 'changes_requested' && oppAfter?.status === 'open')
const { data: spId2 } = await partnerC.rpc('submit_proposal', { p_conversation_id: convId, p_amount: 100 })
await admin.rpc('decide_proposal', { p_proposal_id: spId2, p_decision: 'deny', p_note: 'No.' })
const { data: cDenied } = await clubA.from('proposal_details').select('id').eq('id', spId2)
check('a proposal denied in screening is never shown to the club', (cDenied ?? []).length === 0)
const { error: wdErr } = await partnerC.rpc('withdraw_proposal', { p_proposal_id: spId })
check('partner can withdraw a proposal that was sent back', !wdErr, wdErr?.message)
await admin.from('department_settings').update({ require_proposal_approval: false }).eq('department_id', byuLaw.id)

// --- events: send back, edit or resubmit
const { data: evSb } = await clubA.from('events').insert({ club_id: clubARow.id, name: 'Trivia Night', starts_at: inDays(20), ends_at: inDays(20, 14) }).select().single()
const { error: evSbErr } = await admin.rpc('decide_event', { p_event_id: evSb.id, p_decision: 'send_back', p_note: 'Book a room first.' })
const evNow = async () => (await clubA.from('events').select('approval_status, denial_reason').eq('id', evSb.id).single()).data
check('admin sends an event back with a note', !evSbErr && (await evNow())?.approval_status === 'changes_requested' && (await evNow())?.denial_reason === 'Book a room first.', evSbErr?.message)
const { error: bResub } = await clubB.c.rpc('resubmit_event', { p_event_id: evSb.id })
check('other clubs cannot resubmit it', !!bResub)
await clubA.from('events').update({ location: 'Room 101' }).eq('id', evSb.id)
check('editing the event resubmits it', (await evNow())?.approval_status === 'pending')
await admin.rpc('decide_event', { p_event_id: evSb.id, p_decision: 'send_back', p_note: 'Thanks — one more look.' })
const { error: evResubErr } = await clubA.rpc('resubmit_event', { p_event_id: evSb.id })
check('club resubmits without changes', !evResubErr && (await evNow())?.approval_status === 'pending', evResubErr?.message)
const { error: dupResub } = await clubA.rpc('resubmit_event', { p_event_id: evSb.id })
check('a pending event cannot be "resubmitted" again', !!dupResub)
const { error: evApprove } = await admin.rpc('decide_event', { p_event_id: evSb.id, p_decision: 'approve' })
check('admin approves it', !evApprove && (await evNow())?.approval_status === 'approved')

}

// =============================================================================
// University colors
// =============================================================================
console.log('\n--- University colors ---')
const orgAdmin = client()
await orgAdmin.auth.signInWithPassword({ email: 'orgadmin@byu.example', password: 'password123' })
{
  const { error: clubSet } = await clubA.rpc('set_university_theme', { p_primary: '#002e5d', p_pop: '#ffc72c', p_fresh: '#6cace4' })
  const { error: partnerSet } = await partnerC.rpc('set_university_theme', { p_primary: '#002e5d', p_pop: '#ffc72c', p_fresh: '#6cace4' })
  const { error: collegeSet } = await admin.rpc('set_university_theme', { p_primary: '#002e5d', p_pop: '#ffc72c', p_fresh: '#6cace4' })
  check('clubs, partners and college admins cannot set the university colors', !!clubSet && !!partnerSet && !!collegeSet)
  const { error: badHex } = await orgAdmin.rpc('set_university_theme', { p_primary: 'red', p_pop: '#ffc72c', p_fresh: '#6cace4' })
  check('colors must be #rrggbb', !!badHex)
  const { error: partial } = await orgAdmin.rpc('set_university_theme', { p_primary: '#002e5d', p_pop: null, p_fresh: '#6cace4' })
  check('all three colors are set together', !!partial)
  const { error: setErr } = await orgAdmin.rpc('set_university_theme', { p_primary: '#002E5D', p_pop: '#ffc72c', p_fresh: '#6cace4' })
  check('organization admin sets the university colors', !setErr, setErr?.message)
  const { data: clubTheme } = await clubA.rpc('current_university_theme')
  check('the university\'s clubs get them', clubTheme?.primary === '#002e5d' && clubTheme?.pop === '#ffc72c')
  const { data: adminTheme } = await admin.rpc('current_university_theme')
  const { data: orgTheme } = await orgAdmin.rpc('current_university_theme')
  check('so do its college and organization admins', adminTheme?.primary === '#002e5d' && orgTheme?.primary === '#002e5d')
  const { data: partnerTheme } = await partnerC.rpc('current_university_theme')
  const { data: usuTheme } = await usuAdmin.rpc('current_university_theme')
  check('partners and other universities do not', partnerTheme === null && usuTheme === null)
  // A college can override them for its own clubs.
  const { error: ovErr } = await admin.rpc('set_department_theme', { p_primary: '#7a0019', p_pop: '#ffcc33', p_fresh: '#1b7f3b' })
  const { data: ovClub } = await clubA.rpc('current_university_theme')
  const { data: ovOrg } = await orgAdmin.rpc('current_university_theme')
  check('a college admin overrides colors for its clubs only', !ovErr && ovClub?.primary === '#7a0019' && ovOrg?.primary === '#002e5d', ovErr?.message)
  const { error: clubOv } = await clubA.rpc('set_department_theme', { p_primary: '#000000', p_pop: '#000000', p_fresh: '#000000' })
  check('clubs cannot set college colors', !!clubOv)
  await admin.rpc('set_department_theme', { p_primary: null, p_pop: null, p_fresh: null })
  const { data: backClub } = await clubA.rpc('current_university_theme')
  check('removing the override goes back to the university colors', backClub?.primary === '#002e5d')
  await orgAdmin.rpc('set_university_theme', { p_primary: null, p_pop: null, p_fresh: null })
  const { data: resetTheme } = await clubA.rpc('current_university_theme')
  check('organization admin resets to the default colors', resetTheme === null)
}

// =============================================================================
// Colleges and organization admins
// =============================================================================
console.log('\n--- Colleges ---')
{
  const invite = async (c, body) => {
    const token = (await c.auth.getSession()).data.session?.access_token
    const res = await fetch(`${URL}/functions/v1/invite-university-admin`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }
  const accept = async (link, extra = {}) => anon.functions.invoke('accept-admin-invite', { body: { action: 'accept', token: link.split('/').pop(), password: 'password123', ...extra } })

  // Organization admin sees every club at the university; college admins only theirs.
  const { data: orgClubs } = await orgAdmin.from('clubs').select('id, department_id')
  check('organization admin reads all of its university\'s clubs', orgClubs?.some((c) => c.id === clubARow.id) && orgClubs?.some((c) => c.id === clubBRow.id))
  const { data: usuSeesByu } = await usuAdmin.from('clubs').select('id').eq('id', clubARow.id)
  check('other universities\' admins cannot', (usuSeesByu ?? []).length === 0)

  // Adding colleges
  const bizName = `BYU Business ${stamp}`
  const { data: biz, error: bizErr } = await orgAdmin.from('departments').insert({ university_id: byu.id, name: bizName }).select().single()
  check('organization admin adds a college', !bizErr && biz?.is_participating === false, bizErr?.message)
  const { error: dupErr } = await orgAdmin.from('departments').insert({ university_id: byu.id, name: bizName.toUpperCase() })
  check('college names are unique per university', dupErr?.code === '23505')
  const { error: adminAdds } = await admin.from('departments').insert({ university_id: byu.id, name: `Nope ${stamp}` })
  const { error: usuAdds } = await orgAdmin.from('departments').insert({ university_id: usu.id, name: `Nope ${stamp}` })
  check('college admins (and other universities) cannot add colleges', !!adminAdds && !!usuAdds)
  const { data: renamed } = await admin.from('departments').update({ name: 'Hacked' }).eq('id', byuLaw.id).select()
  check('college admins cannot rename colleges', (renamed ?? []).length === 0)

  // Sign-up needs a participating college of the chosen university
  const noAdminClub = await signUp(`clubc${stamp}@example.com`, { role: 'club', club_name: 'C', university_id: byu.id, department_id: biz.id })
  check('clubs cannot join a college without an admin', !!noAdminClub.error)
  const wrongUni = await signUp(`clubd${stamp}@example.com`, { role: 'club', club_name: 'D', university_id: usu.id, department_id: byuLaw.id })
  check('the college must belong to the chosen university', !!wrongUni.error)
  const noCollege = await signUp(`clube${stamp}@example.com`, { role: 'club', club_name: 'E', university_id: byu.id })
  check('a college is required', !!noCollege.error)

  // Moving a club
  const { error: adminMove } = await admin.rpc('move_club', { p_club_id: clubBRow.id, p_department_id: biz.id })
  check('college admins cannot move clubs', !!adminMove)
  const { error: crossMove } = await orgAdmin.rpc('move_club', { p_club_id: clubBRow.id, p_department_id: usuLaw.id })
  check('clubs cannot move to another university\'s college', !!crossMove)
  const { error: moveErr } = await orgAdmin.rpc('move_club', { p_club_id: clubBRow.id, p_department_id: biz.id })
  check('organization admin moves a club to another college', !moveErr, moveErr?.message)
  const { data: lawSeesB } = await admin.from('clubs').select('id').eq('id', clubBRow.id)
  check('the old college\'s admin no longer sees it', (lawSeesB ?? []).length === 0)

  // Stepping in: the organization admin acts only for colleges without an admin.
  const { data: evB } = await service.from('events').insert({ club_id: clubBRow.id, name: `B pending ${stamp}`, starts_at: inDays(30), ends_at: inDays(30, 13) }).select().single()
  const { data: evA } = await service.from('events').insert({ club_id: clubARow.id, name: `A pending ${stamp}`, starts_at: inDays(30), ends_at: inDays(30, 13) }).select().single()
  const { data: orgSeesA } = await orgAdmin.from('events').select('id').eq('id', evA.id)
  check('organization admin can see other colleges\' requests', orgSeesA?.length === 1)
  const { error: orgDecideA } = await orgAdmin.rpc('decide_event', { p_event_id: evA.id, p_decision: 'approve' })
  check('...but not decide them (that college has its own admin)', !!orgDecideA)
  const { error: lawDecideB } = await admin.rpc('decide_event', { p_event_id: evB.id, p_decision: 'approve' })
  check('the old college\'s admin cannot decide for the moved club', !!lawDecideB)
  const { error: orgDecideB } = await orgAdmin.rpc('decide_event', { p_event_id: evB.id, p_decision: 'approve' })
  check('organization admin decides for a college with no admin', !orgDecideB, orgDecideB?.message)

  // Settings for a college
  const { data: lawEditsBiz } = await admin.from('department_settings').update({ scheduling_instructions: 'x' }).eq('department_id', biz.id).select()
  check('a college admin cannot change another college\'s settings', (lawEditsBiz ?? []).length === 0)
  const { data: orgEditsBiz } = await orgAdmin.from('department_settings').update({ scheduling_instructions: 'Email biz rooms' }).eq('department_id', biz.id).select()
  check('the organization admin can', orgEditsBiz?.length === 1)
  const { data: bSettings } = await clubB.c.from('department_settings').select('department_id, scheduling_instructions')
  check('a club reads only its own college\'s settings', bSettings?.length === 1 && bSettings[0].department_id === biz.id)

  // Invites
  const lawInvites = await invite(admin, { kind: 'department', department_id: biz.id, email: `x${stamp}@example.com` })
  check('college admins cannot invite admins', lawInvites.status === 403, JSON.stringify(lawInvites))
  const orgInvitesOrg = await invite(orgAdmin, { kind: 'org', university_id: byu.id, email: `y${stamp}@example.com` })
  check('organization admins cannot invite organization admins', orgInvitesOrg.status === 403)
  const orgInvitesUsu = await invite(orgAdmin, { kind: 'department', department_id: usuLaw.id, email: `z${stamp}@example.com` })
  check('organization admins cannot invite for another university', orgInvitesUsu.status === 403)
  const bizInvite = await invite(orgAdmin, { kind: 'department', department_id: biz.id, email: `biz${stamp}@example.com` })
  check('organization admin invites a college admin', bizInvite.status === 200 && !!bizInvite.body.link, JSON.stringify(bizInvite.body))
  const { data: preview } = await anon.functions.invoke('accept-admin-invite', { body: { action: 'preview', token: bizInvite.body.link.split('/').pop() } })
  check('the invite says which college it is for', preview?.kind === 'department' && preview?.department_name === bizName && preview?.needs_scheduling === false)
  const { error: accErr } = await accept(bizInvite.body.link)
  check('the invited college admin accepts', !accErr, accErr?.message)
  const { data: bizNow } = await anon.from('departments').select('is_participating').eq('id', biz.id).single()
  check('the college now accepts club sign-ups', bizNow?.is_participating === true)
  const bizAdmin = client()
  await bizAdmin.auth.signInWithPassword({ email: `biz${stamp}@example.com`, password: 'password123' })
  const { data: bizClubs } = await bizAdmin.from('clubs').select('id')
  check('the new admin sees the moved club', bizClubs?.length === 1 && bizClubs[0].id === clubBRow.id)
  const { data: coAdmins } = await admin.from('department_admins').select('email')
  check('college admins see only their own college\'s admins', (coAdmins ?? []).every((a) => a.email !== `biz${stamp}@example.com`))
  const evB2 = (await service.from('events').insert({ club_id: clubBRow.id, name: `B2 ${stamp}`, starts_at: inDays(31), ends_at: inDays(31, 13) }).select().single()).data
  const { error: orgStepsBack } = await orgAdmin.rpc('decide_event', { p_event_id: evB2.id, p_decision: 'approve' })
  check('once the college has an admin, the organization admin no longer decides', !!orgStepsBack)

  // Removing a college admin
  const bizUser = (await bizAdmin.auth.getUser()).data.user.id
  const { error: lawRemoves } = await admin.rpc('remove_department_admin', { p_user_id: bizUser })
  check('college admins cannot remove admins', !!lawRemoves)
  const { error: remErr } = await orgAdmin.rpc('remove_department_admin', { p_user_id: bizUser })
  const { data: bizAfter } = await anon.from('departments').select('is_participating').eq('id', biz.id).single()
  const { data: bizProfile } = await service.from('profiles').select('is_active').eq('user_id', bizUser).single()
  check('organization admin removes a college admin (account deactivated, college stops taking sign-ups)', !remErr && bizAfter?.is_participating === false && bizProfile?.is_active === false, remErr?.message)
  const { error: orgBackIn } = await orgAdmin.rpc('decide_event', { p_event_id: evB2.id, p_decision: 'approve' })
  check('...and the organization admin steps back in', !orgBackIn, orgBackIn?.message)

  // Unit label
  const { error: lawLabel } = await admin.rpc('update_organization', { p_unit_label: 'School' })
  const { error: orgLabel } = await orgAdmin.rpc('update_organization', { p_unit_label: 'School' })
  const { data: label } = await anon.from('universities').select('unit_label').eq('id', byu.id).single()
  check('organization admin chooses what units are called', !!lawLabel && !orgLabel && label?.unit_label === 'School')
  await orgAdmin.rpc('update_organization', { p_unit_label: 'College' })

  // Partners see the college name
  const { data: pv } = await partnerC.from('proposal_details').select('department_name').eq('club_id', clubARow.id).limit(1)
  check('partners see the club\'s college', pv?.[0]?.department_name === 'BYU Law')

  // Put club B back for later runs' assumptions
  await orgAdmin.rpc('move_club', { p_club_id: clubBRow.id, p_department_id: byuLaw.id })
}

// =============================================================================
// Reopening approvals (before the event)
// =============================================================================
console.log('\n--- Reopening approvals ---')
{
  const { data: ev } = await service.from('events').insert({ club_id: clubARow.id, name: `Approved ${stamp}`, starts_at: inDays(12), ends_at: inDays(12, 13), approval_status: 'approved', partner_id: partnerRow.id }).select().single()
  const { data: opp } = await service.from('opportunities').insert({ club_id: clubARow.id, event_id: ev.id, title: `Opp ${stamp}`, status: 'filled' }).select().single()
  const { data: prop } = await service.from('proposals').insert({ club_id: clubARow.id, partner_id: partnerRow.id, event_id: ev.id, opportunity_id: opp.id, amount: 200, status: 'approved' }).select().single()
  const { data: past } = await service.from('events').insert({ club_id: clubARow.id, name: `Past approved ${stamp}`, starts_at: inDays(-3), ends_at: inDays(-3, 13), approval_status: 'approved' }).select().single()

  const { error: clubR } = await clubA.rpc('reopen_event', { p_event_id: ev.id, p_note: 'x' })
  const { error: partnerR } = await partnerC.rpc('reopen_event', { p_event_id: ev.id, p_note: 'x' })
  const { error: usuR } = await usuAdmin.rpc('reopen_event', { p_event_id: ev.id, p_note: 'x' })
  const { error: orgR } = await orgAdmin.rpc('reopen_event', { p_event_id: ev.id, p_note: 'x' })
  check('only the club\'s acting admin can reopen (not the club, partner, other universities, or the org admin when the college has an admin)', !!clubR && !!partnerR && !!usuR && !!orgR)
  const { error: noNote } = await admin.rpc('reopen_event', { p_event_id: ev.id, p_note: '' })
  check('reopening needs a note', !!noNote)
  const { error: pastR } = await admin.rpc('reopen_event', { p_event_id: past.id, p_note: 'Too late' })
  check('an event that already happened cannot be reopened', !!pastR)

  // Partnership first (the event stays approved)
  const { error: propR } = await admin.rpc('reopen_proposal', { p_proposal_id: prop.id, p_note: 'Amount needs the dean’s OK' })
  const { data: propAfter } = await partnerC.from('proposal_details').select('status, denial_reason').eq('id', prop.id).single()
  const { data: evAfterProp } = await service.from('events').select('approval_status, partner_id').eq('id', ev.id).single()
  const { data: oppAfter } = await service.from('opportunities').select('status').eq('id', opp.id).single()
  check('reopening a partnership sends it back to the partner with the note', !propR && propAfter?.status === 'changes_requested' && propAfter?.denial_reason === 'Amount needs the dean’s OK', propR?.message)
  check('...takes the partner off the event and reopens the opportunity; the event stays approved', evAfterProp?.partner_id === null && evAfterProp?.approval_status === 'approved' && oppAfter?.status === 'open')
  const { error: again } = await admin.rpc('reopen_proposal', { p_proposal_id: prop.id, p_note: 'x' })
  check('only approved partnerships can be reopened', !!again)

  // Then the event
  const { error: evR } = await admin.rpc('reopen_event', { p_event_id: ev.id, p_note: 'Please book a bigger room' })
  const { data: evAfter } = await clubA.from('events').select('approval_status, denial_reason').eq('id', ev.id).single()
  check('reopening an event sends it back to the club with the note', !evR && evAfter?.approval_status === 'changes_requested' && evAfter?.denial_reason === 'Please book a bigger room', evR?.message)
  const { error: resub } = await clubA.rpc('resubmit_event', { p_event_id: ev.id })
  const { data: evPending } = await clubA.from('events').select('approval_status').eq('id', ev.id).single()
  check('the club resubmits it and it is pending again', !resub && evPending?.approval_status === 'pending')
}

// =============================================================================
// Multi-person approval (parts: event, flyer, partnership, receipts)
// =============================================================================
console.log('\n--- Multi-person approval ---')
{
  // A second BYU Law admin who handles partnerships and receipts.
  const coEmail = `co${stamp}@example.com`
  const invRes = await orgAdmin.functions.invoke('invite-university-admin', { body: { kind: 'department', department_id: byuLaw.id, email: coEmail } })
  await anon.functions.invoke('accept-admin-invite', { body: { action: 'accept', token: invRes.data.link.split('/').pop(), password: 'password123' } })
  const co = client()
  await co.auth.signInWithPassword({ email: coEmail, password: 'password123' })
  const coId = (await co.auth.getUser()).data.user.id
  const adminId = (await admin.auth.getUser()).data.user.id

  const { error: clubSets } = await clubA.rpc('set_admin_parts', { p_user_id: coId, p_events: true, p_flyers: true, p_partnerships: true, p_receipts: true })
  const { error: usuSets } = await usuAdmin.rpc('set_admin_parts', { p_user_id: coId, p_events: true, p_flyers: true, p_partnerships: true, p_receipts: true })
  check('clubs and other universities cannot assign approval parts', !!clubSets && !!usuSets)
  const { error: coSet } = await admin.rpc('set_admin_parts', { p_user_id: coId, p_events: false, p_flyers: false, p_partnerships: true, p_receipts: true })
  const { error: meSet } = await orgAdmin.rpc('set_admin_parts', { p_user_id: adminId, p_events: true, p_flyers: true, p_partnerships: false, p_receipts: false })
  check('college admins and the organization admin assign parts', !coSet && !meSet, (coSet ?? meSet)?.message)

  // An event with a flyer and a partnership waiting on it
  const { data: ev } = await service.from('events').insert({ club_id: clubARow.id, name: `Multi ${stamp}`, starts_at: inDays(25), ends_at: inDays(25, 13), flyer_path: `${clubARow.user_id}/f.png`, partner_id: partnerRow.id }).select().single()
  const { data: pr } = await service.from('proposals').insert({ club_id: clubARow.id, partner_id: partnerRow.id, event_id: ev.id, amount: 300, status: 'pending_admin' }).select().single()
  const { data: s1, error: s1e } = await co.rpc('sign_event', { p_event_id: ev.id })
  check('the partnership approver signs only the partnership', !s1e && s1?.approved === false && JSON.stringify(s1.signed) === '["partnership"]' && JSON.stringify(s1.waiting) === '["event","flyer"]', JSON.stringify(s1 ?? s1e))
  const { data: stillPending } = await service.from('events').select('approval_status').eq('id', ev.id).single()
  check('...and the event is still pending', stillPending.approval_status === 'pending')
  const { error: coAgain } = await co.rpc('sign_event', { p_event_id: ev.id })
  check('with nothing left for them, they get a clear error', /Nothing here is yours/.test(coAgain?.message ?? ''), coAgain?.message)
  const { data: s2 } = await admin.rpc('sign_event', { p_event_id: ev.id })
  const { data: evDone } = await service.from('events').select('approval_status, details_signed_by, flyer_signed_by').eq('id', ev.id).single()
  const { data: prDone } = await service.from('proposals').select('status, signed_by').eq('id', pr.id).single()
  check('once the event approver signs details and flyer, everything is approved', s2?.approved === true && evDone.approval_status === 'approved' && prDone.status === 'approved', JSON.stringify(s2))
  check('...with each part recorded under who signed it', evDone.details_signed_by === adminId && evDone.flyer_signed_by === adminId && prDone.signed_by === coId)

  // Edits reset only the affected part
  await clubA.from('events').update({ flyer_path: `${clubARow.user_id}/f2.png` }).eq('id', ev.id)
  const { data: afterFlyer } = await service.from('events').select('approval_status, details_signed_at, flyer_signed_at').eq('id', ev.id).single()
  check('a new flyer needs only the flyer signed again', afterFlyer.approval_status === 'pending' && afterFlyer.details_signed_at && !afterFlyer.flyer_signed_at)
  const { data: waitingFlyer } = await admin.rpc('event_parts_waiting', { p_event_id: ev.id })
  check('...which is all that is waiting', JSON.stringify(waitingFlyer) === '["flyer"]', JSON.stringify(waitingFlyer))
  await admin.rpc('sign_event', { p_event_id: ev.id })
  await clubA.from('events').update({ description: 'Changed details' }).eq('id', ev.id)
  const { data: waitingDetails } = await admin.rpc('event_parts_waiting', { p_event_id: ev.id })
  check('changed details need only the details signed again', JSON.stringify(waitingDetails) === '["event"]', JSON.stringify(waitingDetails))

  // Send back: anyone with a part of the request; clears every sign-off
  const { data: ev2 } = await service.from('events').insert({ club_id: clubARow.id, name: `Plain ${stamp}`, starts_at: inDays(26), ends_at: inDays(26, 13) }).select().single()
  const { error: coSendsBackPlain } = await co.rpc('decide_event', { p_event_id: ev2.id, p_decision: 'send_back', p_note: 'x' })
  check('someone without any part of a request cannot send it back', !!coSendsBackPlain)
  const { error: coSendsBack } = await co.rpc('decide_event', { p_event_id: ev.id, p_decision: 'send_back', p_note: 'Fix the sponsor details' })
  const { data: cleared } = await service.from('events').select('approval_status, details_signed_at, flyer_signed_at').eq('id', ev.id).single()
  check('the partnership approver can send back an event with a partnership; all sign-offs clear', !coSendsBack && cleared.approval_status === 'changes_requested' && !cleared.details_signed_at && !cleared.flyer_signed_at, coSendsBack?.message)

  // Posts, first messages and screening go to the partnership approver
  const { data: op } = await service.from('opportunities').insert({ club_id: clubARow.id, title: `Post ${stamp}`, approval_status: 'pending' }).select().single()
  const { error: adminPost } = await admin.rpc('decide_opportunity', { p_opportunity_id: op.id, p_decision: 'approve' })
  const { error: coPost } = await co.rpc('decide_opportunity', { p_opportunity_id: op.id, p_decision: 'approve' })
  check('opportunity posts are approved by the partnership approver only', !!adminPost && !coPost, coPost?.message)

  // Receipts
  const { data: past } = await service.from('events').insert({ club_id: clubARow.id, name: `Past ${stamp}`, starts_at: inDays(-4), ends_at: inDays(-4, 13), approval_status: 'approved' }).select().single()
  const { data: rep } = await service.from('event_reports').insert({ event_id: past.id, attendees: 10, amount_spent: 20 }).select().single()
  const { data: rc } = await service.from('receipts').insert({ club_id: clubARow.id, event_id: past.id, event_report_id: rep.id, storage_path: `${clubARow.user_id}/r-${stamp}.png`, file_name: 'r.png', amount: 20 }).select().single()
  const { error: adminRc } = await admin.rpc('review_receipt', { p_receipt_id: rc.id, p_status: 'approved' })
  const { error: coRc } = await co.rpc('review_receipt', { p_receipt_id: rc.id, p_status: 'approved' })
  check('receipts are reviewed by the receipts reviewer only', !!adminRc && !coRc, coRc?.message)

  // Nobody holds a part → any college admin can sign it
  await orgAdmin.rpc('set_admin_parts', { p_user_id: coId, p_events: false, p_flyers: false, p_partnerships: true, p_receipts: true })
  await orgAdmin.rpc('set_admin_parts', { p_user_id: adminId, p_events: true, p_flyers: false, p_partnerships: false, p_receipts: false })
  const { data: ev3 } = await service.from('events').insert({ club_id: clubARow.id, name: `Fallback ${stamp}`, starts_at: inDays(27), ends_at: inDays(27, 13), flyer_path: `${clubARow.user_id}/f3.png` }).select().single()
  const { data: s3 } = await admin.rpc('sign_event', { p_event_id: ev3.id })
  check('if no one is assigned flyers, any college admin signs them', s3?.approved === true, JSON.stringify(s3))

  // Back to everyone-does-everything for other tests
  await orgAdmin.rpc('set_admin_parts', { p_user_id: adminId, p_events: true, p_flyers: true, p_partnerships: true, p_receipts: true })
  await orgAdmin.rpc('remove_department_admin', { p_user_id: coId })
}

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
