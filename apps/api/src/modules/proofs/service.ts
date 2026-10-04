import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { capabilityBlocks, users, verifications, workProofLogs } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { deleteWorkProofMedia, uploadWorkProofMedia } from '../../lib/storage.js';
import { generateVerificationToken, hashVerificationToken } from '../../lib/token.js';
import type { UploadedMedia } from '../../middleware/upload.js';
import type { ProofSubmissionInput } from './schemas.js';

/** How long a confirmation link stays usable. */
const VERIFICATION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface ProofSubmissionResult {
  proofId: string;
  skillTag: string;
  capabilityBlockId: string;
  /**
   * Always `pending`.
   *
   * The file has been scrubbed of location metadata, but nothing has assessed
   * whether the media is genuine. `valid` and `flagged_ai_fake` belong to the
   * anti-fraud engine, which does not exist yet, so claiming either would be a
   * false statement about work that has not been done.
   */
  metadataStatus: 'pending';
  /** What the scrubber removed, so the caller can see the protection actually applied. */
  scrubbed: {
    hadGps: boolean;
    hadMetadata: boolean;
    hadAudioTags: boolean;
  };
  /**
   * The single-use confirmation token, returned exactly once.
   *
   * Only its SHA-256 digest is stored, so this value cannot be recovered from the
   * database later. Delivering it by SMS is not wired up; see doc/13.
   */
  verificationToken: string;
  verificationExpiresAt: string;
}

/**
 * Resolves the capability block a proof belongs to.
 *
 * A worker naming a skill they have no block for gets one created, because the
 * product is worker-led and asking someone to pre-register a skill before their
 * first job would be a barrier with no compensating benefit. An explicit
 * `capabilityBlockId` is honoured instead, but only after confirming the worker
 * owns it, so one worker cannot attach proofs to another's record.
 */
async function resolveCapabilityBlock(
  workerId: string,
  input: ProofSubmissionInput,
): Promise<{ id: string; skillTag: string }> {
  if (input.capabilityBlockId) {
    const owned = await db
      .select({ id: capabilityBlocks.id, skillTag: capabilityBlocks.skillTag })
      .from(capabilityBlocks)
      .where(
        and(
          eq(capabilityBlocks.id, input.capabilityBlockId),
          eq(capabilityBlocks.workerId, workerId),
        ),
      )
      .limit(1);

    const block = owned[0];
    if (!block) {
      throw AppError.notFound('That capability could not be found on your account.');
    }

    return block;
  }

  const inserted = await db
    .insert(capabilityBlocks)
    .values({ workerId, skillTag: input.skillTag })
    .onConflictDoUpdate({
      target: [capabilityBlocks.workerId, capabilityBlocks.skillTag],
      set: { skillTag: input.skillTag },
    })
    .returning({ id: capabilityBlocks.id, skillTag: capabilityBlocks.skillTag });

  const block = inserted[0];
  if (!block) {
    throw AppError.internal('The proof could not be recorded.');
  }

  return block;
}

/**
 * Records a completed job: stores the scrubbed media, writes the proof row, and
 * issues a single-use confirmation link for the client.
 *
 * Ordering matters. Media is stored before the proof row is written, because a
 * row pointing at an object that does not exist is worse than a stored object
 * with no row: the former is a broken proof shown to a client, the latter is an
 * orphan that costs storage. If the row cannot be written, the stored object is
 * removed again, so a failed submission leaves nothing behind.
 */
export async function submitProof(
  workerId: string,
  input: ProofSubmissionInput,
  media: UploadedMedia,
): Promise<ProofSubmissionResult> {
  // The access token has already been verified, but the proof row references
  // `public.users`, and that row is what the foreign key and RLS are anchored to.
  const worker = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, workerId))
    .limit(1);

  if (!worker[0]) {
    throw AppError.forbidden('Your account is not set up to submit work yet.');
  }

  const block = await resolveCapabilityBlock(workerId, input);

  // Scrubbing happens inside the store call, so there is no way to reach the
  // bucket without it.
  const stored = await uploadWorkProofMedia(workerId, {
    buffer: media.buffer,
    contentType: media.contentType,
    size: media.size,
  });

  const rawToken = generateVerificationToken();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_SECONDS * 1000);

  try {
    const [proof] = await db
      .insert(workProofLogs)
      .values({
        workerId,
        capabilityBlockId: block.id,
        description: input.description,
        // Only the bucket-relative path is stored. Signed URLs are minted per
        // request at read time and never persisted, so a leaked database row
        // cannot be turned into a media link.
        mediaUrl: stored.path,
        // Scrubbing removes location data; it does not assess authenticity.
        metadataStatus: 'pending',
        submissionGps: input.submissionGps ?? null,
      })
      .returning({ id: workProofLogs.id });

    if (!proof) {
      throw AppError.internal('The proof could not be recorded.');
    }

    await db.insert(verifications).values({
      workProofId: proof.id,
      verifierPhone: input.verifierPhone ?? null,
      tokenHash: hashVerificationToken(rawToken),
      expiresAt,
    });

    return {
      proofId: proof.id,
      skillTag: block.skillTag,
      capabilityBlockId: block.id,
      metadataStatus: 'pending',
      scrubbed: stored.scrubbed,
      verificationToken: rawToken,
      verificationExpiresAt: expiresAt.toISOString(),
    };
  } catch (error) {
    // Never leave a stored object that no row references.
    await deleteWorkProofMedia(stored.path).catch(() => undefined);
    throw error;
  }
}