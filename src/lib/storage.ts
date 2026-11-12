import { IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES } from './constants'
import { supabase } from './supabase'

/** Returns an error message, or null if the file is an acceptable image. */
export function validateImage(file: File): string | null {
  if (!IMAGE_MIME_TYPES.includes(file.type)) return 'Please choose a PNG, JPEG, WebP or GIF image.'
  if (file.size > MAX_UPLOAD_BYTES) return 'Images must be 10 MB or smaller.'
  return null
}

/** Uploads to logos/<userId>/… and returns the storage path. */
export async function uploadLogo(userId: string, file: File): Promise<string> {
  const problem = validateImage(file)
  if (problem) throw new Error(problem)
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const path = `${userId}/logo-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('logos').upload(path, file, { contentType: file.type })
  if (error) throw new Error(error.message)
  return path
}

export function logoUrl(path: string | null | undefined): string | null {
  if (!path) return null
  return supabase.storage.from('logos').getPublicUrl(path).data.publicUrl
}
