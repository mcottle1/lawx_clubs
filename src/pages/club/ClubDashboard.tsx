import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { BudgetSummary, ClubEvent, ClubFile, EventReport, MemberCount, ProposalDetail, Receipt, Todo } from '../../lib/types'
import ReceiptsCard from './dashboard/ReceiptsCard'
import { ButtonLink, PageHeader } from '../../components/ui'
import { useClub } from './ClubContext'
import BudgetCard from './dashboard/BudgetCard'
import ClubCalendar from './dashboard/ClubCalendar'
import FilesSummary from './dashboard/FilesSummary'
import MembersCard from './dashboard/MembersCard'
import AttendanceChart from './dashboard/AttendanceChart'
import MembershipChart from './dashboard/MembershipChart'
import PendingApprovals from './dashboard/PendingApprovals'
import TodoList from './dashboard/TodoList'

export default function ClubDashboard() {
  const { club, universityName } = useClub()
  const [budget, setBudget] = useState<BudgetSummary | null>(null)
  const [counts, setCounts] = useState<MemberCount[]>([])
  const [events, setEvents] = useState<ClubEvent[]>([])
  const [reports, setReports] = useState<Map<string, EventReport>>(new Map())
  const [todos, setTodos] = useState<Todo[]>([])
  const [files, setFiles] = useState<ClubFile[]>([])
  const [proposals, setProposals] = useState<ProposalDetail[]>([])
  const [unread, setUnread] = useState(0)
  const [receipts, setReceipts] = useState<(Receipt & { events: { name: string } | null })[]>([])

  const loadCounts = useCallback(async () => {
    const { data } = await supabase.from('club_member_counts').select('*').eq('club_id', club.id).order('recorded_on')
    setCounts((data as MemberCount[]) ?? [])
  }, [club.id])

  const loadTodos = useCallback(async () => {
    const { data } = await supabase.from('todos').select('*').eq('club_id', club.id)
      .order('done').order('due_on', { nullsFirst: false }).order('created_at')
    setTodos((data as Todo[]) ?? [])
  }, [club.id])

  useEffect(() => {
    supabase.from('club_budget_summary').select('*').eq('club_id', club.id).single()
      .then(({ data }) => setBudget(data as BudgetSummary))
    supabase.from('events').select('*').eq('club_id', club.id).order('starts_at')
      .then(({ data }) => setEvents((data as ClubEvent[]) ?? []))
    supabase.from('event_reports').select('*')
      .then(({ data }) => setReports(new Map(((data as EventReport[]) ?? []).map((r) => [r.event_id, r]))))
    supabase.from('club_files').select('*').eq('club_id', club.id)
      .then(({ data }) => setFiles((data as ClubFile[]) ?? []))
    supabase.from('proposal_details').select('*').in('status', ['pending_club', 'pending_admin'])
      .then(({ data }) => setProposals((data as ProposalDetail[]) ?? []))
    supabase.from('conversation_list').select('id', { count: 'exact', head: true }).eq('unread', true)
      .then(({ count }) => setUnread(count ?? 0))
    supabase.from('receipts').select('*, events(name)').eq('club_id', club.id).order('created_at', { ascending: false }).limit(20)
      .then(({ data }) => setReceipts((data as (Receipt & { events: { name: string } | null })[]) ?? []))
    void loadCounts()
    void loadTodos()
  }, [club.id, loadCounts, loadTodos])

  return (
    <>
      <PageHeader title={club.name} subtitle={universityName} actions={<>
        <ButtonLink to="/club/partnerships" variant="secondary">Find sponsors</ButtonLink>
        <ButtonLink to="/club/events/new">New event</ButtonLink>
      </>} />
      {/* Desktop: numbers on top-left, sidebar on the right spanning both rows, calendar + charts below.
          Phone: numbers, then approvals/to-dos, then calendar + charts. Row 1 only takes the numbers' height. */}
      <div className="grid gap-4 lg:grid-cols-3 lg:grid-rows-[auto_1fr]">
        <div className="grid gap-4 self-start sm:grid-cols-2 lg:col-span-2">
          <BudgetCard budget={budget} />
          <MembersCard clubId={club.id} counts={counts} onSaved={() => void loadCounts()} />
        </div>
        <div className="space-y-4 lg:row-span-2">
          <PendingApprovals events={events} proposals={proposals} unread={unread} />
          <TodoList clubId={club.id} todos={todos} onChange={loadTodos} />
          <ReceiptsCard receipts={receipts} />
          <FilesSummary files={files} />
        </div>
        <div className="space-y-4 self-start lg:col-span-2">
          {events.length === 0 && <FirstEvent />}
          <ClubCalendar events={events} reports={reports} />
          <div className="grid gap-4 md:grid-cols-2">
            <AttendanceChart events={events} reports={reports} />
            <MembershipChart counts={counts} />
          </div>
        </div>
      </div>
    </>
  )
}

/** Shown to a brand-new club with no events yet. */
function FirstEvent() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed border-accent-300 bg-accent-50 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="font-bold text-accent-900">Plan your first event</h2>
        <p className="text-sm text-slate-600">Add an event to get it approved, find a sponsor, and start tracking attendance.</p>
      </div>
      <ButtonLink to="/club/events/new" variant="pop">Create an event</ButtonLink>
    </div>
  )
}
