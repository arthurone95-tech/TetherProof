import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type {
  CapabilitySpec,
  CandidateCard,
  EmployerVerificationStatus,
  OfferSendingStatus,
  ReceivedOffer,
  SentOffer,
} from '@tetherproof/shared';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { db } from '../../db/client.js';
import {
  directOffers,
  employerApprovals,
  employerSpecs,
  profiles,
  users,
  type DirectOfferRow,
  type EmployerSpecRow,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import {
  CANDIDATE_HANDLE_TTL_HOURS,
  issueCandidateHandle,
  purgeExpiredHandles,
  resolveCandidateHandle,
} from '../../lib/handles.js';
import { gpsSchema, parseCoordinate } from '../../lib/geo.js';
import {
  aggregateCandidateMetrics,
  measureDistances,
  readWorkerLocations,
  type CandidateMetric,
} from '../../lib/matching.js';
import type {
  ApprovalDecisionInput,
  CreateOfferInput,
  CreateSpecInput,
  SearchInput,
  UpdateSpecInput,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Employer approval
// ---------------------------------------------------------------------------

/**
 * Current approval state for an employer.
 *
 * An absent row means pending. That is deliberately the same as an explicit
 * pending row, so a newly registered employer needs no setup step before they can
 * search: reading a table that may not have a row yet would otherwise force a
 * write on every read path.
 */
export async function getApprovalStatus(
  employerId: string,
): Promise<EmployerVerificationStatus> {
  const rows = await db
    .select({ status: employerApprovals.status })
    .from(employerApprovals)
    .where(eq(employerApprovals.employerId, employerId))
    .limit(1);

  return rows[0]?.status ?? 'pending';
}

/**
 * Whether this employer may send an unsolicited invitation right now.
 *
 * Only `approved` may send. The gate is on sending and not on searching: searching
 * is read-only, reveals nothing the employer was not already entitled to see, and
 * blocking it would stop a legitimate employer from evaluating the tool before
 * anyone has reviewed their account. Contacting a worker who never agreed to be
 * contacted is the action that needs a human to have looked at the account first.
 *
 * `rejected` is a distinct state from `pending` and is not retryable by the
 * employer, so an account that was turned down cannot simply re-apply and get
 * another automatic pending.
 */
export async function getOfferSendingStatus(employerId: string): Promise<OfferSendingStatus> {
  const status = await getApprovalStatus(employerId);
  if (status === 'approved') return { eligibility: 'eligible' };

  return {
    eligibility: 'blocked',
    reason:
      status === 'rejected'
        ? 'This employer account is not approved to send invitations.'
        : 'This employer account is awaiting approval before it can send invitations.',
  };
}

async function assertCanSendOffers(employerId: string): Promise<void> {
  const status = await getOfferSendingStatus(employerId);
  if (status.eligibility === 'blocked') {
    throw new AppError({
      code: 'FORBIDDEN',
      message: status.reason ?? 'This account cannot send invitations.',
      status: 403,
    });
  }
}

/** Records an admin's decision. Called only from the admin route. */
export async function setApprovalStatus(
  employerId: string,
  decision: ApprovalDecisionInput,
  reviewedBy: string,
): Promise<EmployerVerificationStatus> {
  const target = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, employerId))
    .limit(1);

  const account = target[0];
  if (!account) {
    throw new AppError({ code: 'NOT_FOUND', message: 'That employer account was not found.', status: 404 });
  }
  if (account.role !== 'employer') {
    // Approving a worker would grant nothing useful and would mislabel the record.
    throw new AppError({
      code: 'CONFLICT',
      message: 'That account is not an employer account.',
      status: 409,
    });
  }

  const reviewedAt = decision.status === 'pending' ? null : new Date();

  await db
    .insert(employerApprovals)
    .values({
      employerId,
      status: decision.status,
      reviewedBy,
      note: decision.note ?? null,
      reviewedAt,
    })
    .onConflictDoUpdate({
      target: employerApprovals.employerId,
      set: {
        status: decision.status,
        reviewedBy,
        note: decision.note ?? null,
        reviewedAt,
      },
    });

  return decision.status;
}

