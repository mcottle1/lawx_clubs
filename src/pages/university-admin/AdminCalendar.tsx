import { useEffect, useState } from 'react'
import { Alert, Button, Card, Field, inputClass, Spinner } from '../../components/ui'
import { publicUrl } from '../../lib/files'
import { todayIso } from '../../lib/format'
import { noticeHtml, noticeLines, noticeText, noticeTitle, noticeWhen, sortEvents, type NoticeEvent } from '../../lib/eventsNotice'
import { supabase } from '../../lib/supabase'
import type { ClubEvent, EventReport } from '../../lib/types'
import ClubCalendar from '../club/dashboard/ClubCalendar'

type Row = ClubEvent & { clubs: { name: string } | null }

const plusDays = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d + days).toLocaleDateString('en-CA')
}

/**
 * One calendar with every club's events (the admin's college, or the whole
 * university for an organization admin), plus an "upcoming events" notice.
 */
export default function AdminCalendar({ base, orgName }: { base: string; orgName: string }) {
  const [events, setEvents] = useState<Row[] | null>(null)
  const [reports, setReports] = useState<Map<string, EventReport>>(new Map())

  useEffect(() => {
    void Promise.all([
      supabase.from('events').select('*, clubs(name)').order('starts_at'),
      supabase.from('event_reports').select('*'),
    ]).then(([e, r]) => {
      setEvents((e.data as Row[]) ?? [])
      setReports(new Map(((r.data as EventReport[]) ?? []).map((x) => [x.event_id, x])))
    })
  }, [])

  if (!events) return <Spinner />
  return (
    <div className="space-y-4">
      <ClubCalendar
        events={events}
        reports={reports}
        basePath={`${base}/events`}
        heading="All clubs’ events"
        label={(e) => `${(e as Row).clubs?.name ?? 'Club'}: ${e.name}`}
      />
      <EventsNotice orgName={orgName} />
    </div>
  )
}

function EventsNotice({ orgName }: { orgName: string }) {
  const [from, setFrom] = useState(todayIso())
  const [to, setTo] = useState(plusDays(todayIso(), 13))
  const [includePending, setIncludePending] = useState(false)
  const [items, setItems] = useState<NoticeEvent[] | null>(null)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState<'gen' | 'pdf' | null>(null)
  const title = noticeTitle(orgName, from, to)

  async function generate() {
    setMsg(null)
    if (!from || !to || to < from) return setMsg({ kind: 'error', text: 'Choose a start date on or before the end date.' })
    setBusy('gen')
    // Whole days in the viewer's time zone.
    const start = new Date(`${from}T00:00:00`).toISOString()
    const end = new Date(`${plusDays(to, 1)}T00:00:00`).toISOString()
    const { data, error } = await supabase.from('events')
      .select('id, name, starts_at, ends_at, time_zone, location, description, flyer_path, clubs(name)')
      .gte('starts_at', start).lt('starts_at', end)
      .in('approval_status', includePending ? ['approved', 'pending'] : ['approved'])
      .order('starts_at')
    setBusy(null)
    if (error) return setMsg({ kind: 'error', text: error.message })
    setItems(((data ?? []) as unknown as (ClubEvent & { clubs: { name: string } | null })[]).map((e) => ({
      id: e.id, name: e.name, starts_at: e.starts_at, ends_at: e.ends_at, time_zone: e.time_zone,
      location: e.location, description: e.description ?? '', club_name: e.clubs?.name ?? '',
      flyer_url: publicUrl('flyers', e.flyer_path),
    })))
  }

  async function copy() {
    if (!items) return
    const text = noticeText(title, items)
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([noticeHtml(title, items)], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })])
      } else {
        await navigator.clipboard.writeText(text)
      }
      setMsg({ kind: 'success', text: 'Copied. Paste it into an email; flyers come along as images.' })
    } catch {
      setMsg({ kind: 'error', text: 'Your browser blocked copying. Select the preview below and copy it instead.' })
    }
  }

  async function downloadPdf() {
    if (!items) return
    setBusy('pdf')
    try {
      const blob = await noticePdf(title, items)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `upcoming-events-${from}-to-${to}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      setMsg({ kind: 'error', text: `Couldn't make the PDF: ${(e as Error).message}` })
    }
    setBusy(null)
  }

  return (
    <Card>
      <h2 className="font-medium">Upcoming events notice</h2>
      <p className="mt-1 text-sm text-slate-600">
        Pick dates to list every event in order, with its time, location, host club, description and flyer. Copy it into an email or download it as a PDF to attach.
      </p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <Field label="From">{(id) => <input id={id} type="date" className={`${inputClass} sm:w-44`} value={from} onChange={(e) => { setFrom(e.target.value); setItems(null) }} />}</Field>
        <Field label="To">{(id) => <input id={id} type="date" className={`${inputClass} sm:w-44`} value={to} onChange={(e) => { setTo(e.target.value); setItems(null) }} />}</Field>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" className="accent-accent-600" checked={includePending} onChange={(e) => { setIncludePending(e.target.checked); setItems(null) }} />
          Include events still waiting for approval
        </label>
        <Button onClick={() => void generate()} disabled={busy !== null}>{busy === 'gen' ? 'Working…' : 'Create notice'}</Button>
      </div>
      {msg && <Alert kind={msg.kind} className="mt-3">{msg.text}</Alert>}

      {items && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void copy()}>Copy for email</Button>
            <Button variant="secondary" onClick={() => void downloadPdf()} disabled={busy !== null}>{busy === 'pdf' ? 'Making PDF…' : 'Download PDF'}</Button>
            <span className="self-center text-sm text-slate-600">{items.length} event{items.length === 1 ? '' : 's'}</span>
          </div>
          <article aria-label="Notice preview" className="mt-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <h3 className="text-base font-semibold">{title}</h3>
            {items.length === 0 ? <p className="mt-2 text-slate-600">No events scheduled.</p> : (
              <ol className="mt-2 divide-y divide-slate-100">
                {sortEvents(items).map((e) => (
                  <li key={e.id} className="py-3">
                    <p className="font-semibold">{e.name}</p>
                    <p className="font-medium text-slate-800">{noticeWhen(e)}</p>
                    <p className="text-slate-700">Location: {e.location ?? 'To be announced'}</p>
                    <p className="text-slate-700">Hosted by: {e.club_name}</p>
                    {e.description.trim() && <p className="mt-1 whitespace-pre-line text-slate-700">{e.description.trim()}</p>}
                    {e.flyer_url && (/\.pdf($|\?)/i.test(e.flyer_url)
                      ? <a className="mt-1 inline-block text-accent-700 hover:underline" href={e.flyer_url} target="_blank" rel="noreferrer">View the flyer (PDF)</a>
                      : <img src={e.flyer_url} alt={`Flyer for ${e.name}`} className="mt-2 max-h-64 rounded border border-slate-200" />)}
                  </li>
                ))}
              </ol>
            )}
          </article>
        </div>
      )}
    </Card>
  )
}

