#!/usr/bin/env node
// Demo data so every dashboard and chart has something to show:
// 2 universities (BYU, University of Utah) with an admin each, 3 clubs, 4 partners,
// past events with reports + receipts, upcoming events, opportunities, proposals
// in every state, conversations, member-count history and to-dos.
//
// Local (after `npx supabase start` / `db reset`):   npm run seed:demo
// Hosted:  SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-demo.mjs --yes
// Re-create (deletes the demo accounts and everything they own first):  add --reset
//
// All demo logins use the password below and @example.com addresses (the
// app never sends real email to those). Universities that already have a real
// administrator keep it — no demo admin is created for them.
import { execSync } from 'node:child_process'
import zlib from 'node:zlib'
import { createClient } from '@supabase/supabase-js'

export const DEMO_PASSWORD = 'campusbridge-demo'
const args = new Set(process.argv.slice(2))

// ---- connection -------------------------------------------------------------
let url = process.env.SUPABASE_URL
let key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  const st = JSON.parse(execSync('npx supabase status -o json', { stdio: ['ignore', 'pipe', 'ignore'] }).toString())
  url = st.API_URL
  key = st.SERVICE_ROLE_KEY
}
const local = /^http:\/\/(127\.0\.0\.1|localhost)/.test(url)
if (!local && !args.has('--yes')) {
  console.error(`This will add demo accounts and data to ${url}. Re-run with --yes to continue.`)
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data }

// ---- people ------------------------------------------------------------------
const ADMINS = [
  { email: 'demo-admin-byu@example.com', uni: 'Brigham Young University', scheduling_url: 'https://example.com/byu-room-booking', scheduling_instructions: 'Book rooms in the law building at least 2 weeks ahead. Questions: rooms@example.com.' },
  { email: 'demo-admin-utah@example.com', uni: 'University of Utah', scheduling_url: null, scheduling_instructions: 'Email the Student Affairs office with your event name, date, expected headcount and room preference.' },
]
const PARTNERS = [
  { key: 'summit', email: 'demo-partner-summit@example.com', name: 'Summit Bar Review', city: 'Salt Lake City', state: 'UT', category: 'bar_prep', color: [240, 97, 46], website: 'https://example.com/summit-bar-review',
    description: 'Utah bar exam prep courses, live and online.', offer: 'Lunch for 20–60 students in exchange for 10 minutes to present, plus a 15% discount code for attendees.' },
  { key: 'wasatch', email: 'demo-partner-wasatch@example.com', name: 'Wasatch Legal Partners', city: 'Provo', state: 'UT', category: 'law_firm', color: [74, 58, 224], website: 'https://example.com/wasatch-legal',
    description: 'Litigation and business law firm in Utah County.', offer: 'Sponsors career panels and mentoring nights; can send attorneys to speak.' },
  { key: 'cougar', email: 'demo-partner-cougar@example.com', name: 'Cougar Town Catering', city: 'Provo', state: 'UT', category: 'restaurant_catering', color: [13, 148, 136], website: 'https://example.com/cougar-catering',
    description: 'Family-owned caterer near campus.', offer: 'Discounted catering for student events of 30–150 people.' },
  { key: 'lexicode', email: 'demo-partner-lexicode@example.com', name: 'LexiCode', city: 'Lehi', state: 'UT', category: 'legal_tech', color: [44, 34, 135], website: 'https://example.com/lexicode',
    description: 'Contract-analysis software for law firms.', offer: 'Free student licenses, demo workshops, and small cash sponsorships for tech-focused events.' },
]
const CLUBS = [
  { key: 'moot', email: 'demo-club-moot@example.com', name: 'Moot Court Society', uni: 'Brigham Young University', budget: 3000, color: [59, 45, 184],
    description: 'Appellate advocacy training and competitions for BYU Law students.', members: [38, 44, 51, 55, 58, 61] },
  { key: 'wil', email: 'demo-club-wil@example.com', name: 'Women in Law', uni: 'Brigham Young University', budget: 2500, color: [240, 97, 46],
    description: 'Mentoring, networking and career events supporting women in the legal profession.', members: [52, 57, 60, 66, 70, 72] },
  { key: 'pils', email: 'demo-club-pils@example.com', name: 'Public Interest Law Society', uni: 'University of Utah', budget: 2000, color: [13, 148, 136],
    description: 'Pro bono projects, clinics and public-interest career support.', members: [29, 31, 34, 33, 37, 40] },
]

