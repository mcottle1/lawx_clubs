import { Link } from 'react-router-dom'
import ReceiptStatusBadge from '../../../components/ReceiptStatusBadge'
import { Card } from '../../../components/ui'
import { usd } from '../../../lib/format'
import type { Receipt } from '../../../lib/types'

/** Reimbursement status of the club's receipts (hidden until there are any). */
export default function ReceiptsCard({ receipts }: { receipts: (Receipt & { events: { name: string } | null })[] }) {
  if (receipts.length === 0) return null
  const open = receipts.filter((r) => r.status === 'pending' || r.status === 'approved')
  const owed = open.reduce((sum, r) => sum + Number(r.amount), 0)
  return (
    <Card>
      <h2 className="font-medium">Receipts</h2>
      <p className="text-xs text-slate-500">{open.length ? `${usd.format(owed)} waiting to be reimbursed` : 'All receipts processed'}</p>
      <ul className="mt-2 divide-y divide-slate-100 text-sm">
        {receipts.slice(0, 6).map((r) => (
          <li key={r.id} className="py-2">
            <div className="flex items-center justify-between gap-2">
              <Link to={`/club/events/${r.event_id}/report`} className="truncate hover:underline">{r.events?.name ?? r.file_name}</Link>
              <span className="shrink-0">{usd.format(Number(r.amount))}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2"><ReceiptStatusBadge status={r.status} />{r.admin_note && <span className="text-xs text-slate-600">{r.admin_note}</span>}</div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
