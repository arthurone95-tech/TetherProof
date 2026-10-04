import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from './errors.js';
import { supabaseAdmin } from './supabase.js';

/**
 * Allowed upload types for work proof media.
 *
 * Anything outside this list is rejected before a byte reaches storage, which
 * keeps executable content and arbitrary documents out of the bucket.
 */
const ALLOWED_CONTENT_TYPES = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/heic', 'heic'],
  ['audio/mpeg', 'mp3'],
  ['audio/mp4', 'm4a'],
  ['audio/aac', 'aac'],
  ['audio/webm', 'webm'],
]);

export interface StoredMedia {
  bucket: string;
  path: string;
  sizeBytes: number;
  contentType: string;
}

export function isAllowedMediaType(contentType: string): boolean {
  return ALLOWED_CONTENT_TYPES.has(contentType.toLowerCase());
}

/**
 * Uploads a media proof to a private Supabase Storage bucket.
 *
 * The object path is a random UUID with a vetted extension, so a caller cannot
 * influence the filename or traverse out of the bucket. Buckets stay private;
 * access is granted through short-lived signed URLs.
 */
export async function uploadWorkProofMedia(
  workerId: string,
  file: { buffer: Buffer; contentType: string; size: number },
): Promise<StoredMedia> {
  const contentType = file.contentType.toLowerCase();
  const extension = ALLOWED_CONTENT_TYPES.get(contentType);

  if (!extension) {
    throw AppError.badRequest('That file type is not supported.');
  }

  if (file.size <= 0) {
    throw AppError.badRequest('The uploaded file is empty.');
  }

  if (file.size > env.STORAGE_MAX_UPLOAD_BYTES) {
    throw AppError.badRequest(
      `Files must be smaller than ${Math.floor(env.STORAGE_MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
    );
  }

  const path = `${workerId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;

  const { error } = await supabaseAdmin.storage
    .from(env.STORAGE_PROOFS_BUCKET)
    .upload(path, file.buffer, { contentType, upsert: false });

  if (error) {
    throw AppError.internal('The file could not be stored.');
  }

  return { bucket: env.STORAGE_PROOFS_BUCKET, path, sizeBytes: file.size, contentType };
}

/** Issues a short-lived signed URL for a stored proof. Never public. */
export async function createSignedMediaUrl(
  path: string,
  expiresInSeconds = 300,
): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(env.STORAGE_PROOFS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw AppError.notFound('That file is no longer available.');
  }

  return data.signedUrl;
}
