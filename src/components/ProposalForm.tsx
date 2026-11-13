import { useState, type FormEvent } from 'react'
import { notify } from '../lib/notify'
import { supabase } from '../lib/supabase'
import { Alert, Button, Field, inputClass } from './ui'

/** Partner's response form: what they're willing to provide. */
export default function ProposalForm({
  opportunityId,
  conversationId,
  onDone,
}: {
  opportunityId?: string
  conversationId?: string
  onDone: (proposalId: string) => void
}) {
  const [f, setF] = useState({ headcount: '', amount: '', in_kind: '', student_offer: '', pitch_minutes: '', message: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const num = (v: string) => (v.trim() === '' ? null : Number(v))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const headcount = num(f.headcount), amount = num(f.amount), pitch = num(f.pitch_minutes)
    if ([headcount, amount, pitch].some((n) => n !== null && (!Number.isFinite(n) || n < 0))) return setError('Numbers must be 0 or more.')
    if (!(headcount && headcount > 0) && !(amount && amount > 0) && !f.in_kind.trim() && !f.student_offer.trim()) {
      return setError('Offer at least one thing: lunches/headcount, funding, in-kind support, or a student offer.')
    }
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.rpc('submit_proposal', {
      p_opportunity_id: opportunityId ?? null,
      p_conversation_id: conversationId ?? null,
      p_headcount: headcount, p_amount: amount, p_in_kind: f.in_kind, p_student_offer: f.student_offer,
      p_pitch_minutes: pitch, p_message: f.message,
    })
    setBusy(false)
    if (error) return setError(error.message)
    notify('proposal_submitted', data as string)
    onDone(data as string)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Lunches / headcount covered">
          {(id) => <input id={id} type="number" min={0} step={1} inputMode="numeric" className={inputClass} value={f.headcount} onChange={set('headcount')} />}
        </Field>
        <Field label="Funding (USD)">
          {(id) => <input id={id} type="number" min={0} step="0.01" inputMode="decimal" className={inputClass} value={f.amount} onChange={set('amount')} />}
        </Field>
        <Field label="Minutes to present">
          {(id) => <input id={id} type="number" min={0} max={240} step={1} inputMode="numeric" className={inputClass} value={f.pitch_minutes} onChange={set('pitch_minutes')} />}
        </Field>
      </div>
      <Field label="In-kind support" hint="e.g. study guides, swag, prizes.">
        {(id) => <input id={id} className={inputClass} maxLength={1000} value={f.in_kind} onChange={set('in_kind')} />}
      </Field>
      <Field label="Offer for students" hint="e.g. a discount code or free trial.">
        {(id) => <input id={id} className={inputClass} maxLength={1000} value={f.student_offer} onChange={set('student_offer')} />}
      </Field>
      <Field label="Message to the club">
        {(id) => <textarea id={id} rows={3} maxLength={5000} className={inputClass} value={f.message} onChange={set('message')} />}
      </Field>
      <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send proposal'}</Button>
    </form>
  )
}
