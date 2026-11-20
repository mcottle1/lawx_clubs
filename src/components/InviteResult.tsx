import { useState } from 'react'
import { Alert, Button, inputClass } from './ui'

export interface InviteResultData { link: string; email_status: 'sent' | 'skipped' | 'failed' }

/** After sending an admin invite: what happened to the email, plus the one-time link. */
export default function InviteResult({ result }: { result: InviteResultData }) {
  const [copied, setCopied] = useState(false)
  return (
    <Alert kind={result.email_status === 'sent' ? 'success' : 'warning'} className="mt-4">
      <p>
        {result.email_status === 'sent' && 'Invite email sent. '}
        {result.email_status === 'skipped' && 'Invite created, but email is not configured (RESEND_API_KEY missing) — share this link yourself. '}
        {result.email_status === 'failed' && 'Invite created, but the email failed to send — share this link yourself. '}
        The link is only shown once:
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input readOnly aria-label="Invite link" className={inputClass + ' font-mono text-xs'} value={result.link} onFocus={(e) => e.target.select()} />
        <Button variant="secondary" onClick={() => { void navigator.clipboard.writeText(result.link); setCopied(true) }}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </Alert>
  )
}
