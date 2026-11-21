import { describe, expect, it } from 'vitest'
import { noticeHtml, noticeText, noticeTitle, rangeLabel, type NoticeEvent } from './eventsNotice'

const ev = (over: Partial<NoticeEvent>): NoticeEvent => ({
  id: over.name ?? 'x', name: 'Event', starts_at: '2026-12-08T19:00:00Z', ends_at: '2026-12-08T20:15:00Z',
  time_zone: 'America/Denver', location: 'Room 101', description: '', club_name: 'Moot Court Society', flyer_url: null, ...over,
})

describe('events notice', () => {
  it('orders events by date and includes time, location, club, description and flyer', () => {
    const text = noticeText('Upcoming events', [
      ev({ name: 'Second', starts_at: '2026-12-10T19:00:00Z', ends_at: '2026-12-10T20:00:00Z', flyer_url: 'https://x.example/f.png' }),
      ev({ name: 'First', description: 'Pizza & a <panel>' }),
    ])
    expect(text.indexOf('First')).toBeLessThan(text.indexOf('Second'))
    expect(text).toContain('Tue, Dec 8 · 12:00 PM – 1:15 PM MST')
    expect(text).toContain('Location: Room 101')
    expect(text).toContain('Hosted by: Moot Court Society')
    expect(text).toContain('Pizza & a <panel>')
    expect(text).toContain('Flyer: https://x.example/f.png')
  })

  it('says when nothing is scheduled', () => {
    expect(noticeText('T', [])).toContain('No events scheduled.')
  })

  it('escapes HTML, shows image flyers inline and PDF flyers as links', () => {
    const html = noticeHtml('T', [
      ev({ name: 'A <b>', description: 'x & y', flyer_url: 'https://x.example/a.jpg' }),
      ev({ name: 'B', flyer_url: 'https://x.example/b.pdf', starts_at: '2026-12-09T19:00:00Z', ends_at: '2026-12-09T20:00:00Z' }),
    ])
    expect(html).toContain('A &lt;b&gt;')
    expect(html).toContain('x &amp; y')
    expect(html).toContain('<img src="https://x.example/a.jpg"')
    expect(html).toContain('<a href="https://x.example/b.pdf">')
  })

  it('labels the date range', () => {
    expect(rangeLabel('2026-12-01', '2026-12-14')).toBe('Dec 1 – Dec 14, 2026')
    expect(noticeTitle('BYU Law', '2026-12-01', '2026-12-01')).toBe('Upcoming events · BYU Law · Dec 1, 2026')
  })
})
