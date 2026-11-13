import type { ReceiptStatus } from '../lib/types'

const META: Record<ReceiptStatus, [string, string]> = {
  pending: ['Pending review', 'bg-amber-100 text-amber-900'],
  approved: ['Approved', 'bg-accent-100 text-accent-700'],
  reimbursed: ['Reimbursed', 'bg-green-100 text-green-800'],
  denied: ['Denied', 'bg-red-100 text-red-800'],
}

export default function ReceiptStatusBadge({ status }: { status: ReceiptStatus }) {
  const [label, cls] = META[status]
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
}
