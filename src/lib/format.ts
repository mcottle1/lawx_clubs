export const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** The browser's IANA time zone, e.g. "America/Denver". */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver'
}

/** "Thu, Dec 3, 2026" for a YYYY-MM-DD date (no time-zone shifting). */
export function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

/** "Thu, Dec 3, 2026 · 12:00 – 1:00 PM MST", shown in the event's own time zone. */
export function formatEventRange(startsAt: string, endsAt: string, timeZone: string): string {
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  const day = start.toLocaleDateString('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  const time = (d: Date, zone = false) =>
    d.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit', ...(zone ? { timeZoneName: 'short' } : {}) })
  return `${day} · ${time(start)} – ${time(end, true)}`
}

/** Split an ISO timestamp into local <input type=date/time> values for a time zone. */
export function toDateTimeInputs(iso: string, timeZone: string): { date: string; time: string } {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-CA', { timeZone }) // YYYY-MM-DD
  const time = d.toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false })
  return { date, time }
}

/** Today's date as YYYY-MM-DD in the browser's time zone. */
export function todayIso(): string {
  return new Date().toLocaleDateString('en-CA')
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
