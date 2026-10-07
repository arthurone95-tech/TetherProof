import { and, desc, eq } from 'drizzle-orm';
import type {
  ProofDetailResponse,
  ProofListItem,
  ProofMediaKind,
  ProofsResponse,
  UpdateProofInput,
  WorkerOverviewResponse,
} from '@tetherproof/shared';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import {
  capabilityBlocks,
  directOffers,
  profiles,
  users,
  verifications,
  workProofLogs,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { sendVerificationLink } from '../../lib/messaging/index.js';
import {
  createSignedMediaUrl,
  deleteWorkProofMedia,
  uploadWorkProofMedia,
} from '../../lib/storage.js';
import { generateVerificationToken, hashVerificationToken, hashVerifierPhone } from '../../lib/token.js';
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
   * database later. Also sent to `verifierPhone` when one was supplied and a
   * provider is configured.
   */
  verificationToken: string;
  verificationExpiresAt: string;
  /** Whether the link was accepted for delivery. False means share it manually. */
  verificationLinkSent: boolean;
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
  input: { skillTag: string; capabilityBlockId?: string },
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
  // The profile is read here so the message names the worker from stored data.
  // Taking the name from the request instead would let a worker put arbitrary
  // text into a message sent to someone else's phone.
  const worker = await db
    .select({ id: users.id, fullName: profiles.fullName })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, workerId))
    .limit(1);

  if (!worker[0]) {
    throw AppError.forbidden('Your account is not set up to submit work yet.');
  }

  const block = await resolveCapabilityBlock(workerId, input);

  // Scrubbing happens inside the store call, so there is no way to reach the
  // bucket without it. The signals it derives are only meaningful against the
  // moment of submission, so the time is captured here rather than inside.
  const submittedAt = new Date();
  const stored = await uploadWorkProofMedia(workerId, {
    buffer: media.buffer,
    contentType: media.contentType,
    size: media.size,
    submittedAt,
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
        // Nothing has assessed this media yet, so `pending` remains the only
        // honest value and `flagged_ai_fake` is not written anywhere.
        metadataStatus: 'pending',
        submissionGps: input.submissionGps ?? null,
        // Provenance booleans derived from the metadata the scrubber destroyed.
        // The values themselves were never retained, so there is nothing here
        // that could identify a device or place a person at a time.
        mediaSignalEvaluated: true,
        mediaHasCameraSignature: stored.signals.hasCameraSignature,
        mediaTimestampPlausible: stored.signals.timestampPlausible,
        mediaEncoderKnown: stored.signals.encoderKnown,
      })
      .returning({ id: workProofLogs.id });

    if (!proof) {
      throw AppError.internal('The proof could not be recorded.');
    }

    // Only the salted hash is retained. The number is used once, to address the
    // message, and never written down.
    const verifierPhoneHash = input.verifierPhone ? hashVerifierPhone(input.verifierPhone) : null;

    const [verification] = await db
      .insert(verifications)
      .values({
        workProofId: proof.id,
        verifierPhoneHash,
        tokenHash: hashVerificationToken(rawToken),
        expiresAt,
      })
      .returning({ id: verifications.id });

    if (!verification) {
      throw AppError.internal('The verification could not be prepared.');
    }

    const dispatch = await dispatchLink({
      to: input.verifierPhone ?? null,
      rawToken,
      expiresAt,
      skillTag: block.skillTag,
      workerName: worker[0].fullName ?? '',
      verificationId: verification.id,
    });

    return {
      proofId: proof.id,
      skillTag: block.skillTag,
      capabilityBlockId: block.id,
      metadataStatus: 'pending',
      scrubbed: stored.scrubbed,
      verificationToken: rawToken,
      verificationExpiresAt: expiresAt.toISOString(),
      verificationLinkSent: dispatch,
    };
  } catch (error) {
    // Never leave a stored object that no row references.
    await deleteWorkProofMedia(stored.path).catch(() => undefined);
    throw error;
  }
}

/**
 * Sends the confirmation link and records whether it went.
 *
 * Three separate things can each prevent this, and all three are recorded the
 * same way, because from the worker's side they are indistinguishable: no
 * number was given, no public web origin is configured, or the provider refused.
 *
 * Never throws. The proof is already stored by this point, so failing the
 * request would discard a real piece of work over a delivery problem. The
 * worker still receives the token in the response and can share it manually,
 * which is what `verificationLinkSent: false` is telling them.
 */