// ---- tiny PNG generator (solid square with a lighter band) for logos/receipts
function png(w, h, [r, g, b], band = true) {
  const rows = []
  for (let y = 0; y < h; y++) {
    const light = band && y > h * 0.62 && y < h * 0.74
    const px = light ? [255, 255, 255] : [r, g, b]
    rows.push(Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => px).flat())]))
  }
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return ~c >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}

// ---- helpers -----------------------------------------------------------------
const DAY = 864e5
const TZ = 'America/Denver'
/** An instant N days from now at a local hour (approximate MST/MDT offset is fine for demo data). */
function at(days, hour = 12) {
  const d = new Date(Date.now() + days * DAY)
  d.setUTCHours(hour + 7, 0, 0, 0)
  return d.toISOString()
}
const ymd = (iso) => iso.slice(0, 10)
const allEmails = [...ADMINS, ...PARTNERS, ...CLUBS].map((x) => x.email)

async function findUsers(emails) {
  const found = new Map()
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    for (const u of data.users) if (emails.includes(u.email)) found.set(u.email, u.id)
    if (data.users.length < 1000) break
  }
  return found
}

async function createUser(email, metadata) {
  const r = await db.auth.admin.createUser({ email, password: DEMO_PASSWORD, email_confirm: true, user_metadata: metadata })
  if (r.error) throw new Error(`create ${email}: ${r.error.message}`)
  return r.data.user.id
}

async function uploadLogo(userId, rgb) {
  const path = `${userId}/logo-demo.png`
  must(await db.storage.from('logos').upload(path, png(96, 96, rgb), { contentType: 'image/png', upsert: true }), 'logo upload')
  return path
}

// ---- reset / guard -------------------------------------------------------------
const existing = await findUsers(allEmails)
if (existing.size && !args.has('--reset')) {
  console.error(`Demo data already exists (${existing.size} demo accounts). Re-run with --reset to delete and re-create it.`)
  process.exit(1)
}
if (existing.size) {
  console.log(`Deleting ${existing.size} demo accounts and everything they own…`)
  for (const id of existing.values()) must(await db.auth.admin.deleteUser(id), 'delete user')
}

// ---- universities + admins ------------------------------------------------------
const unis = {}
for (const a of ADMINS) {
  const uni = must(await db.from('universities').select('id, name, city, state').eq('name', a.uni).single(), `university ${a.uni}`)
  unis[a.uni] = uni
  const current = must(await db.from('university_admins').select('contact_email').eq('university_id', uni.id).maybeSingle(), 'admin lookup')
  if (current) {
    console.log(`• ${a.uni} already has an administrator (${current.contact_email}); keeping it.`)
    a.skipped = current.contact_email
  } else {
    const id = await createUser(a.email, { role: 'invited_admin' })
    must(await db.from('profiles').insert({ user_id: id, role: 'university_admin' }), 'admin profile')
    must(await db.from('university_admins').insert({ user_id: id, university_id: uni.id, contact_email: a.email, scheduling_url: a.scheduling_url, scheduling_instructions: a.scheduling_instructions }), 'admin row')
  }
  must(await db.from('universities').update({ is_participating: true }).eq('id', uni.id), 'participating')
}

// ---- partners -------------------------------------------------------------------
const partners = {}
for (const p of PARTNERS) {
  const uid = await createUser(p.email, {
    role: 'partner', partner_name: p.name, city: p.city, state: p.state, category: p.category,
    description: p.description, offer_description: p.offer, website: p.website, open_to_sponsorships: true,
  })
  const logo = await uploadLogo(uid, p.color)
  partners[p.key] = must(await db.from('partners').update({ logo_path: logo }).eq('user_id', uid).select('id, user_id, name').single(), 'partner')
}

