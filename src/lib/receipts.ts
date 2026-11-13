import { MAX_UPLOAD_BYTES } from './constants'
import { supabase } from './supabase'
import type { Receipt } from './types'

export const RECEIPT_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf']
export const RECEIPT_ACCEPT = 'image/png,image/jpeg,image/webp,image/heic,application/pdf'

export function validateReceipt(file: File): string | null {
  if (!RECEIPT_MIMES.includes(file.type)) return `${file.name}: receipts must be a photo (PNG, JPEG, WebP, HEIC) or PDF.`
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name}: files must be 10 MB or smaller.`
  return null
}

/** Uploads a receipt to the private bucket and records it. */
export async function addReceipt(opts: {
  userId: string; clubId: string; eventId: string; reportId: string; file: File; amount: number; description?: string
}): Promise<Receipt> {
  const problem = validateReceipt(opts.file)
  if (problem) throw new Error(problem)
  const safe = opts.file.name.normalize('NFKD').replace(/[^\w.-]+/g, '-').slice(-80) || 'receipt'
  const path = `${opts.userId}/receipt-${Date.now()}-${safe}`
  const up = await supabase.storage.from('receipts').upload(path, opts.file, { contentType: opts.file.type })
  if (up.error) throw new Error(up.error.message)
  const { data, error } = await supabase.from('receipts').insert({
    club_id: opts.clubId, event_id: opts.eventId, event_report_id: opts.reportId, storage_path: path,
    file_name: opts.file.name, mime_type: opts.file.type, size_bytes: opts.file.size,
    amount: opts.amount, description: opts.description?.trim() || null,
  }).select().single()
  if (error) {
    await supabase.storage.from('receipts').remove([path])
    throw new Error(error.message)
  }
  return data as Receipt
}

export async function receiptUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('receipts').createSignedUrl(path, 60 * 10)
  return data?.signedUrl ?? null
}
