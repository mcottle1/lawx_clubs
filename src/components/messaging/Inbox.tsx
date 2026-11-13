import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { logoUrl } from '../../lib/storage'
import { supabase } from '../../lib/supabase'
import type { ConversationListItem } from '../../lib/types'
import { Card, PageHeader, Spinner } from '../ui'

/** Conversation list for clubs (/club/messages) and partners (/partner/messages). */
export default function Inbox({ side }: { side: 'club' | 'partner' }) {
  const [items, setItems] = useState<ConversationListItem[] | null>(null)
  useEffect(() => {
    supabase.from('conversation_list').select('*').order('last_message_at', { ascending: false })
      .then(({ data }) => setItems((data as ConversationListItem[]) ?? []))
  }, [])
  if (!items) return <Spinner />
  return (
    <>
      <PageHeader title="Messages" subtitle={side === 'club' ? 'Conversations with partners and sponsors.' : 'Conversations with clubs.'} />
      <Card className="p-0">
        {items.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">
            No conversations yet. {side === 'club' ? 'Reach out to a partner from the Partnerships page.' : 'Clubs that reach out to you will appear here.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((c) => {
              const name = side === 'club' ? c.partner_name : `${c.club_name} · ${c.university_name}`
              const logo = logoUrl(side === 'club' ? c.partner_logo_path : c.club_logo_path)
              return (
                <li key={c.id}>
                  <Link to={`/${side}/messages/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    {logo ? <img src={logo} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                      : <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 font-medium text-slate-500">{name[0]}</span>}
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm">
                        <span className={c.unread ? 'font-semibold' : 'font-medium'}>{name}</span>
                        {c.unread && <span className="rounded-full bg-accent-600 px-1.5 text-xs text-white">New</span>}
                      </p>
                      <p className="truncate text-sm text-slate-700">{c.subject}</p>
                      <p className="truncate text-xs text-slate-500">{c.last_message}</p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-500">{new Date(c.last_message_at).toLocaleDateString()}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}
