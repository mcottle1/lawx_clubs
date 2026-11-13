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
check('club cannot report on an event that has not happened', !!repIns)


// =============================================================================
// Phase 3: opportunities, conversations, proposals, approvals
// =============================================================================
console.log('\n--- Phase 3 ---')
const partnerC = partner.c
const { data: partnerRow } = await partnerC.from('partners').select('id').eq('email', `partner${stamp}@example.com`).single()

// A second university with its own admin (idempotent across runs).
const { data: usu } = await anon.from('universities').select('id').eq('name', 'Utah State University').single()
const inv2 = await site.functions.invoke('invite-university-admin', { body: { university_id: usu.id, email: 'admin@usu.example' } })
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

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
