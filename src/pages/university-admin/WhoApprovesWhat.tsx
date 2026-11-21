import { useState } from 'react'
import { Alert, Card } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { PART_COLUMN, PART_LABEL, useApprovalParts, type ApprovalPart, type CollegeAdmin } from './useApprovalParts'

const PARTS: ApprovalPart[] = ['event', 'flyer', 'partnership', 'receipts']

/**
 * Which college admin signs which part of a request. An event is approved once
 * every part it needs is signed. Changes save right away.
 */
export default function WhoApprovesWhat({ departmentId }: { departmentId: string }) {
  const { admins, loaded } = useApprovalParts()
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  // Local copy so checkboxes respond instantly; reverted if saving fails.
  const [edits, setEdits] = useState<Record<string, CollegeAdmin>>({})
  const mine = admins.filter((a) => a.department_id === departmentId).map((a) => edits[a.user_id] ?? a)

  async function toggle(a: CollegeAdmin, part: ApprovalPart, value: boolean) {
    const next = { ...a, [PART_COLUMN[part]]: value }
    setEdits((e) => ({ ...e, [a.user_id]: next }))
    const { error } = await supabase.rpc('set_admin_parts', {
      p_user_id: a.user_id, p_events: next.can_approve_events, p_flyers: next.can_approve_flyers,
      p_partnerships: next.can_approve_partnerships, p_receipts: next.can_review_receipts,
    })
    if (error) setEdits((e) => ({ ...e, [a.user_id]: a }))
    setMsg(error ? { kind: 'error', text: error.message } : { kind: 'success', text: `Saved: ${a.email} ${value ? 'now approves' : 'no longer approves'} ${PART_LABEL[part].toLowerCase()}.` })
  }

  if (!loaded) return null
  return (
    <Card className="mt-4">
      <h2 className="font-medium">Who approves what</h2>
      <p className="mt-1 text-sm text-slate-600">
        A request can need several sign-offs: the event’s details, its flyer and any partnership. It’s approved once each one is signed,
        by the same person or different people. <strong>Partnership</strong> also covers opportunity posts and first messages to partners.
        If nobody is checked for something, any admin can sign it.
      </p>
      {msg && <Alert kind={msg.kind} className="mt-3">{msg.text}</Alert>}
      <div className="-mx-5 mt-3 overflow-x-auto px-5">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="py-2 pr-4 font-medium">Admin</th>
              {PARTS.map((p) => <th key={p} scope="col" className="px-2 py-2 text-center font-medium">{PART_LABEL[p]}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {mine.map((a) => (
              <tr key={a.user_id}>
                <td className="max-w-[14rem] truncate py-2 pr-4">{a.email}</td>
                {PARTS.map((p) => (
                  <td key={p} className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent-600"
                      aria-label={`${a.email} approves ${PART_LABEL[p].toLowerCase()}`}
                      checked={a[PART_COLUMN[p]]}
                      onChange={(e) => void toggle(a, p, e.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
