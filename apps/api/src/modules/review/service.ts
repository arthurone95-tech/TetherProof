/**
 * The review queue for withheld work records.
 *
 * ## Why this exists
 *
 * The trust engine used to mark a proof `fraud_blocked` on its own. That made a
 * heuristic over weak signals — a self-declared location, a photo stripped of its
 * metadata, a graph shape a site supervisor produces by working one site all week
 * — into a permanent, undisclosed accusation against someone's income. Nothing in
 * the system could undo it, the worker was never told, and employers saw a fraud
 * count on their record.
 *
 * The engine now only ever produces `flagged`: withheld from counting, queued for
 * a person, and explicitly not a finding of fraud. This module is where a person
 * decides.
 *
 * ## What a reviewer may and may not do
 *
 * * **Uphold** — the record stays withheld and becomes `fraud_blocked`. This is the
 *   only path to that status anywhere in the system, and it requires an admin
 *   identity which is stored against the decision.
 * * **Overturn** — the record returns to `verified` and `restoredAt` records when.
 *   The engine's findings are **not** deleted: they live on the verification row
 *   and remain readable here, because an appeal that erased the reason would let
 *   anyone clear a genuine finding by objecting to it.
 *
 * Neither action can reach a proof that a client rejected, and neither can reach
 * one that is still awaiting an answer. An appeal is not a second verification
 * request and cannot be used to manufacture a confirmation — Rule 2 and Rule 8
 * both depend on there being exactly one token and one decision.
 */
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { AdminProofReviewItem, ProofReviewOutcome } from '@tetherproof/shared';
import { db } from '../../db/client.js';
import { capabilityBlocks, verifications, workProofLogs } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';

export type ReviewOutcome = ProofReviewOutcome;
export type ReviewQueueItem = AdminProofReviewItem;

/**
 * Every record a person could look at, oldest first.
 *
 * Bounded like the rest of the read paths in this codebase: the queue is a work
 * list, not an archive, and an unbounded read on a page an admin opens by habit
 * would grow without limit.
 */
const REVIEW_QUEUE_LIMIT = 200;

export async function reviewQueue(): Promise<ReviewQueueItem[]> {
  const rows = await db
    .select({
      proofId: workProofLogs.id,
      skillTag: capabilityBlocks.skillTag,
      description: workProofLogs.description,
      flagReason: workProofLogs.flagReason,
      flaggedAt: workProofLogs.flaggedAt,
      reviewStatus: workProofLogs.reviewStatus,
      verificationStatus: workProofLogs.verificationStatus,
      clientResponse: verifications.response,
      fraudScore: verifications.fraudScore,
    })
    .from(workProofLogs)
    .leftJoin(capabilityBlocks, eq(capabilityBlocks.id, workProofLogs.capabilityBlockId))
    .leftJoin(
      verifications,
      sql`${verifications.id} = (
        select v2.id from ${verifications} v2
         where v2.work_proof_id = ${workProofLogs.id}
         order by v2.created_at desc
         limit 1
      )`,
    )
    .where(
      and(
        sql`${workProofLogs.verificationStatus} in ('flagged', 'fraud_blocked')`,
        // A retained-but-anonymised record has no worker to restore anything for,
        // so it is not reviewable and must not sit in a queue forever.
        isNotNull(workProofLogs.workerId),
      ),
    )
    .orderBy(asc(workProofLogs.flaggedAt), desc(workProofLogs.createdAt))
    .limit(REVIEW_QUEUE_LIMIT);

  return rows.map((row) => ({
    proofId: row.proofId,
    skillTag: row.skillTag,
    description: row.description,
    flagReason: row.flagReason,
    flaggedAt: row.flaggedAt ? row.flaggedAt.toISOString() : null,
    reviewStatus: row.reviewStatus,
    verificationStatus: row.verificationStatus as 'flagged' | 'fraud_blocked',
    clientResponse: (row.clientResponse ?? 'none') as 'confirmed' | 'rejected' | null,
    fraudScore: row.fraudScore === null ? null : Number(row.fraudScore),
  }));
}

/**
 * Records a reviewer's decision on a withheld record.
 *
 * Every guard here exists because this is the one place a record can become
 * `fraud_blocked`, and the one place a withheld record can go back to `verified`.
 *
 * * Only a record the engine withheld can be reviewed, so a reviewer cannot reach
 *   an ordinary verification or a client rejection.
 * * Only a record whose client actually **confirmed** can be overturned.
 *   Overturning a rejection would convert "the client says this did not happen"
 *   into a badge, which is not a review, it is an override of the only party who
 *   was there.
 * * A decision cannot be reversed by a second one, so the queue reflects what was
 *   decided rather than the last person to click.
 * * `reviewedBy` is the admin's own id, taken from the session and never from the
 *   request body, so an unapproved decision cannot be attributed to someone else.
 */