async function dispatchLink(input: {
  to: string | null;
  rawToken: string;
  expiresAt: Date;
  skillTag: string;
  workerName: string;
  verificationId: string;
}): Promise<boolean> {
  const record = async (status: string, detail?: string) => {
    await db
      .update(verifications)
      .set({ dispatchStatus: status, dispatchDetail: detail ?? null })
      .where(eq(verifications.id, input.verificationId));
  };

  if (!input.to) {
    await record('not_attempted', 'No client phone number was supplied.');
    return false;
  }

  if (!env.WEB_BASE_URL) {
    await record('not_attempted', 'WEB_BASE_URL is not configured, so no link could be built.');
    return false;
  }

  const link = `${env.WEB_BASE_URL.replace(/\/$/, '')}/verify/${input.rawToken}`;
  const result = await sendVerificationLink({
    to: input.to,
    workerName: input.workerName,
    skillTag: input.skillTag,
    link,
    expiresAt: input.expiresAt,
  });

  if (result.sent) {
    await record('sent');
    return true;
  }

  // The provider's own wording is deliberately not stored; it can echo the
  // recipient's number. The generic reason plus the server log is the record.
  await record('failed', result.reason ?? 'The messaging provider did not accept the message.');
  return false;
}

// ---------------------------------------------------------------------------
// Worker logbook
// ---------------------------------------------------------------------------

/**
 * The media kind of a stored proof object, read from the vetted extension.
 *
 * Images get an actual thumbnail square; audio gets a playable placeholder.
 * The extension is safe to trust here because it was assigned by the upload
 * path from the allow-list, never taken from a caller.
 */
function mediaKindFor(path: string | null): ProofMediaKind {
  const extension = path?.split('.').pop()?.toLowerCase() ?? '';
  return ['mp3', 'm4a', 'aac'].includes(extension) ? 'audio' : 'image';
}

/** A proof row joined with the skill tag of the block it hangs on. */
interface ProofRow {
  id: string;
  description: string;
  mediaUrl: string | null;
  verificationStatus: ProofListItem['verificationStatus'];
  submissionGps: string | null;
  createdAt: Date;
  skillTag: string | null;
}

async function proofRows(workerId: string, proofId?: string): Promise<ProofRow[]> {
  const query = db
    .select({
      id: workProofLogs.id,
      description: workProofLogs.description,
      mediaUrl: workProofLogs.mediaUrl,
      verificationStatus: workProofLogs.verificationStatus,
      submissionGps: workProofLogs.submissionGps,
      createdAt: workProofLogs.createdAt,
      skillTag: capabilityBlocks.skillTag,
    })
    .from(workProofLogs)
    .leftJoin(capabilityBlocks, eq(capabilityBlocks.id, workProofLogs.capabilityBlockId))
    .where(
      proofId
        ? and(eq(workProofLogs.id, proofId), eq(workProofLogs.workerId, workerId))
        : eq(workProofLogs.workerId, workerId),
    )
    .orderBy(desc(workProofLogs.createdAt));

  return proofId ? query.limit(1) : query;
}

/**
 * Turns a row into the response shape, minting the read-time signed URL.
 *
 * One storage call per row. Lists are short and this is the only way media can
 * leave the private bucket, so the trade is deliberate.
 */
async function toListItem(row: ProofRow): Promise<ProofListItem> {
  return {
    id: row.id,
    skillTag: row.skillTag ?? 'Unlabelled work',
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    verificationStatus: row.verificationStatus,
    submissionGps: row.submissionGps,
    mediaKind: mediaKindFor(row.mediaUrl),
    mediaUrl: row.mediaUrl ? await createSignedMediaUrl(row.mediaUrl) : '',
  };
}

/**
 * The link state behind the freeze rule.
 *
 * A proof is editable only while nothing has been handed out for it. `linkSent`
 * is true once a verification link was actually accepted by a messaging
 * provider — after that, editing the record would make the confirmation mean
 * something other than what was sent.
 */
