import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { notify } from '../../lib/notify'
import { supabase } from '../../lib/supabase'
import type { ConversationListItem, Message } from '../../lib/types'
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
  const other = side === 'club' ? conv.partner_name : `${conv.club_name} (${conv.university_name})`
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
        <form onSubmit={send} className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-end">
          <label htmlFor="reply" className="sr-only">Your message</label>
          <textarea id="reply" rows={2} maxLength={5000} className={inputClass} placeholder="Write a message…" value={body} onChange={(e) => setBody(e.target.value)} />
          <Button type="submit" disabled={busy || !body.trim()}>{busy ? 'Sending…' : 'Send'}</Button>
        </form>
        {error && <Alert className="mt-2">{error}</Alert>}
      </Card>
      <Link to={`/${side}/messages`} className="mt-4 inline-block text-sm text-accent-700 hover:underline">← All messages</Link>
    </>
  )
}