// ---- clubs ----------------------------------------------------------------------
const now = new Date()
const yearStart = `${now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1}-08-01`
const clubs = {}
for (const c of CLUBS) {
  const uid = await createUser(c.email, { role: 'club', club_name: c.name, university_id: unis[c.uni].id, initial_budget: String(c.budget), description: c.description })
  const logo = await uploadLogo(uid, c.color)
  const row = must(await db.from('clubs').update({ logo_path: logo, budget_year_start: yearStart, social_links: { instagram: c.name.toLowerCase().replace(/\W+/g, '') } })
    .eq('user_id', uid).select('id, user_id, name').single(), 'club')
  must(await db.from('club_files').insert({ club_id: row.id, file_type: 'logo', bucket: 'logos', storage_path: logo, file_name: 'logo.png', mime_type: 'image/png', size_bytes: 300 }), 'logo file')
  // Monthly member counts, oldest first.
  const counts = c.members.map((count, i) => {
    const d = new Date(now); d.setMonth(d.getMonth() - (c.members.length - 1 - i)); d.setDate(1)
    return { club_id: row.id, count, recorded_on: ymd(d.toISOString()), source: i % 2 ? 'roster' : 'manual' }
  })
  must(await db.from('club_member_counts').insert(counts), 'member counts')
  clubs[c.key] = row
}

// ---- events -----------------------------------------------------------------------
async function event(clubKey, e) {
  const row = must(await db.from('events').insert({
    club_id: clubs[clubKey].id, name: e.name, starts_at: at(e.day, e.hour ?? 12), ends_at: at(e.day, (e.hour ?? 12) + (e.hours ?? 1)),
    time_zone: TZ, description: e.description ?? '', location: e.location ?? null,
    partner_id: e.partner ? partners[e.partner].id : null, outside_sponsor_name: e.outside ?? null,
    potential_sponsor_notes: e.notes ?? null, budget: e.budget ?? 0,
    approval_status: e.status ?? 'approved', reviewed_at: (e.status ?? 'approved') === 'pending' ? null : at(Math.min(e.day, 0) - 7),
    partner_reminder_days: e.partnerReminder ?? null, location_reminder_days: e.locationReminder ?? null,
  }).select('id, name, club_id').single(), `event ${e.name}`)
  if (e.report) {
    const rep = must(await db.from('event_reports').insert({ event_id: row.id, ...e.report }).select('id').single(), 'report')
    for (const r of e.receipts ?? []) {
      const path = `${clubs[clubKey].user_id}/receipt-demo-${row.id.slice(0, 8)}-${r.amount}.png`
      must(await db.storage.from('receipts').upload(path, png(120, 160, [241, 245, 249]), { contentType: 'image/png', upsert: true }), 'receipt upload')
      must(await db.from('receipts').insert({
        club_id: row.club_id, event_id: row.id, event_report_id: rep.id, storage_path: path, file_name: r.file, mime_type: 'image/png',
        size_bytes: 1000, amount: r.amount, description: r.what, status: r.status ?? 'pending', admin_note: r.note ?? null,
        reviewed_at: r.status && r.status !== 'pending' ? at(-2) : null, reimbursed_at: r.status === 'reimbursed' ? at(-1) : null,
      }), 'receipt')
    }
  }
  return row
}

const ev = {}
// Moot Court Society (BYU)
ev.mootKickoff = await event('moot', { name: 'Fall Kickoff Social', day: -75, hour: 18, hours: 2, location: 'Law School Atrium', partner: 'cougar', budget: 450,
  report: { attendees: 62, amount_spent: 410, notes: 'Great turnout. Order 10% more food next year — we ran out of drinks.' } })
ev.mootWorkshop = await event('moot', { name: 'Appellate Advocacy Workshop', day: -50, hour: 17, hours: 2, location: 'Moot Courtroom', partner: 'wasatch', budget: 200,
  report: { attendees: 38, amount_spent: 180, notes: 'Two Wasatch attorneys judged practice rounds; students loved the feedback.' } })
