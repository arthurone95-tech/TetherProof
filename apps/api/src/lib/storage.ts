import { randomUUID } from 'node:crypto';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { AppError } from './errors.js';
import { scrubAudio, scrubImage } from './media-scrub.js';
import { supabaseAdmin } from './supabase.js';

/**
 * Allowed upload types for work proof media, mapped to the extension the stored
 * object is given.
 *
 * Anything outside this list is rejected before a byte reaches storage, which
 * keeps executable content and arbitrary documents out of the bucket. Every type
 * listed here must also be scrubbable by `media-scrub.ts`; a type that cannot be
 * stripped of location metadata does not belong in this map, because it would be
 * stored under a promise of privacy that the code cannot keep.
 *
 * WebM was removed for exactly that reason. Its metadata lives in an EBML
 * element that cannot be cut out without re-muxing the whole container, which
 * would need an external binary such as ffmpeg. Rather than store WebM audio
 * with its location data intact, the format is not accepted.
 */
const ALLOWED_CONTENT_TYPES = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/heic', 'heic'],
  ['audio/mpeg', 'mp3'],
  ['audio/mp4', 'm4a'],
  ['audio/aac', 'aac'],
]);

export interface StoredMedia {
  bucket: string;
  path: string;
  sizeBytes: number;
  contentType: string;
  /** What the scrubber removed, retained for the audit trail on the proof row. */
  scrubbed: {
    hadGps: boolean;
    hadMetadata: boolean;
    hadAudioTags: boolean;
  };
}

export function isAllowedMediaType(contentType: string): boolean {
  return ALLOWED_CONTENT_TYPES.has(contentType.toLowerCase());
}

/**
 * Stores a proof media file, scrubbed of metadata.
 *
 * Scrubbing is not offered as a separate step a caller could forget. It happens
 * inside this function so that the only way to reach the bucket is through it,
 * which is what makes the guarantee in doc/08 true of the system rather than of
 * one code path.
 *
 * The declared content type is never trusted on its own: it selects the scrubber
 * and the stored extension, and each scrubber confirms the bytes really are the
 * container that type claims, so a file cannot be smuggled past the allow-list by
 * mislabelling itself.
 *
 * The object path is a random UUID with a vetted extension, so a caller cannot
 * influence the filename or traverse out of the bucket. Buckets stay private;
 * access is granted through short-lived signed URLs.
 */
export async function uploadWorkProofMedia(
  workerId: string,
  file: { buffer: Buffer; contentType: string; size: number },
): Promise<StoredMedia> {
  const declaredType = file.contentType.toLowerCase();
  const extension = ALLOWED_CONTENT_TYPES.get(declaredType);

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

  const scrubbed =
    declaredType.startsWith('image/')
      ? await scrubImage(file.buffer, declaredType)
      : scrubAudio(file.buffer, declaredType);

  if (scrubbed.buffer.length === 0) {
    throw AppError.badRequest('That file could not be read.');
  }

  const path = `${workerId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;

  const { error } = await supabaseAdmin.storage
    .from(env.STORAGE_PROOFS_BUCKET)
    .upload(path, scrubbed.buffer, {
      contentType: scrubbed.contentType,
      // Uploads are one-shot. Without this an object could be replaced in place,
      // which would let a stored proof be swapped after the fact.
      upsert: false,
    });

  if (error) {
    // The provider's reason goes to the log, never to the caller. Storage errors
    // can quote the bucket name, the object key, and the internal reason a bucket
    // refused, none of which belongs in a response body. Logging it here is what
    // made a privilege bug on the shared admin client diagnosable at all.
    logger.error('Proof media upload failed', {
      workerId,
      bucket: env.STORAGE_PROOFS_BUCKET,
      path,
      contentType: scrubbed.contentType,
      sizeBytes: scrubbed.buffer.length,
      reason: error.message,
      status: error.status,
    });
    throw AppError.internal('The file could not be stored.');
  }

  return {
    bucket: env.STORAGE_PROOFS_BUCKET,
    path,
    sizeBytes: scrubbed.buffer.length,
    contentType: scrubbed.contentType,
    scrubbed: {
      hadGps: scrubbed.hadGps,
      hadMetadata: scrubbed.hadMetadata,
      hadAudioTags: scrubbed.hadAudioTags,
    },
  };
}

/**
 * Removes a stored proof object.
 *
 * Used to undo an upload whose database write failed, so a failed submission
 * leaves no orphan behind. The caller swallows failures, because this runs on an
 * error path where the original failure is the one worth reporting.
 */
export async function deleteWorkProofMedia(path: string): Promise<void> {
  await supabaseAdmin.storage.from(env.STORAGE_PROOFS_BUCKET).remove([path]);
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
