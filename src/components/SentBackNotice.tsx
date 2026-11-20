import type { ReactNode } from 'react'

/** Shown to a requester whose submission the university sent back with a note. */
export default function SentBackNotice({ note, children }: { note: string | null; children?: ReactNode }) {
  return (
    <div role="status" className="rounded-lg border border-pop-200 bg-pop-50 px-3 py-2 text-sm text-slate-800">
      <p className="font-semibold text-pop-700">Your university sent this back for changes</p>
      {note && <p className="mt-1 whitespace-pre-line">“{note}”</p>}
      {children && <div className="mt-2 flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}
