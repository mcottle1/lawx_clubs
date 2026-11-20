import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { clubWhere } from '../../lib/constants'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { notify } from '../../lib/notify'
import { supabase } from '../../lib/supabase'
import type { ConversationListItem, Message } from '../../lib/types'
import SentBackNotice from '../SentBackNotice'
import { Alert, Button, Card, inputClass, PageHeader, Spinner } from '../ui'

/**
 * One conversation. Polls every 15 s while open (no realtime needed).
 * `actions` renders extra buttons for the side (e.g. "Make a proposal").
 */
export default function Thread({
  side,
  actions,
}: {
  side: 'club' | 'partner'
  actions?: (conv: ConversationListItem) => ReactNode
}) {
  const { id } = useParams()
  const { session } = useAuth()
  const [conv, setConv] = useState<ConversationListItem | null | undefined>(undefined)
  const [messages, setMessages] = useState<Message[]>([])
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const [{ data: c }, { data: m }] = await Promise.all([
      supabase.from('conversation_list').select('*').eq('id', id!).maybeSingle(),
      supabase.from('messages').select('*').eq('conversation_id', id!).order('created_at'),
    ])
    setConv(c as ConversationListItem | null)
    setMessages((m as Message[]) ?? [])
    if (c) void supabase.rpc('mark_conversation_read', { p_conversation_id: id })
  }, [id])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 15000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }) }, [messages.length])

  async function send(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('messages').insert({
      conversation_id: id, sender_user_id: session!.user.id, sender_role: side, body: body.trim(),
    })
    setBusy(false)
    if (error) return setError(error.message)
    setBody('')
    notify('message', id!)
    await load()
  }

  if (conv === undefined) return <Spinner />
  if (conv === null) return <Alert>Conversation not found.</Alert>
  const other = side === 'club' ? conv.partner_name : `${conv.club_name} (${clubWhere(conv.department_name, conv.university_name)})`
  const mailto = side === 'club' ? conv.partner_email : conv.club_email

  return (
    <>
      <PageHeader title={conv.subject} subtitle={<>With {other} · <a className="text-accent-700 hover:underline" href={`mailto:${mailto}`}>{mailto}</a></>} actions={actions?.(conv)} />
      <Card>
        <ol className="space-y-3" aria-label="Messages">
          {messages.map((m) => {
            if (m.sender_role === 'system') {
              return <li key={m.id} className="text-center text-xs text-slate-500">{m.body} · {new Date(m.created_at).toLocaleString()}</li>
            }
            const mine = m.sender_role === side
            return (
              <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${mine ? 'bg-accent-600 text-white' : 'bg-slate-100 text-slate-900'}`}>
                  <p className="whitespace-pre-line break-words">{m.body}</p>
                  <p className={`mt-1 text-xs ${mine ? 'text-accent-100' : 'text-slate-500'}`}>
                    {mine ? 'You' : side === 'club' ? conv.partner_name : conv.club_name} · {new Date(m.created_at).toLocaleString()}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
        <div ref={bottom} />
        {conv.approval_status !== 'approved' ? (
          <ReviewStatus conv={conv} firstMessage={messages[0]?.body ?? ''} onResubmitted={() => void load()} />
        ) : (
        <form onSubmit={send} className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-end">
          <label htmlFor="reply" className="sr-only">Your message</label>
          <textarea id="reply" rows={2} maxLength={5000} className={inputClass} placeholder="Write a message…" value={body} onChange={(e) => setBody(e.target.value)} />
          <Button type="submit" disabled={busy || !body.trim()}>{busy ? 'Sending…' : 'Send'}</Button>
        </form>
        )}
        {error && <Alert className="mt-2">{error}</Alert>}
      </Card>
      <Link to={`/${side}/messages`} className="mt-4 inline-block text-sm text-accent-700 hover:underline">← All messages</Link>
    </>
  )
}

/** Club side of a first message that needs (or failed) university approval. */
function ReviewStatus({ conv, firstMessage, onResubmitted }: { conv: ConversationListItem; firstMessage: string; onResubmitted: () => void }) {
  const [editing, setEditing] = useState(conv.approval_status === 'changes_requested')
  const [subject, setSubject] = useState(conv.subject)
  const [text, setText] = useState(firstMessage)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function resubmit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return setError('Write a message.')
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('resubmit_conversation', { p_conversation_id: conv.id, p_subject: subject.trim(), p_body: text.trim() })
    setBusy(false)
    if (error) return setError(error.message)
    notify('message', conv.id)
    setEditing(false)
    onResubmitted()
  }

  const form = (
    <form onSubmit={resubmit} className="mt-3 space-y-3" noValidate>
      {error && <Alert>{error}</Alert>}
      <div>
        <label htmlFor="resub-subject" className="mb-1 block text-sm font-medium">Subject</label>
        <input id="resub-subject" className={inputClass} maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div>
        <label htmlFor="resub-body" className="mb-1 block text-sm font-medium">Message</label>
        <textarea id="resub-body" rows={6} maxLength={5000} className={inputClass} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Resubmit for approval'}</Button>
        {conv.approval_status === 'pending' && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
      </div>
    </form>
  )

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      {conv.approval_status === 'pending' && (
        <Alert kind="info">
          Waiting for your university to approve this message. {conv.partner_name} gets it once it’s approved, and you’ll get an email.{' '}
          {!editing && <button type="button" className="font-semibold underline" onClick={() => setEditing(true)}>Edit message</button>}
        </Alert>
      )}
      {conv.approval_status === 'changes_requested' && <SentBackNotice note={conv.review_note} />}
      {conv.approval_status === 'denied' && (
        <Alert>Your university didn’t approve this message{conv.review_note ? `: ${conv.review_note}` : '.'} It wasn’t sent to {conv.partner_name}.</Alert>
      )}
      {editing && conv.approval_status !== 'denied' && form}
    </div>
  )
}