ev.mootBarLunch = await event('moot', { name: 'Bar Prep Info Lunch', day: -30, location: 'Room 205', partner: 'summit', budget: 150,
  report: { attendees: 54, amount_spent: 120, offers_redeemed: 11, notes: 'Summit covered pizza; 11 students used the discount code.' },
  receipts: [{ file: 'pizza-receipt.png', amount: 120, what: 'Pizza and drinks', status: 'reimbursed', note: 'Reimbursed by check #2041' }] })
ev.mootScrimmage = await event('moot', { name: 'Mock Trial Scrimmage', day: -12, hour: 16, hours: 3, location: 'Moot Courtroom', budget: 80,
  report: { attendees: 24, amount_spent: 60, notes: 'Small but focused group.' },
  receipts: [{ file: 'snacks-receipt.png', amount: 60, what: 'Snacks', status: 'denied', note: 'Receipt is not itemized — please upload the itemized one.' }] })
ev.mootFinals = await event('moot', { name: 'Moot Court Finals Night', day: 9, hour: 18, hours: 2, location: 'Moot Courtroom', partner: 'wasatch', budget: 350,
  description: 'Final round of the intramural competition, judged by local attorneys, followed by a reception.' })
ev.mootMixer = await event('moot', { name: 'Spring Networking Mixer', day: 20, hour: 18, hours: 2, status: 'pending', budget: 500, partnerReminder: 14, locationReminder: 10,
  description: 'Casual networking with local attorneys and alumni.' })
ev.moot1L = await event('moot', { name: '1L Bar Prep Kickoff', day: 35, location: 'Room 120', status: 'pending', budget: 450,
  description: 'An early look at the bar exam for 1Ls, with lunch.', notes: '10 minutes to present at lunch; logo on flyer.' })

// Women in Law (BYU)
ev.wilPanel = await event('wil', { name: 'Women in Litigation Panel', day: -60, hour: 17, hours: 2, location: 'Room 301', partner: 'wasatch', budget: 250,
  report: { attendees: 45, amount_spent: 220, notes: 'Panel ran long — schedule 90 minutes next time.' } })
ev.wilResume = await event('wil', { name: 'Resume Workshop', day: -40, hour: 12, location: 'Career Center', budget: 60,
  report: { attendees: 28, amount_spent: 40, notes: 'Bring printed sample resumes.' } })
ev.wilBrunch = await event('wil', { name: 'Mentorship Brunch', day: -18, hour: 10, hours: 2, location: 'Faculty Lounge', partner: 'cougar', budget: 320,
  report: { attendees: 36, amount_spent: 300, notes: 'Mentors want a sign-up sheet ahead of time.' },
  receipts: [{ file: 'brunch-catering.png', amount: 300, what: 'Brunch catering', status: 'approved' }] })
ev.wilDemo = await event('wil', { name: 'Legal Tech Demo Day', day: -5, hour: 12, location: 'Room 110', partner: 'lexicode', budget: 100 })
ev.wilNegotiation = await event('wil', { name: 'Negotiation Skills Night', day: 14, hour: 18, location: 'Room 201', budget: 150, partnerReminder: 10 })
ev.wilGala = await event('wil', { name: 'Spring Gala', day: 28, hour: 19, hours: 3, location: 'Alumni House', status: 'pending', partner: 'lexicode', budget: 1500,
  description: 'Annual celebration and awards night.' })

// Public Interest Law Society (Utah)
ev.pilsInfo = await event('pils', { name: 'Pro Bono Clinic Info Session', day: -45, location: 'Room 112', budget: 50,
  report: { attendees: 30, amount_spent: 45, notes: 'Many 1Ls interested in the eviction clinic.' } })
ev.pilsPanel = await event('pils', { name: 'Public Interest Career Panel', day: -20, hour: 17, location: 'Moot Courtroom', partner: 'summit', budget: 180,
  report: { attendees: 41, amount_spent: 150, offers_redeemed: 6, notes: 'Summit offered a public-interest scholarship; 6 sign-ups.' },
  receipts: [{ file: 'panel-lunch.png', amount: 150, what: 'Lunch for panel', status: 'pending' }] })
