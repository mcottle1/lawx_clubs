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

/** One CSV cell: quoted when needed; spreadsheet formulas are neutralized. */
export function csvCell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v)
  // A leading = + - @ would run as a formula when opened in Excel/Sheets.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** Saves rows as a .csv file in the browser. */
export function downloadCsv(fileName: string, rows: (string | number | null | undefined)[][]): void {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
