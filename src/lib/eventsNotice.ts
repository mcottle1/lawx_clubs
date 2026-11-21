// "Upcoming events" notice: a dated list of events (name, time, location,
// host club, description, flyer) to paste into an email or attach as a PDF.

export interface NoticeEvent {
  id: string
  name: string
  starts_at: string
  ends_at: string
  time_zone: string
  location: string | null
  description: string
  club_name: string
  /** Public flyer URL, if any. */
  flyer_url: string | null
}

/** "Tue, Dec 8 · 12:00 – 1:15 PM MST" in the event's own time zone. */
export function noticeWhen(e: Pick<NoticeEvent, 'starts_at' | 'ends_at' | 'time_zone'>): string {
  const s = new Date(e.starts_at)
  const t = new Date(e.ends_at)
  const day = s.toLocaleDateString('en-US', { timeZone: e.time_zone, weekday: 'short', month: 'short', day: 'numeric' })
  const time = (d: Date, zone = false) =>
    d.toLocaleTimeString('en-US', { timeZone: e.time_zone, hour: 'numeric', minute: '2-digit', ...(zone ? { timeZoneName: 'short' } : {}) })
  return `${day} · ${time(s)} – ${time(t, true)}`
}

/** "Dec 1 – Dec 14, 2026" for two YYYY-MM-DD dates. */
export function rangeLabel(from: string, to: string): string {
  const d = (iso: string, year: boolean) => {
    const [y, m, day] = iso.split('-').map(Number)
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) })
  }
  return from === to ? d(from, true) : `${d(from, false)} – ${d(to, true)}`
}

export function noticeTitle(orgName: string, from: string, to: string): string {
  return `Upcoming events · ${orgName} · ${rangeLabel(from, to)}`
}

/** Events sorted by start time, each as lines of text. */
export function noticeLines(e: NoticeEvent): string[] {
  return [
    e.name,
    noticeWhen(e),
    `Location: ${e.location ?? 'To be announced'}`,
    `Hosted by: ${e.club_name}`,
    ...(e.description.trim() ? [e.description.trim()] : []),
    ...(e.flyer_url ? [`Flyer: ${e.flyer_url}`] : []),
  ]
}

export function sortEvents(events: NoticeEvent[]): NoticeEvent[] {
  return [...events].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
}

export function noticeText(title: string, events: NoticeEvent[]): string {
  if (events.length === 0) return `${title}\n\nNo events scheduled.\n`
  return `${title}\n\n${sortEvents(events).map((e) => noticeLines(e).join('\n')).join('\n\n')}\n`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const isPdf = (url: string) => /\.pdf($|\?)/i.test(url)

/** Email-ready HTML (flyer images inline, PDFs as links). */
export function noticeHtml(title: string, events: NoticeEvent[]): string {
  const items = sortEvents(events).map((e) => [
    `<h3 style="margin:16px 0 4px">${esc(e.name)}</h3>`,
    `<p style="margin:0"><strong>${esc(noticeWhen(e))}</strong><br>Location: ${esc(e.location ?? 'To be announced')}<br>Hosted by: ${esc(e.club_name)}</p>`,
    e.description.trim() ? `<p style="margin:6px 0;white-space:pre-line">${esc(e.description.trim())}</p>` : '',
    e.flyer_url
      ? isPdf(e.flyer_url)
        ? `<p style="margin:6px 0"><a href="${esc(e.flyer_url)}">View the flyer (PDF)</a></p>`
        : `<p style="margin:6px 0"><img src="${esc(e.flyer_url)}" alt="Flyer for ${esc(e.name)}" style="max-width:420px;width:100%;border-radius:6px"></p>`
      : '',
  ].join('')).join('<hr style="border:none;border-top:1px solid #ddd;margin:16px 0">')
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.45"><h2 style="margin:0 0 8px">${esc(title)}</h2>${items || '<p>No events scheduled.</p>'}</div>`
}
