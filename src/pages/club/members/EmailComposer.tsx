import { useEffect, useState, type FormEvent } from 'react'
import { formatBytes } from '../../../lib/format'
import { callFunction, supabase } from '../../../lib/supabase'
import type { ClubFile } from '../../../lib/types'
import { Alert, Button, Field, inputClass } from '../../../components/ui'

const ATTACHMENT_MIMES = [
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx'
const MAX_TOTAL = 10 * 1024 * 1024
const MAX_FILES = 10

interface SendResult {
  status: 'sent' | 'partial' | 'failed' | 'skipped'
  recipient_count: number
  delivered_count: number
  skipped_count: number
  club_copy?: boolean
  error?: string
}

function safeName(name: string): string {
  return name.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(-80) || 'file'
}

/** Compose an email to all members (or leadership), with attachments from club files or the device. */
export default function EmailComposer({
  clubId,
  clubEmail,
  userId,
  memberCount,
  leaderCount,
  onSent,
}: {
  clubId: string
  clubEmail: string
  userId: string
  memberCount: number
  leaderCount: number
  onSent: (message: string) => void
}) {
  const [audience, setAudience] = useState<'all' | 'leadership'>('all')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [clubFiles, setClubFiles] = useState<ClubFile[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [local, setLocal] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<'test' | 'send' | null>(null)

  useEffect(() => {
    void supabase.from('club_files').select('*').eq('club_id', clubId).order('created_at', { ascending: false })
      .then(({ data }) => setClubFiles((data as ClubFile[]) ?? []))
  }, [clubId])

  const recipients = audience === 'all' ? memberCount : leaderCount
  const pickedFiles = (clubFiles ?? []).filter((f) => picked.has(f.id))
  const totalBytes = pickedFiles.reduce((s, f) => s + (f.size_bytes ?? 0), 0) + local.reduce((s, f) => s + f.size, 0)
  const attachmentCount = pickedFiles.length + local.length

  function togglePicked(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function addLocal(files: FileList | null) {
    setError(null)
    const list = Array.from(files ?? [])
    const bad = list.find((f) => !ATTACHMENT_MIMES.includes(f.type))
    if (bad) return setError(`${bad.name} can't be attached. Use PDF, Word, Excel, PowerPoint, text, CSV or image files.`)
    setLocal((prev) => [...prev, ...list])
  }

  async function send(test: boolean) {
    setError(null)
    setNotice(null)
    if (!subject.trim()) return setError('Add a subject.')
    if (!body.trim()) return setError('Write a message.')
    if (attachmentCount > MAX_FILES) return setError(`Attach at most ${MAX_FILES} files.`)
    if (totalBytes > MAX_TOTAL) return setError('Attachments must add up to 10 MB or less.')
    if (!test) {
      if (recipients === 0) return setError(audience === 'leadership' ? 'No members have a leadership role yet.' : 'Add members first.')
      if (!confirm(`Send “${subject.trim()}” to ${recipients} ${audience === 'leadership' ? 'leader' : 'member'}${recipients === 1 ? '' : 's'}?`)) return
    }
    setBusy(test ? 'test' : 'send')
    const uploads: { path: string; name: string }[] = []
    try {
      // Device files go to a private bucket just for this send; the server deletes them afterwards.
      for (const f of local) {
        const path = `${userId}/email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName(f.name)}`
        const up = await supabase.storage.from('email-attachments').upload(path, f, { contentType: f.type })
        if (up.error) throw new Error(`Couldn't upload ${f.name}: ${up.error.message}`)
        uploads.push({ path, name: f.name })
      }
      const res = await callFunction<SendResult>('email-members', {
        audience, subject: subject.trim(), body: body.trim(), club_file_ids: [...picked], uploads, test,
      })
      if (test) {
        if (res.status === 'sent') setNotice(`Test sent to ${clubEmail}.`)
        else setError(res.error ?? 'The test email could not be sent.')
        return
      }
      if (res.status === 'sent' || res.status === 'partial') {
        const note = res.status === 'partial' || res.skipped_count
          ? ` (${res.delivered_count} of ${res.recipient_count} delivered${res.error ? ` — ${res.error}` : ''})`
          : ''
        const copy = res.club_copy ? `, plus a copy to ${clubEmail}` : ''
        onSent(`Email sent to ${res.delivered_count} ${res.delivered_count === 1 ? 'member' : 'members'}${copy}${note}.`)
      } else {
        setError(res.error ?? 'The email could not be sent.')
      }
    } catch (e) {
      await supabase.storage.from('email-attachments').remove(uploads.map((u) => u.path))
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void send(false)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-800">To</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="audience" className="accent-accent-600" checked={audience === 'all'} onChange={() => setAudience('all')} />
            All members ({memberCount})
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="audience" className="accent-accent-600" checked={audience === 'leadership'} onChange={() => setAudience('leadership')} />
            Leadership only ({leaderCount})
          </label>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          A copy always goes to your club’s email, {clubEmail}, and replies go there too. Members are BCC’d,
          so they don’t see each other’s addresses.
        </p>
      </fieldset>

      <Field label="Subject" required>
        {(id) => <input id={id} className={inputClass} value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />}
      </Field>
      <Field label="Message" required>
        {(id) => <textarea id={id} rows={8} className={inputClass} value={body} maxLength={20000} onChange={(e) => setBody(e.target.value)} />}
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-800">Attachments</legend>
        <details className="rounded-lg border border-slate-200 p-3 text-sm" open={picked.size > 0}>
          <summary className="cursor-pointer font-medium text-accent-700">From club files{picked.size > 0 && ` (${picked.size} selected)`}</summary>
          {clubFiles === null ? (
            <p className="mt-2 text-slate-500">Loading…</p>
          ) : clubFiles.length === 0 ? (
            <p className="mt-2 text-slate-500">No club files yet. Upload them on the Files tab.</p>
          ) : (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {clubFiles.map((f) => (
                <li key={f.id}>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="accent-accent-600" checked={picked.has(f.id)} onChange={() => togglePicked(f.id)} />
                    <span className="min-w-0 truncate">{f.file_name}</span>
                    <span className="shrink-0 text-xs text-slate-500">{formatBytes(f.size_bytes)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </details>
        <Field label="From your device" hint="PDF, Word, Excel, PowerPoint, text, CSV or images. Up to 10 files and 10 MB in total.">
          {(id) => <input id={id} type="file" multiple accept={ACCEPT} className={inputClass} onChange={(e) => { addLocal(e.target.files); e.target.value = '' }} />}
        </Field>
        {local.length > 0 && (
          <ul className="space-y-1 text-sm">
            {local.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2">
                <span className="min-w-0 truncate">{f.name}</span>
                <span className="shrink-0 text-xs text-slate-500">{formatBytes(f.size)}</span>
                <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => setLocal((prev) => prev.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {attachmentCount > 0 && (
          <p className={`text-xs ${totalBytes > MAX_TOTAL || attachmentCount > MAX_FILES ? 'text-red-700' : 'text-slate-500'}`}>
            {attachmentCount} attachment{attachmentCount === 1 ? '' : 's'}, {formatBytes(totalBytes)} of 10 MB
          </p>
        )}
      </fieldset>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" disabled={busy !== null} onClick={() => void send(true)}>
          {busy === 'test' ? 'Sending test…' : 'Send me a test'}
        </Button>
        <Button type="submit" variant="pop" disabled={busy !== null || recipients === 0}>
          {busy === 'send' ? 'Sending…' : `Send to ${recipients} ${audience === 'leadership' ? 'leader' : 'member'}${recipients === 1 ? '' : 's'}`}
        </Button>
      </div>
    </form>
  )
}
