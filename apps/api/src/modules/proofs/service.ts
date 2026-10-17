import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import type {
  ProofDetailResponse,
  ProofExpiryNotice,
  ProofListItem,
  ProofMediaKind,
  ProofsResponse,
  PublicCapabilityProfileResponse,
  SkillLevel,
  UpdateProofInput,
  VerificationResendResponse,
  WorkerCapabilityProfileResponse,
  WorkerOverviewResponse,
} from '@tetherproof/shared';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import {
  capabilityBlocks,
  directOffers,
  profiles,
  userCapabilities,
  users,
  verifications,
  workProofLogs,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { sendVerificationLink } from '../../lib/messaging/index.js';
import { createNotification } from '../../lib/notifications.js';
import {
  createSignedMediaUrl,
  deleteWorkProofMedia,
  mediaKindFromPath,
  uploadWorkProofMedia,
} from '../../lib/storage.js';
import { generateVerificationToken, hashVerificationToken, hashVerifierPhone } from '../../lib/token.js';
import { transcribeAudio } from '../../lib/transcription.js';
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
  input: { skillTag: string; capabilityBlockId?: string; skillLevel: SkillLevel },
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

    // A level chosen on a log under an existing block is the worker restating
    // their tier for that skill, so the block follows the latest statement.
    await db
      .update(capabilityBlocks)
      .set({ skillLevel: input.skillLevel })
      .where(eq(capabilityBlocks.id, block.id));

    return block;
  }

  const inserted = await db
    .insert(capabilityBlocks)
    .values({ workerId, skillTag: input.skillTag, skillLevel: input.skillLevel })
    .onConflictDoUpdate({
      target: [capabilityBlocks.workerId, capabilityBlocks.skillTag],
      set: { skillTag: input.skillTag, skillLevel: input.skillLevel },
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

  // Speech-to-text for a voice recording, when a provider is configured. The
  // recording is always the record; a null transcript is an ordinary outcome
  // and never fails the submission (see `lib/transcription.ts`).
  const transcript = media.contentType.startsWith('audio/')
    ? await transcribeAudio(media.buffer, media.contentType)
    : null;

  const rawToken = generateVerificationToken();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_SECONDS * 1000);

  try {
    const [proof] = await db
      .insert(workProofLogs)
      .values({
        workerId,
        capabilityBlockId: block.id,
        description: input.description,
        transcript,
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
 */
function mediaKindFor(path: string | null): ProofMediaKind {
  return mediaKindFromPath(path);
}

/** A proof row joined with the skill of the block it hangs on. */
interface ProofRow {
  id: string;
  description: string;
  mediaUrl: string | null;
  verificationStatus: ProofListItem['verificationStatus'];
  submissionGps: string | null;
  createdAt: Date;
  capabilityBlockId: string | null;
  skillTag: string | null;
  skillLevel: number | null;
  transcript: string | null;
  /** When the platform withheld this record, and what it said about it. */
  flaggedAt: Date | null;
  flagReason: string | null;
  reviewStatus: 'none' | 'appealed' | 'under_review' | 'upheld' | 'overturned';
  reviewedAt: Date | null;
  restoredAt: Date | null;
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
      capabilityBlockId: workProofLogs.capabilityBlockId,
      skillTag: capabilityBlocks.skillTag,
      skillLevel: capabilityBlocks.skillLevel,
      transcript: workProofLogs.transcript,
      // The review lifecycle travels with the record so the log detail page can
      // show a worker what happened and offer the appeal, without a second read.
      flaggedAt: workProofLogs.flaggedAt,
      flagReason: workProofLogs.flagReason,
      reviewStatus: workProofLogs.reviewStatus,
      reviewedAt: workProofLogs.reviewedAt,
      restoredAt: workProofLogs.restoredAt,
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
    skillLevel: (row.skillLevel ?? 1) as SkillLevel,
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
 * A proof is editable only while nothing live has been handed out for it. The
 * question is deliberately about the *link*, not about whether a messaging
 * provider accepted it: since the work-logging form no longer collects a phone
 * number, a dispatch is never attempted, and a rule keyed on delivery would sit
 * permanently false and quietly disable the freeze. What the record must not do is
 * change while a client is holding a link that describes it.
 *
 * So the freeze follows the link itself: it is live from the moment it is issued
 * until it is answered or runs out. An answered proof is held still by its
 * `verificationStatus` instead, and a link that has expired stops freezing the log
 * so a worker who spotted a mistake after seven days can still correct it and ask
 * for a fresh link.
 *
 * Three states are reported rather than two, because "never had a link" and "had
 * one and let it lapse" call for different words on the log's page: only the second
 * has something to replace.
 */
async function verificationState(
  proofId: string,
): Promise<{ linkLive: boolean; linkExpired: boolean; expiresAt: string | null }> {
  const [latest] = await db
    .select({
      response: verifications.response,
      expiresAt: verifications.expiresAt,
    })
    .from(verifications)
    .where(eq(verifications.workProofId, proofId))
    .orderBy(desc(verifications.createdAt))
    .limit(1);

  if (!latest) return { linkLive: false, linkExpired: false, expiresAt: null };

  const unanswered = latest.response === 'none';
  const live = unanswered && latest.expiresAt.getTime() > Date.now();

  return {
    linkLive: live,
    linkExpired: unanswered && !live,
    expiresAt: live ? latest.expiresAt.toISOString() : null,
  };
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
  const { linkLive, linkExpired, expiresAt } = await verificationState(proofId);

  return {
    proof: {
      ...(await toListItem(row)),
      editable: row.verificationStatus === 'pending' && !linkLive,
      verificationOutstanding: linkLive,
      verificationLinkExpired: linkExpired,
      verificationExpiresAt: expiresAt,
      transcript: row.transcript,
      // Passed through so a worker sees, on the record itself, that it was held,
      // why, and whether they have already asked for it to be looked at again.
      // These are the worker's own fields — a score or a threshold is not sent.
      flaggedAt: row.flaggedAt?.toISOString() ?? null,
      flagReason: row.flagReason,
      reviewStatus: row.reviewStatus,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      restoredAt: row.restoredAt?.toISOString() ?? null,
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
  const { linkLive } = await verificationState(proofId);

  if (row.verificationStatus !== 'pending') {
    throw AppError.conflict('This log has already been verified and can no longer be edited.');
  }
  if (linkLive) {
    throw AppError.conflict(
      'A confirmation link is still live for this log, so it can no longer be edited.',
    );
  }

  const changes: Record<string, unknown> = {};
  if (input.description !== undefined) changes.description = input.description;
  // Null clears the stored location; the field is otherwise left untouched.
  if (input.submissionGps !== undefined) changes.submissionGps = input.submissionGps;
  if (input.skillTag !== undefined) {
    const block = await resolveCapabilityBlock(workerId, {
      skillTag: input.skillTag,
      skillLevel: (input.skillLevel ?? row.skillLevel ?? 1) as SkillLevel,
    });
    changes.capabilityBlockId = block.id;
  } else if (input.skillLevel !== undefined && row.capabilityBlockId) {
    // A level restated without a new skill renames nothing; the tier is updated
    // on the block the log already hangs under.
    await db
      .update(capabilityBlocks)
      .set({ skillLevel: input.skillLevel })
      .where(eq(capabilityBlocks.id, row.capabilityBlockId));
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

// ---------------------------------------------------------------------------
// Capability profile
// ---------------------------------------------------------------------------

/**
 * The worker's standing in each of their skills.
 *
 * Everything here is derived from the worker's own records rather than read off
 * the worker: the skill tags and levels come from the capability blocks their
 * proofs created, and every count is aggregated from the proofs themselves, so
 * the profile cannot drift from the logbook it summarises (the same reasoning
 * that governs search in `lib/matching.ts`).
 *
 * `verifiedProofs` counts proofs whose verdict is `verified`, and nothing else
 * counts. `rejected`, `flagged` and `fraud_blocked` proofs are all deliberately
 * kept out of the number a stranger or an employer sees — a withheld record is a
 * question, not a credit, and giving it any weight would let a pending review
 * inflate a worker's standing.
 */
export async function workerCapabilities(
  workerId: string,
): Promise<WorkerCapabilityProfileResponse> {
  const verified = sql<number>`count(distinct ${workProofLogs.id}) filter (where ${workProofLogs.verificationStatus} = 'verified')::int`;

  const rows = await db
    .select({
      skillTag: capabilityBlocks.skillTag,
      skillLevel: capabilityBlocks.skillLevel,
      totalLogs: sql<number>`count(distinct ${workProofLogs.id})::int`.as('total_logs'),
      verifiedProofs: verified.as('verified_proofs'),
      lastVerifiedAt: sql<string | null>`max(${verifications.completedAt})`.as('last_verified_at'),
    })
    .from(workProofLogs)
    .innerJoin(capabilityBlocks, eq(capabilityBlocks.id, workProofLogs.capabilityBlockId))
    .leftJoin(
      verifications,
      and(
        eq(verifications.workProofId, workProofLogs.id),
        eq(verifications.response, 'confirmed'),
      ),
    )
    .where(eq(workProofLogs.workerId, workerId))
    .groupBy(capabilityBlocks.id, capabilityBlocks.skillTag, capabilityBlocks.skillLevel)
    .orderBy(sql`verified_proofs desc, skill_tag asc`);

  const skills = rows.map((row) => ({
    skillTag: row.skillTag,
    skillLevel: (row.skillLevel ?? 1) as SkillLevel,
    totalLogs: Number(row.totalLogs),
    verifiedProofs: Number(row.verifiedProofs),
    lastVerifiedAt: toIsoOrNull(row.lastVerifiedAt),
  }));

  return {
    skills,
    verifiedTotal: skills.reduce((sum, skill) => sum + skill.verifiedProofs, 0),
  };
}

/**
 * The public, read-only capability profile behind a worker's shareable link.
 *
 * Answers only for a worker whose account exists, whose page is enabled, and
 * whose slug matches — any other request is a plain 404 so a probe cannot
 * distinguish "never enabled" from "wrong slug". The page carries only
 * aggregates and the worker's own name; no media, no locations, no contact
 * details, and no descriptions pass through it.
 */
export async function getPublicCapabilityProfile(
  slug: string,
): Promise<PublicCapabilityProfileResponse> {
  // "Holds the worker capability" rather than "has role = worker".
  //
  // This is the single line most likely to be missed by migration `0012`, and missing it
  // would be silent: a person who is both a worker and a student would keep all their
  // records, keep their proofs verified, and simply stop appearing on their own public
  // page, because whatever single role the account carried was no longer the literal
  // string 'worker'. A test covers it — see the combined-capability cases in the live
  // suite — because a regression here destroys somebody's portfolio without one error.
  const [page] = await db
    .select({ workerId: profiles.userId, displayName: profiles.fullName })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .innerJoin(
      userCapabilities,
      and(
        eq(userCapabilities.userId, users.id),
        eq(userCapabilities.capability, 'worker'),
      ),
    )
    .where(and(eq(profiles.publicSlug, slug), eq(profiles.publicProfile, true)))
    .limit(1);

  if (!page) {
    throw AppError.notFound('That capability profile was not found.');
  }

  const { skills } = await workerCapabilities(page.workerId);

  return {
    displayName: page.displayName,
    skills: skills.map((skill) => ({
      skillTag: skill.skillTag,
      skillLevel: skill.skillLevel,
      verifiedProofs: skill.verifiedProofs,
      lastVerifiedAt: skill.lastVerifiedAt,
    })),
    verifiedTotal: skills.reduce((sum, skill) => sum + skill.verifiedProofs, 0),
  };
}

/**
 * The worker's confirmation links that run out within the next few days.
 *
 * Used by the notification feed, which synthesizes `link_expiring` entries at
 * read time rather than storing them, so a link that crosses the boundary while
 * the page is open is never missed. Only the most recent link per proof is
 * considered: an older outstanding link is superseded by a resend and carries
 * no reminder value.
 */
const EXPIRY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export async function workerExpiringLinks(
  workerId: string,
): Promise<ProofExpiryNotice[]> {
  const rows = await db
    .select({
      proofId: verifications.workProofId,
      skillTag: capabilityBlocks.skillTag,
      expiresAt: verifications.expiresAt,
    })
    .from(verifications)
    .innerJoin(workProofLogs, eq(verifications.workProofId, workProofLogs.id))
    .leftJoin(capabilityBlocks, eq(capabilityBlocks.id, workProofLogs.capabilityBlockId))
    .where(
      and(
        eq(workProofLogs.workerId, workerId),
        eq(verifications.response, 'none'),
        eq(workProofLogs.verificationStatus, 'pending'),
        gt(verifications.expiresAt, new Date()),
        lt(verifications.expiresAt, new Date(Date.now() + EXPIRY_WINDOW_MS)),
        sql`${verifications.id} = (
          select v2.id from ${verifications} v2
          where v2.work_proof_id = ${verifications.workProofId}
          order by v2.created_at desc
          limit 1
        )`,
      ),
    );

  return rows.map((row) => ({
    proofId: row.proofId,
    skillTag: row.skillTag ?? 'Unlabelled work',
    expiresAt: row.expiresAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Confirmation-link reminders
// ---------------------------------------------------------------------------

/**
 * Issues a fresh confirmation link for a log whose earlier link ran out or was
 * never handed over.
 *
 * The original client phone number is not stored (only a salted hash is), so a
 * reminder cannot silently re-message the client: it hands the worker a new
 * single-use link to share. That is the honest version of "resend" within the
 * privacy model the product already keeps, and it is why re-sharing is a *new
 * request* rather than a redelivery of the old one — the two are deliberately not
 * the same operation.
 *
 * Refused while a link is live and once the log has reached a verdict. The freeze
 * rule is untouched: a reminder issues a link, it never reopens editing.
 */
export async function resendVerificationLink(
  workerId: string,
  proofId: string,
): Promise<VerificationResendResponse> {
  const row = await findOwnedRow(workerId, proofId);

  if (row.verificationStatus !== 'pending') {
    throw AppError.conflict(
      'This log has already been verified and can no longer receive a new link.',
    );
  }

  const { expiresAt } = await verificationState(proofId);

  // A live link is replaceable, because the worker cannot get it back. The API
  // keeps only a hash of the token, so the address exists exactly once — on the
  // screen that issued it — and is unrecoverable afterwards. Refusing here left
  // the log page offering a button that could only ever fail, and a worker who
  // had lost the link with days still to run had no way out.
  //
  // Replacing is not minting a second request. The supersede step below retires
  // the outstanding row inside the same transaction that issues the new one, so
  // the old link stops working immediately and exactly one answerable link is
  // ever outstanding — the same guarantee the expired-link path relied on.

  // A link that lapsed unanswered is the exact case a reminder exists for. The
  // worker is told it died and that a fresh one is ready, so the action has a
  // visible consequence rather than silently creating a second link.
  if (expiresAt === null) {
    const hadOutstanding = await hasUnansweredVerification(proofId);
    if (hadOutstanding) {
      await createNotification(
        workerId,
        'link_expired',
        'Confirmation link expired',
        `The confirmation link for ${row.skillTag ?? 'that skill'} expired. A fresh one is ready to share.`,
        `/logs/${proofId}`,
      );
    }
  }

  const worker = await db
    .select({ id: users.id, fullName: profiles.fullName })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, workerId))
    .limit(1);

  const rawToken = generateVerificationToken();
  const nextExpiry = new Date(Date.now() + VERIFICATION_TTL_SECONDS * 1000);

  // Supersede-then-issue, in one transaction.
  //
  // Without the supersede step a proof can end up with two answerable requests at
  // once: the previous row is merely *not the latest*, which stops it being read
  // as current, but its token still hashes to a live row with `response = 'none'`
  // and would still accept a decision. Two live links means two valid answers for
  // one record, and whichever landed last would win. Retiring the older row first
  // is what makes "one request, one decision" a property of the data rather than
  // of which row a query happens to read.
  //
  // Only unanswered rows are retired. A recorded decision is never touched here,
  // so replacing a link can never erase a confirmation or a rejection.
  const [verification] = await db.transaction(async (tx) => {
    await tx
      .update(verifications)
      .set({ expiresAt: new Date(), dispatchStatus: 'superseded' })
      .where(
        and(
          eq(verifications.workProofId, proofId),
          eq(verifications.response, 'none'),
        ),
      );

    return tx
      .insert(verifications)
      .values({
        workProofId: proofId,
        // No number is known for a resend; the worker shares the fresh link the
        // same way the first submission without a number was shared.
        verifierPhoneHash: null,
        tokenHash: hashVerificationToken(rawToken),
        expiresAt: nextExpiry,
      })
      .returning({ id: verifications.id });
  });

  if (!verification) {
    throw AppError.internal('The new link could not be prepared.');
  }

  const dispatch = await dispatchLink({
    to: null,
    rawToken,
    expiresAt: nextExpiry,
    skillTag: row.skillTag ?? 'Unlabelled work',
    workerName: worker[0]?.fullName ?? '',
    verificationId: verification.id,
  });

  return {
    verificationToken: rawToken,
    verificationExpiresAt: nextExpiry.toISOString(),
    verificationLinkSent: dispatch,
  };
}

/**
 * Whether this proof has ever had an unanswered request, live or lapsed.
 *
 * Used only to decide whether telling the worker their link expired is factually
 * true. A proof that has never been issued a link has nothing to have expired, and
 * a notification saying otherwise would be a small lie in the worker's own feed.
 */
async function hasUnansweredVerification(proofId: string): Promise<boolean> {
  const rows = await db
    .select({ id: verifications.id })
    .from(verifications)
    .where(
      and(
        eq(verifications.workProofId, proofId),
        eq(verifications.response, 'none'),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/** ISO string from an aggregate that may arrive as a string or a Date. */
function toIsoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}