import type { ApprovalStatus } from '../lib/types'

const styles: Record<ApprovalStatus, string> = {
  pending: 'bg-amber-100 text-amber-900',
  approved: 'bg-green-100 text-green-800',
  denied: 'bg-red-100 text-red-800',
}
const labels: Record<ApprovalStatus, string> = { pending: 'Pending approval', approved: 'Approved', denied: 'Denied' }

export default function StatusBadge({ status }: { status: ApprovalStatus }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>{labels[status]}</span>
}
