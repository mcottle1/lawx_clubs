import { useState } from 'react'
import { callAi, useAiStatus } from '../../lib/ai'
import { Alert, Button } from '../ui'
import { AiBadge, AiUsage } from './AiNote'
import CopyList from './CopyList'

/** Template post ideas (always) + optional AI-written ones. */
export default function SocialPosts({ kind, id, templates }: { kind: 'opportunity' | 'recap'; id: string; templates: string[] }) {
  const [ai, refreshAi] = useAiStatus()
  const [aiPosts, setAiPosts] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function write() {
    setBusy(true)
    setError(null)
    try {
      const res = await callAi<{ posts: string[] }>('social_posts', { kind, id })
      setAiPosts(res.posts)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
    refreshAi()
  }

  return (
    <div className="space-y-3">
      <CopyList items={templates} label="Suggested posts" />
      {ai?.enabled && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => void write()} disabled={busy}>{busy ? 'Writing…' : 'Write more with AI'}</Button>
            <AiBadge />
          </div>
          <AiUsage status={ai} kind="draft" />
          {error && <Alert>{error}</Alert>}
          {aiPosts && <CopyList items={aiPosts} label="AI-written posts" />}
        </div>
      )}
    </div>
  )
}
