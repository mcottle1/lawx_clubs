import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatDay } from '../../../lib/format'
import { supabase } from '../../../lib/supabase'
import type { ClubMember, MemberCount, MemberEmail } from '../../../lib/types'
import Modal from '../../../components/Modal'
import { Alert, Button, Card, inputClass, PageHeader, Spinner } from '../../../components/ui'
import { useClub } from '../ClubContext'
import EmailComposer from './EmailComposer'
import ImportRoster from './ImportRoster'
import MemberForm from './MemberForm'

type Dialog = { kind: 'add' } | { kind: 'edit'; member: ClubMember } | { kind: 'import' } | { kind: 'email' } | null

const STATUS_STYLE: Record<MemberEmail['status'], string> = {
  sent: 'bg-fresh-50 text-fresh-700',
  partial: 'bg-amber-50 text-amber-800',
  failed: 'bg-red-50 text-red-700',
  skipped: 'bg-slate-100 text-slate-600',
}
const STATUS_LABEL: Record<MemberEmail['status'], string> = {
  sent: 'Sent', partial: 'Partly sent', failed: 'Failed', skipped: 'Not sent',
}

export default function Members() {
  const { club, userId } = useClub()
  const [members, setMembers] = useState<ClubMember[] | null>(null)
  const [latestCount, setLatestCount] = useState<MemberCount | null>(null)
  const [emails, setEmails] = useState<MemberEmail[]>([])
  const [dialog, setDialog] = useState<Dialog>(null)
  const [query, setQuery] = useState('')
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    const [m, c, e] = await Promise.all([
      supabase.from('club_members').select('*').eq('club_id', club.id).order('name'),
      supabase.from('club_member_counts').select('*').eq('club_id', club.id)
        .order('recorded_on', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('member_emails').select('*').eq('club_id', club.id).order('created_at', { ascending: false }).limit(10),
    ])
    setMembers((m.data as ClubMember[]) ?? [])
    setLatestCount((c.data as MemberCount | null) ?? null)
    setEmails((e.data as MemberEmail[]) ?? [])
  }, [club.id])
  useEffect(() => { void load() }, [load])

  const leaders = useMemo(
    () => (members ?? []).filter((m) => m.role).sort((a, b) => a.role!.localeCompare(b.role!) || a.name.localeCompare(b.name)),
    [members],
  )
  const roles = useMemo(() => [...new Set(leaders.map((m) => m.role!))].sort(), [leaders])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return members ?? []
    return (members ?? []).filter((m) => [m.name, m.email, m.role ?? ''].some((v) => v.toLowerCase().includes(q)))
  }, [members, query])

  function done(text: string) {
    setDialog(null)
    setMsg({ kind: 'success', text })
    void load()
  }

  async function remove(m: ClubMember) {
    if (!confirm(`Remove ${m.name} from your member list?`)) return
    const { error } = await supabase.from('club_members').delete().eq('id', m.id)
    if (error) return setMsg({ kind: 'error', text: error.message })
    setMsg({ kind: 'success', text: `Removed ${m.name}.` })
    void load()
  }

  async function followMemberList() {
    const { error } = await supabase.rpc('use_member_list_for_count')
    if (error) return setMsg({ kind: 'error', text: error.message })
    setMsg({ kind: 'success', text: 'Your dashboard member count now follows this list.' })
    void load()
  }

  if (!members) return <Spinner />

  const countFollowsList = latestCount?.source === 'members' || latestCount === null
  const showCountNotice = members.length > 0 && latestCount !== null && latestCount.source !== 'members'

  return (
    <>
      <PageHeader
        title="Members"
        subtitle={members.length
          ? `${members.length} member${members.length === 1 ? '' : 's'} · ${leaders.length} in leadership`
          : 'Keep your roster here: names, emails and leadership roles.'}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog({ kind: 'import' })}>Import roster</Button>
            <Button variant="secondary" onClick={() => setDialog({ kind: 'add' })}>Add member</Button>
            <Button variant="pop" onClick={() => setDialog({ kind: 'email' })} disabled={members.length === 0}>Email members</Button>
          </>
        }
      />
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      {showCountNotice && (
        <Alert kind="info" className="mb-4">
          Your dashboard shows {latestCount.count} members (entered {formatDay(latestCount.recorded_on)}); this list has {members.length}.{' '}
          <button type="button" className="font-semibold underline" onClick={() => void followMemberList()}>
            Use this list for the dashboard count
          </button>
        </Alert>
      )}

      {members.length === 0 ? (
        <Card className="text-center">
          <h2 className="font-semibold text-accent-900">No members yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
            Upload your roster as a CSV with each member’s name and email, or add members one at a time.
            Then you can mark your leadership team and email everyone from here.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button onClick={() => setDialog({ kind: 'import' })}>Import roster CSV</Button>
            <Button variant="secondary" onClick={() => setDialog({ kind: 'add' })}>Add a member</Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-1">
            <section aria-labelledby="leaders-h">
              <Card>
                <h2 id="leaders-h" className="font-semibold text-accent-900">Leadership</h2>
                {leaders.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">
                    No leadership roles yet. Choose <strong>Edit</strong> next to a member to give them a role like “President”.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-slate-100">
                    {leaders.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide text-pop-700">{m.role}</p>
                          <p className="truncate text-sm font-medium">{m.name}</p>
                          <p className="truncate text-xs text-slate-500">{m.email}</p>
                        </div>
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setDialog({ kind: 'edit', member: m })} aria-label={`Edit ${m.name}`}>
                          Edit
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>
            <EmailHistory emails={emails} />
          </div>

          <section aria-labelledby="all-h" className="lg:col-span-2">
            <Card>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 id="all-h" className="font-semibold text-accent-900">All members</h2>
                <input
                  type="search"
                  aria-label="Search members"
                  placeholder="Search name, email or role"
                  className={`${inputClass} sm:max-w-xs`}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {filtered.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">No members match “{query}”.</p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100">
                  {filtered.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {m.name}
                          {m.role && (
                            <span className="ml-2 rounded-full bg-pop-50 px-2 py-0.5 text-xs font-semibold text-pop-700">{m.role}</span>
                          )}
                        </p>
                        <p className="truncate text-xs text-slate-500">{m.email} · joined {formatDay(m.joined_on)}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setDialog({ kind: 'edit', member: m })} aria-label={`Edit ${m.name}`}>
                          Edit
                        </Button>
                        <Button variant="ghost" className="px-2 py-1 text-xs text-red-700 hover:bg-red-50" onClick={() => void remove(m)} aria-label={`Remove ${m.name}`}>
                          Remove
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>
      )}

      <Modal open={dialog?.kind === 'add' || dialog?.kind === 'edit'} onClose={() => setDialog(null)} title={dialog?.kind === 'edit' ? 'Edit member' : 'Add member'}>
        {(dialog?.kind === 'add' || dialog?.kind === 'edit') && (
          <MemberForm
            key={dialog.kind === 'edit' ? dialog.member.id : 'new'}
            clubId={club.id}
            member={dialog.kind === 'edit' ? dialog.member : undefined}
            roles={roles}
            onDone={done}
          />
        )}
      </Modal>
      <Modal open={dialog?.kind === 'import'} onClose={() => setDialog(null)} title="Import roster">
        <ImportRoster clubId={club.id} members={members} countFollowsList={countFollowsList} onDone={done} />
      </Modal>
      <Modal open={dialog?.kind === 'email'} onClose={() => setDialog(null)} title="Email members" size="lg">
        <EmailComposer
          clubId={club.id}
          clubEmail={club.email}
          userId={userId}
          memberCount={members.length}
          leaderCount={leaders.length}
          onSent={done}
        />
      </Modal>
    </>
  )
}

function EmailHistory({ emails }: { emails: MemberEmail[] }) {
  return (
    <section aria-labelledby="emails-h">
      <Card>
        <h2 id="emails-h" className="font-semibold text-accent-900">Sent emails</h2>
        {emails.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">Emails you send to members will be listed here.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {emails.map((e) => (
              <li key={e.id} className="py-2">
                <details>
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium">{e.subject}</p>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[e.status]}`}>{STATUS_LABEL[e.status]}</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {new Date(e.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
                      {e.audience === 'leadership' ? 'Leadership' : 'All members'} · {e.delivered_count} of {e.recipient_count} delivered
                    </p>
                  </summary>
                  <div className="mt-2 rounded-md bg-slate-50 p-2 text-xs text-slate-700">
                    <p className="whitespace-pre-wrap">{e.body.length > 600 ? `${e.body.slice(0, 600)}…` : e.body}</p>
                    {e.attachment_names.length > 0 && <p className="mt-2 text-slate-500">Attachments: {e.attachment_names.join(', ')}</p>}
                    {e.error && <p className="mt-2 text-slate-500">{e.error}</p>}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  )
}
