#!/usr/bin/env node
// LOCAL ONLY: checks the run-daily-jobs function against a local Supabase.
// Needs `npx supabase functions serve` running with CRON_SECRET set, e.g.
//   echo CRON_SECRET=local-test-secret > supabase/functions/.env
//   npx supabase functions serve
// then:  node scripts/test-daily-jobs.mjs     (or CRON_SECRET=... node ...)
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const st = JSON.parse(execSync('npx supabase status -o json', { stdio: ['ignore', 'pipe', 'ignore'] }).toString())
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(st.API_URL)) throw new Error('Not a local Supabase — refusing.')
const SECRET = process.env.CRON_SECRET ?? 'local-test-secret'
const db = createClient(st.API_URL, st.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
let failures = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failures++ }
const tag = `dj${Date.now() % 100000}`
const at = (days, hours = 0) => new Date(Date.now() + days * 864e5 + hours * 36e5).toISOString()

async function run(query = '') {
  const res = await fetch(`${st.API_URL}/functions/v1/run-daily-jobs${query}`, { method: 'POST', headers: { 'x-cron-secret': SECRET } })
  return { status: res.status, body: await res.json() }
}

// --- fixtures -----------------------------------------------------------------
const { data: byu } = await db.from('universities').select('id').eq('name', 'Brigham Young University').single()
const email = `${tag}@example.com`
const { data: u, error: uErr } = await db.auth.admin.createUser({
  email, password: 'password123', email_confirm: true,
  user_metadata: { role: 'club', club_name: `Daily Jobs Club ${tag}`, university_id: byu.id, initial_budget: '1000' },
})
if (uErr) throw uErr
const { data: club } = await db.from('clubs').select('id').eq('user_id', u.user.id).single()
const mk = async (name, fields) => {
  const { data, error } = await db.from('events').insert({ club_id: club.id, name: `${tag} ${name}`, time_zone: 'UTC', ...fields }).select().single()
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}
const A = await mk('A sponsor-due', { starts_at: at(5), ends_at: at(5, 1), partner_reminder_days: 7, location: 'Room 1' })
const B = await mk('B sponsor-later', { starts_at: at(30), ends_at: at(30, 1), partner_reminder_days: 7, location: 'Room 1' })
const C = await mk('C room-due', { starts_at: at(3), ends_at: at(3, 1), location_reminder_days: 5, outside_sponsor_name: 'Deli' })
const D = await mk('D ended', { starts_at: at(-2), ends_at: at(-2, 1), approval_status: 'approved', location: 'x', outside_sponsor_name: 'x' })
const F = await mk('F overdue', { starts_at: at(-5), ends_at: at(-5, 1), approval_status: 'approved', location: 'x', outside_sponsor_name: 'x' })
await db.from('events').update({ report_requested_at: at(-4) }).eq('id', F.id)
const G = await mk('G reported', { starts_at: at(-5), ends_at: at(-5, 1), approval_status: 'approved', location: 'x', outside_sponsor_name: 'x' })
await db.from('event_reports').insert({ event_id: G.id, attendees: 10, amount_spent: 5 })
const H = await mk('H denied', { starts_at: at(-5), ends_at: at(-5, 1), approval_status: 'denied', location: 'x', outside_sponsor_name: 'x' })
const I = await mk('I passed', { starts_at: at(2), ends_at: at(2, 1) })   // gets find-sponsor + book-room to-dos
await db.from('events').update({ starts_at: at(-1), ends_at: at(-1, 1), approval_status: 'denied' }).eq('id', I.id)

// --- checks ---------------------------------------------------------------------
const unauth = await fetch(`${st.API_URL}/functions/v1/run-daily-jobs`, { method: 'POST', headers: { 'x-cron-secret': 'wrong' } })
check('wrong secret is rejected', unauth.status === 401)

const dry = await run('?dry_run=1')
const mine = (r) => r.body.actions.filter((a) => a.includes(tag))
check('dry run lists actions', dry.status === 200 && mine(dry).length === 4, JSON.stringify(mine(dry)))
const { data: afterDry } = await db.from('events').select('partner_reminder_sent_at').eq('id', A.id).single()
check('dry run changes nothing', afterDry.partner_reminder_sent_at === null)

const first = await run()
const acts = mine(first)
const has = (s) => acts.some((a) => a.includes(s))
check('job runs', first.status === 200 && first.body.ok, first.status !== 200 ? JSON.stringify(first.body) : '')
check('sponsor reminder sent when due', has('partner reminder') && has('A sponsor-due'))
check('no sponsor reminder before it is due', !has('B sponsor-later'))
check('room reminder sent when due', has('location reminder') && has('C room-due'))
check('report requested the day after the event', acts.some((a) => a.startsWith('report request') && a.includes('D ended')))
check('report reminder 3 days after the request', acts.some((a) => a.startsWith('report reminder') && a.includes('F overdue')))
check('nothing for events with a report', !has('G reported'))
check('nothing for denied events', !has('H denied'))

const { data: evs } = await db.from('events').select('id, partner_reminder_sent_at, location_reminder_sent_at, report_requested_at, report_reminder_sent_at').in('id', [A.id, C.id, D.id, F.id])
const byId = Object.fromEntries(evs.map((e) => [e.id, e]))
check('sent stamps recorded', byId[A.id].partner_reminder_sent_at && byId[C.id].location_reminder_sent_at && byId[D.id].report_requested_at && byId[F.id].report_reminder_sent_at)
const { data: todo } = await db.from('todos').select('title, done').eq('related_event_id', D.id).eq('system_kind', 'submit_report').maybeSingle()
check('"Submit report" to-do created', todo && !todo.done, todo?.title)
const { data: iTodos } = await db.from('todos').select('done').eq('related_event_id', I.id)
check('leftover sponsor/room to-dos closed after the event', iTodos.length === 2 && iTodos.every((t) => t.done))
const { data: logs } = await db.from('email_log').select('template, to_email').eq('to_email', email)
const templates = new Set(logs.map((l) => l.template))
check('emails logged', ['partner_reminder', 'location_reminder', 'report_request', 'report_reminder'].every((t) => templates.has(t)), [...templates].join(','))

const second = await run()
check('second run on the same day does nothing for these events (idempotent)', second.status === 200 && mine(second).length === 0, JSON.stringify(mine(second)))
const { count: logCount } = await db.from('email_log').select('id', { count: 'exact', head: true }).eq('to_email', email)
check('no duplicate emails', logCount === logs.length)

// Report submitted → to-do ticked off, no further reminders
await db.from('event_reports').insert({ event_id: D.id, attendees: 30, amount_spent: 50 })
const { data: todoAfter } = await db.from('todos').select('done').eq('related_event_id', D.id).eq('system_kind', 'submit_report').single()
check('submitting the report completes the "Submit report" to-do', todoAfter.done)

console.log(failures ? `\n${failures} FAILED` : '\nAll daily-job checks passed')
process.exit(failures ? 1 : 0)
