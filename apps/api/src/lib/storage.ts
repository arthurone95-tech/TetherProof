import { randomUUID } from 'node:crypto';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { AppError } from './errors.js';
import { assessEvidenceIntegrity, evidenceRejectionError, type EvidenceOutcome } from './media-integrity.js';
import {
  assessDeclaredProvenance,
  readDeclaredProvenance,
  type ProvenanceAssessment,
} from './media-provenance.js';
import { scrubAudio, scrubImage, type MediaSignals } from './media-scrub.js';
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
  /**
   * Provenance findings, derived from the metadata that was just discarded.
   * Booleans only; no identifying value leaves the scrubber.
   */
  signals: MediaSignals;
  /**
   * Whether the file may stand as evidence.
   *
   * Only `rejected` ever stopped an upload; `needs_review` is stored and left for
   * the trust engine, because a contradictory clock is a reason to look again, not
   * a reason to refuse a worker's evidence.
   */
  integrity: EvidenceOutcome;
  /**
   * What the file declared about its own origin.
   *
   * Never a rejection reason. `declared_synthetic` means the file says it came
   * from a generative model, which is a reason for a human to look and not a
   * reason to refuse; `none` is the ordinary case and carries no information in
   * either direction.
   */
  provenance: ProvenanceAssessment;
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
  file: { buffer: Buffer; contentType: string; size: number; submittedAt?: Date },
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
      ? await scrubImage(file.buffer, declaredType, file.submittedAt)
      : scrubAudio(file.buffer, declaredType);

  if (scrubbed.buffer.length === 0) {
    throw AppError.badRequest('That file could not be read.');
  }

  // The one place an upload is allowed to be refused on integrity grounds, so the
  // rule cannot be bypassed by reaching the bucket another way. See
  // `media-integrity.ts` for what this does and, more importantly, does not claim.
  const integrity = assessEvidenceIntegrity({
    signals: scrubbed.signals,
    contentType: scrubbed.contentType,
  });

  if (integrity.outcome === 'rejected') {
    logger.warn('Proof media refused on integrity grounds', {
      workerId,
      contentType: declaredType,
      findings: integrity.findings,
    });
    throw evidenceRejectionError();
  }

  // Declared provenance is read from the bytes before the scrubbed copy replaces
  // them, because scrubbing is exactly what destroys the manifest.
  //
  // It can never reject. A file that declares itself generated is kept and marked
  // for review; a file that declares nothing is ordinary. See `media-provenance.ts`
  // for the benchmark evidence on why no probabilistic detector is consulted here.
  const provenance = assessDeclaredProvenance(
    readDeclaredProvenance(file.buffer, declaredType),
  );

  if (provenance.warrantsReview) {
    logger.info('Proof media declares generated provenance; kept for review', {
      workerId,
      contentType: declaredType,
      declaredSourceType: provenance.declaredSourceType,
    });
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
    signals: scrubbed.signals,
    integrity: integrity.outcome,
    provenance,
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

/**
 * The kind of media a stored proof object holds, read from its vetted extension.
 *
 * The extension is safe to trust here because it was assigned by the upload path
 * from the allow-list, never taken from a caller. Anything not recognised as audio
 * reads as an image, which is the long-standing default and the safer of the two:
 * a legacy or unrecognised object is rendered as a picture rather than offered as
 * a recording that would not play.
 *
 * Shared rather than duplicated, because the verification summary and the
 * worker's own logbook both answer "what kind of file is this", and two answers
 * that can disagree would be a bug waiting for the day a format is added.
 */
export function mediaKindFromPath(path: string | null): 'image' | 'audio' {
  const extension = path?.split('.').pop()?.toLowerCase() ?? '';
  return ['mp3', 'm4a', 'aac'].includes(extension) ? 'audio' : 'image';
}

/**
 * Issues a short-lived signed URL for a stored proof. Never public.
 *
 * Five minutes is the window a recipient has to look at the photograph on the
 * verification page, and it is deliberately short: the URL is a bearer capability,
 * so the time it works is the time a forwarded screenshot of it is useful. Both
 * the worker's own logbook and the recipient's summary call this, so a page left
 * open past the expiry re-mints rather than showing a broken image.
 */
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

/**
 * Allowed profile-image types, mapped to the stored extension.
 *
 * Images only — a voice recording is not a profile picture — and every type must
 * be scrubbable by `media-scrub.ts`, for the same reason the proof list insists
 * on it: a type whose location metadata cannot be stripped has no business being
 * stored under a promise of privacy.
 */
const AVATAR_CONTENT_TYPES = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/heic', 'heic'],
]);

