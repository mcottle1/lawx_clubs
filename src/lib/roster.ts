import { parseCsv } from './csv'

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export interface RosterMember {
  name: string
  email: string
  role: string | null
  /** 1-based row number in the file, for messages. */
  line: number
}

export interface RosterProblem {
  line: number
  reason: string
  raw: string
}

export interface ParsedRoster {
  members: RosterMember[]
  problems: RosterProblem[]
  /** Whether the file had a recognizable header row. */
  hasHeader: boolean
  /** Whether a role/position column was found. */
  hasRoleColumn: boolean
}

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
export const emailKey = (email: string) => email.trim().toLowerCase()

/** Finds a column index whose header matches any of the patterns (first match wins). */
function findColumn(header: string[], patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = header.findIndex((h) => !h.includes('@') && p.test(clean(h)))
    if (i >= 0) return i
  }
  return -1
}

/**
 * Reads a roster CSV with member names and emails. Recognizes headers like
 * "Name", "Full name", "First name" + "Last name", "Email"/"E-mail", and an
 * optional "Role"/"Position"/"Office". Without a header, the email column is
 * detected from the data and the first other column is used as the name.
 * Duplicate emails keep the first row.
 */
export function parseRoster(text: string): ParsedRoster {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''))
  const members: RosterMember[] = []
  const problems: RosterProblem[] = []
  if (rows.length === 0) return { members, problems, hasHeader: false, hasRoleColumn: false }

  const header = rows[0]
  let emailCol = findColumn(header, [/^e-?mail( address)?$/i, /e-?mail/i])
  const hasHeader = !header.some((h) => EMAIL_RE.test(clean(h))) &&
    (emailCol >= 0 || header.some((h) => /^(full )?name$/i.test(clean(h))))
  if (!hasHeader) emailCol = -1
  let nameCol = -1
  let firstCol = -1
  let lastCol = -1
  let roleCol = -1

  if (hasHeader) {
    nameCol = findColumn(header, [/^(full |member |student )?name$/i, /^name\b/i])
    firstCol = findColumn(header, [/^first( name)?$/i, /^given( name)?$/i, /first/i])
    lastCol = findColumn(header, [/^last( name)?$/i, /^(surname|family name)$/i, /last/i])
    roleCol = findColumn(header, [/^(leadership )?(role|position|office|title)$/i, /role|position|office/i])
    if (emailCol < 0) {
      emailCol = -2 // header without an email column
    }
  } else {
    // Pick the column where most cells look like emails.
    const width = Math.max(...rows.map((r) => r.length))
    let best = -1
    let bestHits = 0
    for (let c = 0; c < width; c++) {
      const hits = rows.filter((r) => EMAIL_RE.test(clean(r[c]))).length
      if (hits > bestHits) { best = c; bestHits = hits }
    }
    emailCol = best
    nameCol = best === 0 ? 1 : 0
  }

  if (emailCol < 0) {
    return {
      members,
      problems: [{ line: 1, reason: 'No email column found. Add a column named "Email".', raw: header.join(', ') }],
      hasHeader,
      hasRoleColumn: false,
    }
  }

  const seen = new Set<string>()
  rows.slice(hasHeader ? 1 : 0).forEach((r, i) => {
    const line = i + (hasHeader ? 2 : 1)
    const raw = r.join(', ')
    const email = clean(r[emailCol]).replace(/^mailto:/i, '')
    let name = nameCol >= 0 ? clean(r[nameCol]) : ''
    if (!name && (firstCol >= 0 || lastCol >= 0)) {
      name = [firstCol >= 0 ? clean(r[firstCol]) : '', lastCol >= 0 ? clean(r[lastCol]) : ''].filter(Boolean).join(' ')
    }
    const role = roleCol >= 0 ? clean(r[roleCol]).slice(0, 80) || null : null
    if (!email) return problems.push({ line, reason: 'Missing email', raw })
    if (!EMAIL_RE.test(email) || email.length > 320) return problems.push({ line, reason: 'Not a valid email', raw })
    if (!name) return problems.push({ line, reason: 'Missing name', raw })
    const key = emailKey(email)
    if (seen.has(key)) return problems.push({ line, reason: 'Duplicate email in this file', raw })
    seen.add(key)
    members.push({ name: name.slice(0, 200), email, role, line })
  })

  return { members, problems, hasHeader, hasRoleColumn: roleCol >= 0 }
}

export interface ExistingMember {
  id: string
  name: string
  email: string
  role: string | null
}

export interface RosterDiff {
  toAdd: RosterMember[]
  /** Existing members whose name (or role, when roles are imported) changes. */
  toUpdate: { id: string; name: string; role: string | null; before: ExistingMember }[]
  unchanged: number
  /** Existing members who aren't in the file. */
  notInFile: ExistingMember[]
}

/** Compares a parsed roster with the current member list (matched by email). */
export function diffRoster(existing: ExistingMember[], roster: RosterMember[], importRoles: boolean): RosterDiff {
  const byEmail = new Map(existing.map((m) => [emailKey(m.email), m]))
  const inFile = new Set<string>()
  const toAdd: RosterMember[] = []
  const toUpdate: RosterDiff['toUpdate'] = []
  let unchanged = 0
  for (const r of roster) {
    const key = emailKey(r.email)
    inFile.add(key)
    const m = byEmail.get(key)
    if (!m) {
      toAdd.push(importRoles ? r : { ...r, role: null })
      continue
    }
    // Only set roles from the file when it has one; a blank cell keeps the current role.
    const role = importRoles && r.role ? r.role : m.role
    if (m.name !== r.name || role !== m.role) toUpdate.push({ id: m.id, name: r.name, role, before: m })
    else unchanged++
  }
  const notInFile = existing.filter((m) => !inFile.has(emailKey(m.email)))
  return { toAdd, toUpdate, unchanged, notInFile }
}