export async function reviewProof(
  proofId: string,
  outcome: ReviewOutcome,
  adminId: string,
): Promise<{ proofId: string; verificationStatus: string; reviewStatus: string }> {
  const [row] = await db
    .select({
      id: workProofLogs.id,
      verificationStatus: workProofLogs.verificationStatus,
      reviewStatus: workProofLogs.reviewStatus,
      workerId: workProofLogs.workerId,
    })
    .from(workProofLogs)
    .where(eq(workProofLogs.id, proofId))
    .limit(1);

  if (!row) throw AppError.notFound('That log entry was not found.');

  if (row.verificationStatus !== 'flagged' && row.verificationStatus !== 'fraud_blocked') {
    throw AppError.conflict('That record was never withheld, so there is nothing to review.');
  }

  if (row.reviewStatus === 'upheld' || row.reviewStatus === 'overturned') {
    throw AppError.conflict('That record has already been reviewed.');
  }

  const latest = await db
    .select({ response: verifications.response })
    .from(verifications)
    .where(eq(verifications.workProofId, proofId))
    .orderBy(desc(verifications.createdAt))
    .limit(1);

  const clientResponse = latest[0]?.response ?? 'none';

  if (outcome === 'overturned' && clientResponse !== 'confirmed') {
    throw AppError.conflict(
      'That work was not confirmed by the client, so it cannot be restored. A review corrects an integrity decision, not a client answer.',
    );
  }

  const reviewedAt = new Date();

  const [updated] = await db
    .update(workProofLogs)
    .set({
      verificationStatus: outcome === 'upheld' ? 'fraud_blocked' : 'verified',
      reviewStatus: outcome,
      reviewedAt,
      reviewedBy: adminId,
      // `restoredAt` is set only on the way back, because it is the moment a
      // worker got their income back and nothing else means that.
      ...(outcome === 'overturned' ? { restoredAt: reviewedAt } : {}),
    })
    .where(
      and(
        eq(workProofLogs.id, proofId),
        // The guard is repeated in the WHERE so two reviewers acting at once
        // cannot both land: the loser updates nothing and is told so.
        sql`${workProofLogs.reviewStatus} in ('none', 'appealed', 'under_review')`,
      ),
    )
    .returning({ id: workProofLogs.id, verificationStatus: workProofLogs.verificationStatus, reviewStatus: workProofLogs.reviewStatus });

  if (!updated) {
    throw AppError.conflict('That record was reviewed by someone else a moment ago.');
  }

  return {
    proofId,
    verificationStatus: updated.verificationStatus,
    reviewStatus: updated.reviewStatus,
  };
}

/**
 * A worker asks for a withheld record to be looked at again.
 *
 * Refused unless the record is theirs **and** was withheld. It cannot change the
 * status — the record stays out of the verified count while it waits, which is
 * the honest position: an appeal is a request, not a reprieve — and it records
 * that the worker asked, so silence is not mistaken for agreement.
 *
 * A second appeal is refused rather than overwriting the first, so the queue does
 * not silently reset its own workload.
 */
export async function appealProof(
  workerId: string,
  proofId: string,
): Promise<{ proofId: string; reviewStatus: string }> {
  const [row] = await db
    .select({
      id: workProofLogs.id,
      workerId: workProofLogs.workerId,
      verificationStatus: workProofLogs.verificationStatus,
      reviewStatus: workProofLogs.reviewStatus,
    })
    .from(workProofLogs)
    .where(eq(workProofLogs.id, proofId))
    .limit(1);

  // Not found and not yours are reported identically: a 403 for someone else's
  // id would confirm the record exists, and a proof id is not a secret.
  if (!row || row.workerId !== workerId) {
    throw AppError.notFound('That log entry was not found.');
  }

  if (row.verificationStatus !== 'flagged' && row.verificationStatus !== 'fraud_blocked') {
    throw AppError.conflict('That record is not being held, so there is nothing to appeal.');
  }

  if (row.reviewStatus === 'appealed' || row.reviewStatus === 'under_review') {
    throw AppError.conflict('You have already asked for this to be looked at again.');
  }

  // An upheld or overturned record is not appealable a second time. That is a
  // policy limit rather than a technical one, and it is deliberate: the appeal
  // exists to correct a decision that may be wrong, not to reopen every decision
  // forever. `review_status` records it either way.
  if (row.reviewStatus === 'upheld' || row.reviewStatus === 'overturned') {
    throw AppError.conflict('That record has already been reviewed.');
  }

  const [updated] = await db
    .update(workProofLogs)
    .set({ reviewStatus: 'appealed' })
    .where(
      and(
        eq(workProofLogs.id, proofId),
        sql`${workProofLogs.reviewStatus} = 'none'`,
      ),
    )
    .returning({ reviewStatus: workProofLogs.reviewStatus });

  if (!updated) {
    throw AppError.conflict('That record was already appealed.');
  }

  return { proofId, reviewStatus: updated.reviewStatus };
}
