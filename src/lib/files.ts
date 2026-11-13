import { MAX_UPLOAD_BYTES } from './constants'
import { supabase } from './supabase'
import type { ClubFile, ClubFileType } from './types'

type Bucket = ClubFile['bucket']

const IMAGES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const DOCS = [
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

/** Where each kind of club file is stored and which types it accepts (mirrors the bucket limits). */
export const FILE_RULES: Record<ClubFileType, { bucket: Bucket; mimes: string[]; accept: string; label: string; hint: string }> = {
  flyer: { bucket: 'flyers', mimes: [...IMAGES, 'application/pdf'], accept: 'image/*,application/pdf', label: 'Flyers', hint: 'Images or PDF, up to 10 MB.' },
  logo: { bucket: 'logos', mimes: IMAGES, accept: 'image/png,image/jpeg,image/webp,image/gif', label: 'Logo', hint: 'PNG, JPEG, WebP or GIF, up to 10 MB.' },
  constitution: { bucket: 'club-docs', mimes: DOCS, accept: '.pdf,.doc,.docx,.txt,image/*', label: 'Constitution', hint: 'PDF, Word, text or image, up to 10 MB. Private to your club.' },
  other: { bucket: 'club-docs', mimes: DOCS, accept: '.pdf,.doc,.docx,.txt,.csv,image/*', label: 'Other documents', hint: 'PDF, Word, text, CSV or image, up to 10 MB. Private to your club.' },
}

export function validateClubFile(file: File, type: ClubFileType): string | null {
  if (!FILE_RULES[type].mimes.includes(file.type)) return `That file type isn't allowed here. ${FILE_RULES[type].hint}`
  if (file.size > MAX_UPLOAD_BYTES) return 'Files must be 10 MB or smaller.'
  return null
}

function safeName(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(-80)
  return cleaned || 'file'
}

/**
 * Uploads a club file to storage and records it in club_files.
 * Logos also become the club's current logo.
 */
export async function uploadClubFile(opts: {
  clubId: string
  userId: string
  file: File
  type: ClubFileType
  eventId?: string | null
}): Promise<ClubFile> {
  const { clubId, userId, file, type, eventId } = opts
  const problem = validateClubFile(file, type)
  if (problem) throw new Error(problem)
  const { bucket } = FILE_RULES[type]
  const path = `${userId}/${type}-${Date.now()}-${safeName(file.name)}`
  const up = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type })
  if (up.error) throw new Error(up.error.message)
  const { data, error } = await supabase.from('club_files').insert({
    club_id: clubId, file_type: type, bucket, storage_path: path, file_name: file.name,
    mime_type: file.type, size_bytes: file.size, event_id: eventId ?? null,
  }).select().single()
  if (error) {
    await supabase.storage.from(bucket).remove([path])
    throw new Error(error.message)
  }
  if (type === 'logo') await supabase.from('clubs').update({ logo_path: path }).eq('id', clubId)
  return data as ClubFile
}

/** Public URL for public buckets; short-lived signed URL for private club docs. */
export async function fileUrl(bucket: Bucket, path: string): Promise<string | null> {
  if (bucket === 'club-docs') {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 10)
    return data?.signedUrl ?? null
  }
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
}

export function publicUrl(bucket: 'logos' | 'flyers', path: string | null | undefined): string | null {
  return path ? supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl : null
}

export async function deleteClubFile(file: ClubFile): Promise<void> {
  const { error } = await supabase.from('club_files').delete().eq('id', file.id)
  if (error) throw new Error(error.message)
  await supabase.storage.from(file.bucket).remove([file.storage_path])
  // Clear references to the removed file. (Past events can't be edited, so
  // their flyer link simply stops resolving; that's acceptable.)
  if (file.file_type === 'logo') {
    await supabase.from('clubs').update({ logo_path: null }).eq('id', file.club_id).eq('logo_path', file.storage_path)
  }
  if (file.file_type === 'flyer' && file.event_id) {
    await supabase.from('events').update({ flyer_path: null }).eq('id', file.event_id).eq('flyer_path', file.storage_path)
  }
}