export function isAllowedAvatarType(contentType: string): boolean {
  return AVATAR_CONTENT_TYPES.has(contentType.toLowerCase());
}

export interface StoredAvatar {
  bucket: string;
  path: string;
  sizeBytes: number;
  contentType: string;
}

/**
 * Stores a profile image, scrubbed of metadata, in the avatars bucket.
 *
 * The same guarantees as proof media: the declared type selects the scrubber and
 * the stored extension, the scrubber confirms the bytes really are that
 * container, and the object path is a random UUID so a caller can influence
 * neither the filename nor the path.
 *
 * `upsert: false` because an upload is one-shot; the caller deletes the previous
 * avatar separately, and letting a new upload overwrite the old object would
 * make a failed database write orphan the new file instead of the old one.
 */
export async function uploadProfileAvatar(
  userId: string,
  file: { buffer: Buffer; contentType: string; size: number },
): Promise<StoredAvatar> {
  const declaredType = file.contentType.toLowerCase();
  const extension = AVATAR_CONTENT_TYPES.get(declaredType);

  if (!extension) {
    throw AppError.badRequest('That file type is not supported. Use a JPG, PNG, WebP or HEIC image.');
  }

  if (file.size <= 0) {
    throw AppError.badRequest('The uploaded file is empty.');
  }

  if (file.size > env.STORAGE_MAX_AVATAR_BYTES) {
    throw AppError.badRequest(
      `Profile images must be smaller than ${Math.floor(env.STORAGE_MAX_AVATAR_BYTES / (1024 * 1024))} MB.`,
    );
  }

  const scrubbed = await scrubImage(file.buffer, declaredType);

  if (scrubbed.buffer.length === 0) {
    throw AppError.badRequest('That image could not be read.');
  }

  const path = `${userId}/${randomUUID()}.${extension}`;

  const { error } = await supabaseAdmin.storage
    .from(env.STORAGE_AVATARS_BUCKET)
    .upload(path, scrubbed.buffer, {
      contentType: scrubbed.contentType,
      upsert: false,
    });

  if (error) {
    logger.error('Profile image upload failed', {
      userId,
      bucket: env.STORAGE_AVATARS_BUCKET,
      path,
      contentType: scrubbed.contentType,
      sizeBytes: scrubbed.buffer.length,
      reason: error.message,
      status: error.status,
    });
    throw AppError.internal('The image could not be stored.');
  }

  return {
    bucket: env.STORAGE_AVATARS_BUCKET,
    path,
    sizeBytes: scrubbed.buffer.length,
    contentType: scrubbed.contentType,
  };
}

/**
 * Removes a stored profile image, reporting whether the object is gone.
 *
 * The caller decides what a failure means — an account deletion counts it as
 * pending, an avatar replacement logs and moves on — so the outcome is returned
 * rather than decided in here.
 */
export async function deleteProfileAvatar(path: string): Promise<boolean> {
  const { error } = await supabaseAdmin.storage.from(env.STORAGE_AVATARS_BUCKET).remove([path]);
  if (error) {
    logger.error('Profile image removal failed', {
      bucket: env.STORAGE_AVATARS_BUCKET,
      path,
      reason: error.message,
    });
    return false;
  }
  return true;
}

/** Issues a short-lived signed URL for a stored profile image. Never public. */
export async function createSignedAvatarUrl(
  path: string,
  expiresInSeconds = 300,
): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(env.STORAGE_AVATARS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw AppError.notFound('That image is no longer available.');
  }

  return data.signedUrl;
}