/** Own approval record, for the employer to see. Never exposes the reviewer's identity. */
export async function getOwnApproval(employerId: string): Promise<{
  status: EmployerVerificationStatus;
  note: string | null;
  reviewedAt: string | null;
}> {
  const rows = await db
    .select({
      status: employerApprovals.status,
      note: employerApprovals.note,
      reviewedAt: employerApprovals.reviewedAt,
    })
    .from(employerApprovals)
    .where(eq(employerApprovals.employerId, employerId))
    .limit(1);

  const row = rows[0];
  return {
    status: row?.status ?? 'pending',
    note: row?.note ?? null,
    reviewedAt: row?.reviewedAt ? row.reviewedAt.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Capability specs
// ---------------------------------------------------------------------------

function toSpec(row: EmployerSpecRow): CapabilitySpec {
  return {
    id: row.id,
    requiredSkill: row.requiredSkill,
    minProofThreshold: row.minProofThreshold,
    maxDistanceKm: row.maxDistanceKm,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Reads the single row an insert or update must have produced.
 *
 * `.returning()` is typed as possibly empty, and treating an impossible empty
 * result as an index into the array would hand the caller a row of `undefined`
 * fields rather than failing. `INSERT` with a `RETURNING` clause always yields a
 * row when the statement did not throw, so this is a type guard, not a runtime
 * branch that is expected to trigger.
 */
function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new AppError({
      code: 'INTERNAL_ERROR',
      message: 'The write completed but returned no row.',
      status: 500,
    });
  }
  return row;
}

export async function createSpec(employerId: string, input: CreateSpecInput): Promise<CapabilitySpec> {
  const inserted = await db
    .insert(employerSpecs)
    .values({
      employerId,
      requiredSkill: input.requiredSkill,
      minProofThreshold: input.minProofThreshold,
      maxDistanceKm: input.maxDistanceKm,
    })
    .returning();

  return toSpec(one(inserted));
}

export async function listSpecs(employerId: string): Promise<CapabilitySpec[]> {
  const rows = await db
    .select()
    .from(employerSpecs)
    .where(eq(employerSpecs.employerId, employerId))
    .orderBy(asc(employerSpecs.createdAt));

  return rows.map(toSpec);
}

/**
 * Loads a spec owned by this employer.
 *
 * Scoping the lookup by owner and reporting not-found for someone else's spec is
 * deliberate. Distinguishing "exists but not yours" from "does not exist" would let
 * an employer confirm that another account had created a spec, which is a small
 * but unnecessary disclosure about other tenants.
 */
async function loadOwnSpec(specId: string, employerId: string): Promise<EmployerSpecRow> {
  const rows = await db
    .select()
    .from(employerSpecs)
    .where(and(eq(employerSpecs.id, specId), eq(employerSpecs.employerId, employerId)))
    .limit(1);

  const spec = rows[0];
  if (!spec) {
    throw new AppError({ code: 'NOT_FOUND', message: 'That capability spec was not found.', status: 404 });
  }
  return spec;
}

export async function updateSpec(
  specId: string,
  employerId: string,
  input: UpdateSpecInput,
): Promise<CapabilitySpec> {
  await loadOwnSpec(specId, employerId);

  // Only the fields the caller actually supplied. Spreading `input` wholesale would
  // write undefined keys over untouched columns, and drizzle treats an explicit
  // `undefined` differently from an absent key.
  const patch: Partial<typeof employerSpecs.$inferInsert> = {};
  if (input.requiredSkill !== undefined) patch.requiredSkill = input.requiredSkill;
  if (input.minProofThreshold !== undefined) patch.minProofThreshold = input.minProofThreshold;
  if (input.maxDistanceKm !== undefined) patch.maxDistanceKm = input.maxDistanceKm;
  if (input.isActive !== undefined) patch.isActive = input.isActive;

  const updated = await db
    .update(employerSpecs)
    .set(patch)
    .where(and(eq(employerSpecs.id, specId), eq(employerSpecs.employerId, employerId)))
    .returning();

  return toSpec(one(updated));
}

/**
 * Deletes a spec.
 *
 * Offers reference a spec with `ON DELETE SET NULL`, so deleting a spec does not
 * remove invitations that were already sent. The employer's history of who they
 * contacted is not something the spec's removal should be able to erase.
 */
export async function deleteSpec(specId: string, employerId: string): Promise<void> {
  await loadOwnSpec(specId, employerId);
  await db
    .delete(employerSpecs)
    .where(and(eq(employerSpecs.id, specId), eq(employerSpecs.employerId, employerId)));
}

// ---------------------------------------------------------------------------
// Zero-knowledge search
// ---------------------------------------------------------------------------

/**
 * Ranks masked candidates for a spec or an ad-hoc query.
 *
 * What leaves this function is deliberately thin: a handle, the skill, three
 * aggregate numbers, and a distance. There is no worker id, name, email, phone,
 * avatar, or coordinate in the returned shape, and nothing here is reachable that
 * would let a caller join a card back to a person.
 *
 * `blocked` proofs never contribute to `verifiedProofs`, which is the whole reason
 * the anti-fraud engine exists. A worker whose history is mostly blocked proofs
 * should rank at the bottom, not merely not be excluded.
 */
export async function searchCandidates(
  employerId: string,
  input: SearchInput,
): Promise<CandidateCard[]> {
  let requiredSkill = input.requiredSkill;
  let minProofThreshold = input.minProofThreshold;
  let maxDistanceKm = input.maxDistanceKm;

  if (input.specId) {
    // A spec supplies the criteria. Explicit query parameters may narrow them but
    // never widen them, so passing a spec plus a lower threshold cannot be used to
    // borrow another employer's spec as a floor for a looser search.
    const spec = await loadOwnSpec(input.specId, employerId);
    requiredSkill = input.requiredSkill ?? spec.requiredSkill;
    minProofThreshold = Math.max(minProofThreshold, spec.minProofThreshold);
    maxDistanceKm = Math.min(maxDistanceKm, spec.maxDistanceKm);
  }

  if (!requiredSkill) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'Provide a capability spec or a skill to search for.',
      status: 400,
    });
  }

  // Opportunistic purge of expired handles, here because this is the one operation
  // that mints them. There is no scheduler in this service, and adding a background
  // timer would mean new infrastructure and, in more than one instance, the same
  // sweep running concurrently everywhere. A search is a deliberate human action at
  // human frequency, and the delete is bounded by an index on `expires_at`, so
  // folding the sweep in here costs one indexed statement and keeps the table from
  // growing without bound.
  //
  // Failures are swallowed on purpose: a housekeeping delete must never be the reason
  // a search fails, and expiry is enforced on read anyway, so an unswept row is
  // inert.
  await purgeExpiredHandles().catch((error: unknown) => {
    logger.warn('Expired candidate handle purge failed', {
      product: env.PRODUCT_NAME,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const metrics = await aggregateCandidateMetrics(requiredSkill, minProofThreshold);
  if (metrics.length === 0) return [];

  const reference = input.referenceGps ? parseCoordinate(input.referenceGps) : null;
  if (input.referenceGps && reference === null) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'Reference coordinates are malformed or out of range.',
      status: 400,
      details: { referenceGps: gpsSchema.safeParse(input.referenceGps).error?.issues },
    });
  }

  const locations = await readWorkerLocations(metrics.map((metric) => metric.workerId));
  const distances = reference ? measureDistances(metrics, locations, reference) : null;

  const cards: CandidateCard[] = [];
  for (const metric of metrics) {
    const distanceKm = distances?.get(metric.workerId) ?? null;
    // Only measured distances can fail the radius. An absent distance is an
    // absence of evidence and does not disqualify: excluding unlocatable workers
    // would hide most of a network that has not opted into geolocation.
    if (distanceKm !== null && distanceKm > maxDistanceKm) continue;
    if (cards.length >= input.limit) break;

    const handle = await issueCandidateHandle(employerId, metric.workerId, CANDIDATE_HANDLE_TTL_HOURS);
    cards.push({
      candidateHandle: handle,
      // The skill the employer searched for, not the worker's own wording. Matching
      // is case-insensitive, so a worker who recorded "Welding" would otherwise see
      // their own tag echoed back differently from what they typed.
      skillTag: requiredSkill,
      verifiedProofs: metric.verifiedProofs,
      trustScore: metric.trustScore,
      lastVerifiedAt: metric.lastVerifiedAt ? metric.lastVerifiedAt.toISOString() : null,
      distanceKm,
    });
  }

  return cards;
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export async function createOffer(
  employerId: string,
  input: CreateOfferInput,
  specId: string | null,
): Promise<SentOffer> {
  await assertCanSendOffers(employerId);

  const workerId = await resolveCandidateHandle(employerId, input.candidateHandle);
  if (workerId === null) {
    // Unknown, expired, and other-employer's handles are indistinguishable on
    // purpose. Anything more specific would confirm which handles are real.
    throw new AppError({
      code: 'NOT_FOUND',
      message: 'That candidate link is not valid or has expired. Run the search again.',
      status: 404,
    });
  }

  const existing = await db
    .select({ id: directOffers.id, status: directOffers.status })
    .from(directOffers)
    .where(and(eq(directOffers.employerId, employerId), eq(directOffers.workerId, workerId)))
    .limit(1);

  const prior = existing[0];
  if (prior) {
    if (prior.status === 'pending') {
      throw new AppError({
        code: 'CONFLICT',
        message: 'An invitation to this candidate is already awaiting a response.',
        status: 409,
      });
    }
    // A previous invitation was answered, so the employer may legitimately try
    // again. Reopening the existing row keeps the one-invitation-per-pair unique
    // index meaningful and preserves the history of the earlier exchange.
    const reopened = await db
      .update(directOffers)
      .set({ status: 'pending', note: input.note ?? null, specId, respondedAt: null, updatedAt: new Date() })
      .where(eq(directOffers.id, prior.id))
      .returning();

    const row = one(reopened);
    return toSentOffer(row);
  }

  const inserted = await db
    .insert(directOffers)
    .values({ employerId, workerId, note: input.note ?? null, specId })
    .returning();

  return toSentOffer(one(inserted));
}

function toSentOffer(row: DirectOfferRow): SentOffer {
  return {
    id: row.id,
    // The employer already knows who they invited, so the worker id is theirs to
    // see on their own record. The masking promise binds what a search discloses
    // about strangers, not what an employer can see about their own correspondence.
    workerId: row.workerId,
    specId: row.specId,
    note: row.note,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
  };
}

export async function listSentOffers(employerId: string): Promise<SentOffer[]> {
  const rows = await db
    .select()
    .from(directOffers)
    .where(eq(directOffers.employerId, employerId))
    .orderBy(desc(directOffers.createdAt));

  return rows.map(toSentOffer);
}

/**
 * Invitations addressed to this worker.
 *
 * The employer is reduced to an organization name and an approval marker. A worker
 * cannot decide whether to talk to somebody without knowing who is offering, so
 * that much is disclosed, and nothing else about the account is. Contact details,
 * account id, and spec history stay server-side.
 */
export async function listReceivedOffers(workerId: string): Promise<ReceivedOffer[]> {
  const rows = await db
    .select({
      id: directOffers.id,
      note: directOffers.note,
      status: directOffers.status,
      createdAt: directOffers.createdAt,
      respondedAt: directOffers.respondedAt,
      employerId: directOffers.employerId,
      employerOrganization: profiles.organizationName,
    })
    .from(directOffers)
    .leftJoin(profiles, eq(profiles.userId, directOffers.employerId))
    .where(eq(directOffers.workerId, workerId))
    .orderBy(desc(directOffers.createdAt));

  // Only employers who actually appear in these offers need an approval looked up,
  // so the query is narrowed to them. Loading the whole approval table would be a
  // full scan of every decision ever made and would put unrelated approvals in
  // memory for a handful of rows that matter.
  const employerIds = [...new Set(rows.map((row) => row.employerId))];
  const approvals =
    employerIds.length === 0
      ? []
      : await db
          .select({ employerId: employerApprovals.employerId, status: employerApprovals.status })
          .from(employerApprovals)
          .where(
            and(
              inArray(employerApprovals.employerId, employerIds),
              eq(employerApprovals.status, 'approved'),
            ),
          );
  const approved = new Map(approvals.map((row) => [row.employerId, true]));

  return rows.map((row) => ({
    id: row.id,
    employerOrganization: row.employerOrganization,
    employerApproved: approved.get(row.employerId) ?? false,
    note: row.note,
    status: row.status,
    // Identity flows one way and only after agreement. Before acceptance the
    // employer does not know which worker they reached, and the endpoint above
    // could not tell them anyway.
    candidateRevealed: row.status === 'accepted',
    createdAt: row.createdAt.toISOString(),
    respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
  }));
}

/**
 * Records the worker's answer to an invitation.
 *
 * Only the addressed worker may answer. Answering twice is refused rather than
 * silently overwriting the first response, because a worker who declines and then
 * changes their mind should be able to change their mind by a new invitation, not
 * by retracting a decision that was already recorded.
 */
export async function respondToOffer(
  workerId: string,
  offerId: string,
  response: 'accepted' | 'declined',
): Promise<ReceivedOffer> {
  const rows = await db
    .select({ id: directOffers.id, status: directOffers.status })
    .from(directOffers)
    .where(and(eq(directOffers.id, offerId), eq(directOffers.workerId, workerId)))
    .limit(1);

  const offer = rows[0];
  if (!offer) {
    throw new AppError({ code: 'NOT_FOUND', message: 'That invitation was not found.', status: 404 });
  }
  if (offer.status !== 'pending') {
    throw new AppError({
      code: 'CONFLICT',
      message: `This invitation was already ${offer.status}.`,
      status: 409,
    });
  }

  await db
    .update(directOffers)
    .set({ status: response, respondedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(directOffers.id, offerId), eq(directOffers.workerId, workerId)));

  const received = await listReceivedOffers(workerId);
  const updated = received.find((offerRow) => offerRow.id === offerId);
  if (!updated) {
    throw new AppError({ code: 'INTERNAL_ERROR', message: 'Could not read the updated invitation.', status: 500 });
  }
  return updated;
}

/** Counts pending invitations for a worker, for a badge. */
export async function countPendingOffers(workerId: string): Promise<number> {
  const rows = await db
    .select({ id: directOffers.id })
    .from(directOffers)
    .where(and(eq(directOffers.workerId, workerId), eq(directOffers.status, 'pending')));

  return rows.length;
}

export type { CandidateMetric };