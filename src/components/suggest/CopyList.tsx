import { useState } from 'react'
import { Button } from '../ui'

/** A list of ready-to-paste texts, each with a Copy button. */
export default function CopyList({ items, label }: { items: string[]; label: string }) {
  const [copied, setCopied] = useState<number | null>(null)
  return (
    <ul className="space-y-2" aria-label={label}>
      {items.map((t, i) => (
        <li key={i} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="whitespace-pre-line break-words">{t}</p>
          <Button variant="secondary" className="mt-2 px-2 py-1 text-xs" onClick={() => { void navigator.clipboard.writeText(t); setCopied(i) }}>
            {copied === i ? 'Copied' : 'Copy'}
          </Button>
        </li>
      ))}
    </ul>
  )
}