ev.pilsClinic = await event('pils', { name: 'Expungement Clinic Volunteer Day', day: 12, hour: 9, hours: 4, location: 'Community Center', budget: 120 })
ev.pilsWorkshop = await event('pils', { name: 'Fellowship Funding Workshop', day: 25, status: 'pending', budget: 100, locationReminder: 14 })

// The reported Legal Tech Demo Day is still missing its report: show the reminder flow.
must(await db.from('events').update({ report_requested_at: at(-4) }).eq('id', ev.wilDemo.id), 'report requested')
must(await db.from('todos').insert({ club_id: clubs.wil.id, title: 'Submit report for Legal Tech Demo Day', due_on: ymd(at(-1)), source: 'system', system_kind: 'submit_report', related_event_id: ev.wilDemo.id }), 'todo')
// Older follow-ups were done already.
must(await db.from('todos').update({ done: true }).eq('system_kind', 'follow_up').in('club_id', Object.values(clubs).map((c) => c.id)).lt('created_at', new Date().toISOString())
  .in('related_event_id', [ev.mootKickoff.id, ev.mootWorkshop.id, ev.wilPanel.id, ev.pilsInfo.id]), 'follow-ups')
must(await db.from('todos').insert([
  { club_id: clubs.moot.id, title: 'Order trophies for Finals Night', due_on: ymd(at(5)) },
  { club_id: clubs.moot.id, title: 'Recruit 6 attorney judges', due_on: ymd(at(3)) },
  { club_id: clubs.wil.id, title: 'Send Spring Gala save-the-date', due_on: ymd(at(7)) },
  { club_id: clubs.pils.id, title: 'Confirm clinic volunteers', due_on: ymd(at(8)) },
]), 'manual todos')

// ---- opportunities, proposals, conversations ------------------------------------------
async function opp(clubKey, o) {
  return must(await db.from('opportunities').insert({ club_id: clubs[clubKey].id, ...o }).select('id, title, club_id, event_id').single(), `opportunity ${o.title}`)
}
const oppFinals = await opp('moot', { title: 'Sponsor Moot Court Finals Night', event_id: ev.mootFinals.id, support_type: 'funding', amount_sought: 350, status: 'filled',
  description: 'About 60 students and 10 attorney judges. Sponsor gets a welcome slot and logo on the program.' })
const opp1L = await opp('moot', { title: 'Sponsor lunch at 1L Bar Prep Kickoff', event_id: ev.moot1L.id, support_type: 'food', amount_sought: 450,
  description: 'Moot Court Society at BYU is looking for a sponsor for 1L Bar Prep Kickoff. We expect about 50 students.\n\nIn return, our sponsor gets:\n• 10 minutes to present to students\n• Logo on the event flyer\n• Thank-you post on our social media' })
const oppGala = await opp('wil', { title: 'Spring Gala sponsor', event_id: ev.wilGala.id, support_type: 'funding', amount_sought: 1200, status: 'filled',
  description: 'Our biggest night of the year: 120 students, faculty and alumni. Sponsors are recognized on stage and in the program.' })
await opp('wil', { title: 'Sponsor Negotiation Skills Night', event_id: ev.wilNegotiation.id, support_type: 'speaker',
  description: 'Looking for an experienced negotiator to lead a 45-minute workshop for about 35 students.' })
await opp('pils', { title: 'Supplies for Expungement Clinic Volunteer Day', event_id: ev.pilsClinic.id, support_type: 'in_kind', amount_sought: 200,
  description: 'Printing, folders and lunch for 25 student volunteers helping community members clear old records.' })
await opp('pils', { title: 'Year-round chapter sponsor', support_type: 'funding', amount_sought: 1000,
  description: 'Help fund our pro bono projects for the year. Sponsors are featured at every event.' })

