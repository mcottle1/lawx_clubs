import type { AiStatus } from '../../lib/ai'

/** Small "AI" badge + remaining daily uses. */
export function AiBadge() {
  return <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-800">AI</span>
}

export function AiUsage({ status, kind }: { status: AiStatus; kind: 'search' | 'draft' }) {
  if (!status.used) return null
  const left = Math.max(0, status.limits[kind] - status.used[kind])
  return (
    <p className="text-xs text-slate-500">
      {left} of {status.limits[kind]} AI {kind === 'search' ? 'searches' : 'drafts'} left today for your club. AI can make mistakes — check before you rely on it.
    </p>
  )
}
