import { useEffect, useState } from 'react'
import { callFunction } from './supabase'

export interface AiStatus {
  enabled: boolean
  model: string | null
  limits: { search: number; draft: number }
  used: { search: number; draft: number } | null
}

let cached: Promise<AiStatus | null> | null = null

/** Asks the `ai` function whether optional AI is turned on (once per page load). */
export function fetchAiStatus(force = false): Promise<AiStatus | null> {
  if (!cached || force) {
    cached = callFunction<AiStatus>('ai', { action: 'status' }).catch(() => null) // not deployed → off
  }
  return cached
}

/** null while loading; `enabled: false` when AI isn't configured. */
export function useAiStatus(): [AiStatus | null, () => void] {
  const [status, setStatus] = useState<AiStatus | null>(null)
  useEffect(() => { void fetchAiStatus().then((s) => setStatus(s ?? { enabled: false, model: null, limits: { search: 0, draft: 0 }, used: null })) }, [])
  const refresh = () => { void fetchAiStatus(true).then((s) => s && setStatus(s)) }
  return [status, refresh]
}

export function callAi<T>(action: 'find_partners' | 'draft_opportunity' | 'social_posts', body: Record<string, unknown>): Promise<T> {
  return callFunction<T>('ai', { action, ...body })
}
