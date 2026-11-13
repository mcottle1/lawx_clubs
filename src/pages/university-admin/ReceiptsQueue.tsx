import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Modal from '../../components/Modal'
import ReceiptStatusBadge from '../../components/ReceiptStatusBadge'
import { Alert, Button, Card, Field, inputClass, Spinner } from '../../components/ui'
import { usd } from '../../lib/format'
import { notify } from '../../lib/notify'
import { receiptUrl } from '../../lib/receipts'
import { supabase } from '../../lib/supabase'
import type { Receipt, ReceiptStatus } from '../../lib/types'

type Row = Receipt & { clubs: { name: string } | null; events: { name: string; starts_at: string } | null }

const FILTERS: { key: string; label: string; statuses: ReceiptStatus[] }[] = [
  { key: 'todo', label: 'To do', statuses: ['pending', 'approved'] },
  { key: 'reimbursed', label: 'Reimbursed', statuses: ['reimbursed'] },
  { key: 'denied', label: 'Denied', statuses: ['denied'] },
]

/** /university-admin/receipts — pending → approved → reimbursed, or denied with a note. */
export default function ReceiptsQueue() {
  const [filter, setFilter] = useState('todo')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [denying, setDenying] = useState<Row | null>(null)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const statuses = FILTERS.find((f) => f.key === filter)!.statuses
    const { data } = await supabase.from('receipts').select('*, clubs(name), events(name, starts_at)')
      .in('status', statuses).order('created_at')
    const list = (data as Row[]) ?? []
    setRows(list)
    // Signed preview links (10 minutes) for each file.
    const entries = await Promise.all(list.map(async (r) => [r.id, await receiptUrl(r.storage_path)] as const))
    setPreviews(Object.fromEntries(entries.filter(([, u]) => u) as [string, string][]))
  }, [filter])
  useEffect(() => { void load() }, [load])

  async function move(r: Row, status: ReceiptStatus, note?: string) {
    setBusy(r.id)
    const { error } = await supabase.rpc('review_receipt', { p_receipt_id: r.id, p_status: status, p_note: note ?? null })
    setBusy(null)
    if (error) return setMsg({ kind: 'error', text: error.message })
    notify('receipt_reviewed', r.id)
    setMsg({ kind: 'success', text: `${r.clubs?.name}: ${r.file_name} marked ${status}. The club has been notified.` })
    setDenying(null)
    await load()
  }

  if (!rows) return <Spinner />
  const total = rows.reduce((s, r) => s + Number(r.amount), 0)

  return (
    <>
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      <div role="tablist" aria-label="Receipt status" className="mb-4 flex gap-2">
        {FILTERS.map((f) => (
          <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1.5 text-sm ${filter === f.key ? 'bg-accent-600 font-semibold text-white shadow-sm' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-accent-50 hover:ring-accent-200'}`}>
            {f.label}
          </button>
        ))}
      </div>
      <p className="mb-3 text-sm text-slate-600" role="status">{rows.length} receipt{rows.length === 1 ? '' : 's'} · {usd.format(total)}</p>
      {rows.length === 0 ? <Card><p className="text-sm text-slate-500">Nothing here.</p></Card> : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const url = previews[r.id]
            const isImage = r.mime_type?.startsWith('image/') && r.mime_type !== 'image/heic'
            return (
              <li key={r.id}>
                <Card className="flex flex-col gap-4 sm:flex-row">
                  <div className="sm:w-40">
                    {url && isImage ? (
                      <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Receipt ${r.file_name}`} className="max-h-40 w-full rounded border border-slate-200 object-contain" /></a>
                    ) : url ? (
                      <a href={url} target="_blank" rel="noreferrer" className="flex h-24 items-center justify-center rounded border border-slate-200 bg-slate-50 text-sm text-accent-700 hover:underline">Open {r.mime_type === 'application/pdf' ? 'PDF' : 'file'}</a>
                    ) : <span className="text-xs text-slate-500">Preview unavailable</span>}
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-semibold">{usd.format(Number(r.amount))}</span>
                      <ReceiptStatusBadge status={r.status} />
                    </div>
                    <p className="font-medium">{r.clubs?.name}</p>
                    <p className="text-slate-600">{r.events?.name}{r.events && ` · ${new Date(r.events.starts_at).toLocaleDateString()}`}</p>
                    {r.description && <p className="text-slate-600">For: {r.description}</p>}
                    <p className="text-xs text-slate-500">{r.file_name} · submitted {new Date(r.created_at).toLocaleDateString()}</p>
                    {r.admin_note && <p className="mt-1 text-xs text-slate-600">Note: {r.admin_note}</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {r.status === 'pending' && <Button disabled={busy === r.id} onClick={() => void move(r, 'approved')}>Approve</Button>}
                      {r.status === 'approved' && <Button disabled={busy === r.id} onClick={() => void move(r, 'reimbursed')}>Mark reimbursed</Button>}
                      {(r.status === 'pending' || r.status === 'approved') && (
                        <Button variant="danger" disabled={busy === r.id} onClick={() => setDenying(r)}>Deny</Button>
                      )}
                    </div>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
      <Modal open={!!denying} onClose={() => setDenying(null)} title="Deny receipt">
        {denying && <DenyNote busy={busy === denying.id} onSubmit={(note) => void move(denying, 'denied', note)} />}
      </Modal>
    </>
  )
}

function DenyNote({ onSubmit, busy }: { onSubmit: (note: string) => void; busy: boolean }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!note.trim()) return setError('Add a short note so the club knows why.')
    onSubmit(note.trim())
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <Field label="Note to the club" required>
        {(id) => <textarea id={id} rows={3} maxLength={1000} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <Button type="submit" variant="danger" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Deny receipt'}</Button>
    </form>
  )
}
