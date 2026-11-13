import type { ProposalStatus } from '../lib/types'

const META: Record<ProposalStatus, [string, string]> = {
  pending_club: ['Waiting on club', 'bg-amber-100 text-amber-900'],
  pending_admin: ['Waiting on university', 'bg-amber-100 text-amber-900'],
  approved: ['Approved', 'bg-green-100 text-green-800'],
  declined: ['Declined by club', 'bg-slate-200 text-slate-700'],
  denied: ['Not approved', 'bg-red-100 text-red-800'],
  withdrawn: ['Withdrawn', 'bg-slate-200 text-slate-700'],
}

export default function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  const [label, cls] = META[status]
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
}