async function conversation(clubKey, partnerKey, subject, eventRow, opportunity, messages, startedBy = 'club') {
  const conv = must(await db.from('conversations').insert({
    club_id: clubs[clubKey].id, partner_id: partners[partnerKey].id, subject, event_id: eventRow?.id ?? null,
    opportunity_id: opportunity?.id ?? null, started_by: startedBy,
  }).select('id').single(), 'conversation')
  let t = Date.now() - messages.length * 36e5 * 6
  for (const [side, body] of messages) {
    t += 36e5 * 6
    const sender = side === 'club' ? clubs[clubKey].user_id : side === 'partner' ? partners[partnerKey].user_id : null
    must(await db.from('messages').insert({ conversation_id: conv.id, sender_user_id: sender, sender_role: side, body, created_at: new Date(t).toISOString() }), 'message')
  }
  // The club has read everything except the last partner message.
  must(await db.from('conversations').update({ club_last_read_at: new Date(t - 1000).toISOString(), partner_last_read_at: new Date(t).toISOString() }).eq('id', conv.id), 'read marks')
  return conv
}

const conv1L = await conversation('moot', 'summit', 'Sponsor lunch at 1L Bar Prep Kickoff', ev.moot1L, opp1L, [
  ['partner', 'Hi! We saw your 1L Bar Prep Kickoff posting — we would love to sponsor lunch.'],
  ['club', 'That would be amazing. We are expecting about 50 students.'],
  ['partner', 'Sent a sponsorship proposal: 50 lunches/people covered, student offer: 15% off any course, 10 min to present\n\nHappy to bring flyers too.'],
], 'partner')
must(await db.from('proposals').insert({
  club_id: clubs.moot.id, partner_id: partners.summit.id, opportunity_id: opp1L.id, event_id: ev.moot1L.id, conversation_id: conv1L.id,
  headcount: 50, student_offer: '15% off any course', pitch_minutes: 10, message: 'Happy to bring flyers too.', status: 'pending_club',
}), 'proposal pending_club')

const convGala = await conversation('wil', 'lexicode', 'Spring Gala sponsorship', ev.wilGala, oppGala, [
  ['club', 'Hi LexiCode team — would you consider sponsoring our Spring Gala?'],
  ['partner', 'Yes! We can contribute $1,000 and would love a short welcome.'],
  ['system', 'The club accepted the proposal. It now goes to the university administrator for approval.'],
])
must(await db.from('proposals').insert({
  club_id: clubs.wil.id, partner_id: partners.lexicode.id, opportunity_id: oppGala.id, event_id: ev.wilGala.id, conversation_id: convGala.id,
  amount: 1000, pitch_minutes: 5, message: 'Excited to support the Gala!', status: 'pending_admin', club_responded_at: at(-1),
}), 'proposal pending_admin')
must(await db.from('proposals').insert({
  club_id: clubs.moot.id, partner_id: partners.wasatch.id, opportunity_id: oppFinals.id, event_id: ev.mootFinals.id,
  amount: 350, pitch_minutes: 5, in_kind: 'Attorney judges for the final round', status: 'approved', club_responded_at: at(-10), reviewed_at: at(-8),
}), 'proposal approved')
must(await db.from('proposals').insert({
  club_id: clubs.pils.id, partner_id: partners.cougar.id, event_id: ev.pilsClinic.id,
  headcount: 25, message: 'We could provide sandwiches at cost.', status: 'declined', club_responded_at: at(-3),
}), 'proposal declined')
await conversation('pils', 'wasatch', 'Pro bono partnership', null, null, [
  ['club', 'Hello! Would Wasatch attorneys be interested in supervising our expungement clinic?'],
  ['partner', 'Possibly — can you share the date and expected number of clients?'],
])

// ---- done ------------------------------------------------------------------------------
console.log('\nDemo data created. Logins (password for all: ' + DEMO_PASSWORD + '):')
const rows = [
  ...ADMINS.map((a) => [a.skipped ? `${a.uni} admin (existing)` : `${a.uni} admin`, a.skipped ?? a.email]),
  ...CLUBS.map((c) => [`Club: ${c.name}`, c.email]),
  ...PARTNERS.map((p) => [`Partner: ${p.name}`, p.email]),
]
for (const [who, email] of rows) console.log(`  ${who.padEnd(42)} ${email}`)
