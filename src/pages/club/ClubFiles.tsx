import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteClubFile, FILE_RULES, fileUrl, publicUrl, uploadClubFile } from '../../lib/files'
import { formatBytes } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { ClubFile, ClubFileType } from '../../lib/types'
import { Alert, Button, Card, inputClass, PageHeader, Spinner } from '../../components/ui'
import { useClub } from './ClubContext'

const ORDER: ClubFileType[] = ['flyer', 'logo', 'constitution', 'other']

export default function ClubFiles() {
  const { club, userId, refreshClub } = useClub()
  const [files, setFiles] = useState<(ClubFile & { events: { name: string } | null })[] | null>(null)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('club_files').select('*, events(name)').eq('club_id', club.id).order('created_at', { ascending: false })
    setFiles((data as (ClubFile & { events: { name: string } | null })[]) ?? [])
  }, [club.id])
  useEffect(() => { void load() }, [load])

  async function open(f: ClubFile) {
    // Open the tab during the click (before any await) so popup blockers allow it,
    // then point it at the file once the (signed) URL is ready.
    const tab = window.open('', '_blank')
    const url = await fileUrl(f.bucket, f.storage_path)
    if (!url) {
      tab?.close()
      setMsg({ kind: 'error', text: 'Could not open that file.' })
      return
    }
    if (tab) {
      tab.opener = null
      tab.location.href = url
    } else {
      window.location.href = url
    }
  }

  async function remove(f: ClubFile) {
    if (!confirm(`Delete ${f.file_name}?`)) return
    try {
      await deleteClubFile(f)
      setMsg({ kind: 'success', text: `Deleted ${f.file_name}.` })
      if (f.file_type === 'logo') await refreshClub()
      await load()
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message })
    }
  }

  if (!files) return <Spinner />

  return (
    <>
      <PageHeader title="Club files" subtitle="Flyers and your logo are visible to partners; your constitution and other documents are private to your club." />
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      <div className="space-y-4">
        {ORDER.map((type) => (
          <section key={type} id={type} aria-labelledby={`h-${type}`}>
            <Card>
              <h2 id={`h-${type}`} className="font-medium">{FILE_RULES[type].label}</h2>
              {type === 'flyer' && <p className="mt-1 text-xs text-slate-500">Event flyers are filed here automatically.</p>}
              {type === 'logo' && <p className="mt-1 text-xs text-slate-500">The most recent upload is your club’s logo.</p>}
              <FileList
                files={files.filter((f) => f.file_type === type)}
                currentLogo={type === 'logo' ? club.logo_path : null}
                onOpen={(f) => void open(f)}
                onDelete={(f) => void remove(f)}
              />
              <Uploader
                type={type}
                onUpload={async (file) => {
                  await uploadClubFile({ clubId: club.id, userId, file, type })
                  setMsg({ kind: 'success', text: `Uploaded ${file.name}.` })
                  if (type === 'logo') await refreshClub()
                  await load()
                }}
              />
            </Card>
          </section>
        ))}
      </div>
    </>
  )
}

function FileList({
  files, currentLogo, onOpen, onDelete,
}: {
  files: (ClubFile & { events: { name: string } | null })[]
  currentLogo: string | null
  onOpen: (f: ClubFile) => void
  onDelete: (f: ClubFile) => void
}) {
  if (files.length === 0) return <p className="mt-3 text-sm text-slate-500">No files yet.</p>
  return (
    <ul className="mt-3 divide-y divide-slate-100">
      {files.map((f) => {
        const thumb = f.bucket !== 'club-docs' && f.mime_type?.startsWith('image/') ? publicUrl(f.bucket, f.storage_path) : null
        return (
          <li key={f.id} className="flex items-center gap-3 py-2 text-sm">
            {thumb ? <img src={thumb} alt="" className="h-10 w-10 shrink-0 rounded border border-slate-200 object-cover" />
              : <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-xs text-slate-500">{f.file_name.split('.').pop()?.toUpperCase()}</span>}
            <div className="min-w-0 flex-1">
              <button type="button" onClick={() => onOpen(f)} className="block max-w-full truncate text-left text-accent-700 hover:underline">{f.file_name}</button>
              <p className="text-xs text-slate-500">
                {new Date(f.created_at).toLocaleDateString()} · {formatBytes(f.size_bytes)}
                {f.events && f.event_id && <> · <Link to={`/club/events/${f.event_id}`} className="hover:underline">{f.events.name}</Link></>}
                {currentLogo === f.storage_path && <span className="ml-1 rounded bg-green-100 px-1 text-green-800">current</span>}
              </p>
            </div>
            <button type="button" onClick={() => onDelete(f)} className="text-xs text-slate-500 hover:text-red-700">Delete</button>
          </li>
        )
      })}
    </ul>
  )
}

function Uploader({ type, onUpload }: { type: ClubFileType; onUpload: (f: File) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [key, setKey] = useState(0)
  const id = `upload-${type}`

  async function submit() {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await onUpload(file)
      setFile(null)
      setKey((k) => k + 1) // reset the file input
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-700">Upload {FILE_RULES[type].label.toLowerCase()}</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input key={key} id={id} type="file" accept={FILE_RULES[type].accept} className={inputClass} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null) }} />
        <Button onClick={() => void submit()} disabled={!file || busy}>{busy ? 'Uploading…' : 'Upload'}</Button>
      </div>
      <p className="mt-1 text-xs text-slate-500">{FILE_RULES[type].hint}</p>
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  )
}