/** Loads an image as a JPEG data URL (any format the browser can show), with its size. */
async function imageData(url: string): Promise<{ data: string; w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const scale = Math.min(1, 1200 / img.naturalWidth)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(null)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      try {
        resolve({ data: canvas.toDataURL('image/jpeg', 0.85), w: canvas.width, h: canvas.height })
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** A simple letter-size PDF of the notice; image flyers are included, PDF flyers linked. */
async function noticePdf(title: string, events: NoticeEvent[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const margin = 54
  const width = doc.internal.pageSize.getWidth() - margin * 2
  const bottom = doc.internal.pageSize.getHeight() - margin
  let y = margin
  const room = (h: number) => { if (y + h > bottom) { doc.addPage(); y = margin } }
  const write = (text: string, size: number, style: 'normal' | 'bold' = 'normal', gap = 4) => {
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
    for (const line of doc.splitTextToSize(text, width) as string[]) {
      room(size + gap)
      doc.text(line, margin, y + size)
      y += size + gap
    }
  }

  write(title, 16, 'bold', 6)
  y += 6
  if (events.length === 0) write('No events scheduled.', 11)
  for (const e of sortEvents(events)) {
    room(60)
    doc.setDrawColor(220)
    doc.line(margin, y, margin + width, y)
    y += 12
    const [name, when, ...rest] = noticeLines(e).filter((l) => !l.startsWith('Flyer: '))
    write(name, 13, 'bold')
    write(when, 11, 'bold')
    for (const l of rest) write(l, 11)
    if (e.flyer_url) {
      const img = /\.pdf($|\?)/i.test(e.flyer_url) ? null : await imageData(e.flyer_url)
      if (img) {
        const w = Math.min(width * 0.6, img.w)
        const h = (img.h / img.w) * w
        const fit = Math.min(h, bottom - margin)
        room(fit + 8)
        doc.addImage(img.data, 'JPEG', margin, y + 4, (fit / h) * w, fit)
        y += fit + 12
      } else {
        write(`Flyer: ${e.flyer_url}`, 10)
      }
    }
    y += 10
  }
  return doc.output('blob')
}
