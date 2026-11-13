#!/usr/bin/env node
// Import the U.S. Dept. of Education IPEDS institution directory into `universities`.
//
// 1. Download the "HD" (Directory information) CSV for the latest year from
//    https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx  (e.g. HD2023.zip → hd2023.csv)
// 2. Run (service-role key: Supabase → Project Settings → API; never commit it):
//      SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//        node scripts/import-ipeds.mjs path/to/hd2023.csv [--dry-run]
//
// Safe to re-run: rows are upserted on ipeds_id; starter rows without an
// ipeds_id are matched by name + state and get their ipeds_id filled in.
// is_participating is never changed.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const [file, ...flags] = process.argv.slice(2)
const dryRun = flags.includes('--dry-run')
if (!file) {
  console.error('Usage: node scripts/import-ipeds.mjs <hdYYYY.csv> [--dry-run]')
  process.exit(1)
}

// ---- CSV parsing (handles quoted fields, embedded commas/quotes/newlines) ----
function decode(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('windows-1252').decode(buf) // older IPEDS files
  }
}

function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.length > 1 || r[0])
}

// ---- Mapping IPEDS codes → institution_type ---------------------------------
// ICLEVEL: 1 = four-year or above, 2 = two-year, 3 = less than two-year
// INSTCAT: 1 = graduate degrees only, 2-4 = other degree-granting, 5-6 = non-degree
function institutionType(r) {
  const name = r.INSTNM
  if (/\b(law school|school of law|college of law)\b/i.test(name)) return 'law_school'
  if (r.INSTCAT === '1') {
    if (/\b(medical|medicine|osteopathic)\b/i.test(name)) return 'medical_school'
    return 'graduate_school'
  }
  if (r.ICLEVEL === '1') return 'university'
  if (r.ICLEVEL === '2') return 'community_college'
  return 'other'
}

const rows = parseCsv(decode(readFileSync(file)))
const header = rows.shift().map((h) => h.replace(/^\uFEFF/, '').trim().toUpperCase())
for (const col of ['UNITID', 'INSTNM', 'CITY', 'STABBR']) {
  if (!header.includes(col)) throw new Error(`Column ${col} not found — is this the IPEDS HD (directory) file?`)
}
const records = rows
  .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])))
  .filter((r) => r.UNITID && r.INSTNM)
  .filter((r) => !r.CYACTIVE || r.CYACTIVE === '1') // currently active
  .filter((r) => !r.INSTCAT || ['1', '2', '3', '4'].includes(r.INSTCAT)) // degree-granting

const incoming = records.map((r) => ({
  ipeds_id: r.UNITID,
  name: r.INSTNM,
  city: r.CITY || null,
  state: r.STABBR || null,
  type: institutionType(r),
}))
console.log(`Parsed ${rows.length} rows → ${incoming.length} active degree-granting institutions`)

const typeCounts = incoming.reduce((acc, u) => ({ ...acc, [u.type]: (acc[u.type] ?? 0) + 1 }), {})
console.log('By type:', typeCounts)
if (dryRun) {
  console.log('Dry run — nothing written. Sample:', incoming.slice(0, 3))
  process.exit(0)
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// 1. Back-fill ipeds_id on starter rows (matched by name + state).
const { data: manual, error: manualErr } = await db.from('universities').select('id, name, state').is('ipeds_id', null)
if (manualErr) throw manualErr
const key = (name, state) => `${name.toLowerCase()}|${state ?? ''}`
const byKey = new Map(incoming.map((u) => [key(u.name, u.state), u]))
const { data: existingIds } = await db.from('universities').select('ipeds_id').not('ipeds_id', 'is', null).limit(100000)
const taken = new Set((existingIds ?? []).map((r) => r.ipeds_id))
let matched = 0
for (const row of manual ?? []) {
  const hit = byKey.get(key(row.name, row.state))
  if (!hit || taken.has(hit.ipeds_id)) continue
  const { error } = await db.from('universities').update({ ipeds_id: hit.ipeds_id }).eq('id', row.id)
  if (error) throw error
  taken.add(hit.ipeds_id)
  matched++
}
console.log(`Linked ${matched} existing rows to their IPEDS id`)

// 2. Upsert everything else in batches.
let written = 0
for (let i = 0; i < incoming.length; i += 500) {
  const batch = incoming.slice(i, i + 500)
  const { error } = await db.from('universities').upsert(batch, { onConflict: 'ipeds_id' })
  if (error) throw error
  written += batch.length
  process.stdout.write(`\rUpserted ${written}/${incoming.length}`)
}
console.log('\nDone.')
