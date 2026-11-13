import { supabase } from './supabase'

type NotifyType = 'event_submitted' | 'message' | 'proposal_submitted' | 'proposal_responded' | 'reviewed'

/**
 * Asks the `notify` Edge Function to send the email that goes with an action
 * the user just completed. Fire-and-forget: email problems never block the UI
 * (every attempt is recorded in email_log).
 */
export function notify(type: NotifyType, id: string, extra: Record<string, string> = {}): void {
  void supabase.functions.invoke('notify', { body: { type, id, ...extra } }).catch(() => {})
}