async function verificationState(
  proofId: string,
): Promise<{ linkSent: boolean; expiresAt: string | null }> {
  const [latest] = await db
    .select({
      dispatchStatus: verifications.dispatchStatus,
      response: verifications.response,
      expiresAt: verifications.expiresAt,
    })
    .from(verifications)
    .where(eq(verifications.workProofId, proofId))
    .orderBy(desc(verifications.createdAt))
    .limit(1);

  if (!latest) return { linkSent: false, expiresAt: null };

  const linkSent = latest.dispatchStatus === 'sent';
  const outstanding = latest.response === 'none' && latest.expiresAt.getTime() > Date.now();
  return { linkSent, expiresAt: outstanding ? latest.expiresAt.toISOString() : null };
}

/** The caller's own proof row, or a 404 that does not reveal others' rows. */
async function findOwnedRow(workerId: string, proofId: string): Promise<ProofRow> {
  const [row] = await proofRows(workerId, proofId);
  if (!row) throw AppError.notFound('That log entry was not found.');
  return row;
}

/** Lists the caller's logged work, newest first. */
export async function listWorkerProofs(workerId: string): Promise<ProofsResponse> {
  const rows = await proofRows(workerId);
  return { proofs: await Promise.all(rows.map(toListItem)) };
}

/** One log entry with its editability and outstanding-link state. */
export async function getWorkerProof(
  workerId: string,
  proofId: string,
): Promise<ProofDetailResponse> {
  const row = await findOwnedRow(workerId, proofId);
  const { linkSent, expiresAt } = await verificationState(proofId);

  return {
    proof: {
      ...(await toListItem(row)),
      editable: row.verificationStatus === 'pending' && !linkSent,
      verificationLinkSent: linkSent,
      verificationExpiresAt: expiresAt,
    },
  };
}

/**
 * Applies an allowed edit to one of the caller's log entries.
 *
 * The freeze rule is re-checked here, at the write, not only at read time: a
 * link sent between the page load and the save must refuse the save, or the
 * confirmed record would silently differ from the one confirmed.
 */
export async function updateWorkerProof(
  workerId: string,
  proofId: string,
  input: UpdateProofInput,
): Promise<ProofDetailResponse> {
  const row = await findOwnedRow(workerId, proofId);
  const { linkSent } = await verificationState(proofId);

  if (row.verificationStatus !== 'pending') {
    throw AppError.conflict('This log has already been verified and can no longer be edited.');
  }
  if (linkSent) {
    throw AppError.conflict(
      'A confirmation link was already sent for this log, so it can no longer be edited.',
    );
  }

  const changes: Record<string, unknown> = {};
  if (input.description !== undefined) changes.description = input.description;
  // Null clears the stored location; the field is otherwise left untouched.
  if (input.submissionGps !== undefined) changes.submissionGps = input.submissionGps;
  if (input.skillTag !== undefined) {
    const block = await resolveCapabilityBlock(workerId, { skillTag: input.skillTag });
    changes.capabilityBlockId = block.id;
  }

  const [updated] = await db
    .update(workProofLogs)
    .set(changes)
    .where(eq(workProofLogs.id, proofId))
    .returning({ id: workProofLogs.id });

  if (!updated) throw AppError.notFound('That log entry was not found.');

  return getWorkerProof(workerId, proofId);
}

/**
 * The numbers the worker dashboard leads with.
 *
 * Counts come from the caller's own rows only. The `recent` slice reuses the
 * list path so thumbnails and statuses are rendered once, in one shape.
 */
export async function workerOverview(workerId: string): Promise<WorkerOverviewResponse> {
  const [statuses, invitations] = await Promise.all([
    db
      .select({ status: workProofLogs.verificationStatus })
      .from(workProofLogs)
      .where(eq(workProofLogs.workerId, workerId)),
    db
      .select({ id: directOffers.id })
      .from(directOffers)
      .where(and(eq(directOffers.workerId, workerId), eq(directOffers.status, 'pending'))),
  ]);

  const proofs = await listWorkerProofs(workerId);

  return {
    totalLogs: statuses.length,
    verifiedLogs: statuses.filter((row) => row.status === 'verified').length,
    awaitingVerificationLogs: statuses.filter((row) => row.status === 'pending').length,
    pendingInvitations: invitations.length,
    recent: proofs.proofs.slice(0, 3),
  };
}