/** Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

const HEADER_WORDS = /^(name|first|last|first name|last name|full name|email|e-mail|phone|netid|id|student id|year|class)$/i

export interface RosterCount {
  /** Non-empty data rows (excluding the header, if any). */
  count: number
  looksLikeHeader: boolean
  /** First row's cells, for showing the user. */
  firstRow: string[]
}

/** Counts members in a roster CSV: one member per non-empty row. */
export function countRoster(text: string, hasHeader?: boolean): RosterCount {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''))
  const firstRow = rows[0] ?? []
  const looksLikeHeader = firstRow.some((c) => HEADER_WORDS.test(c.trim()))
  const skip = (hasHeader ?? looksLikeHeader) && rows.length > 0 ? 1 : 0
  return { count: rows.length - skip, looksLikeHeader, firstRow }
}
