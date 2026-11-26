import { getSupabase } from './supabase/client';
export async function uploadImage(file: File, userId: string) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)
    throw new Error('Choose a JPG, PNG, or WebP image smaller than 5 MB.');
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const db = getSupabase();
  const { error } = await db.storage
    .from('campus-images')
    .upload(path, file, { contentType: file.type });
  if (error) throw error;
  return db.storage.from('campus-images').getPublicUrl(path).data.publicUrl;
}
