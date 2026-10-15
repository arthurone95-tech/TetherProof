import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type {
  AcceptedCandidate,
  AdminEmployerListItem,
  CapabilitySpec,
  CandidateCard,
  EmployerOverviewResponse,
  EmployerVerificationStatus,
  OfferSendingStatus,
  ReceivedOffer,
  SentOffer,
  SpecMatchCount,
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
import { savedWorkersForSkill } from './saved-workers.js';
import { gpsSchema, parseCoordinate, type Coordinate } from '../../lib/geo.js';
import {
  aggregateCandidateMetrics,
  measureDistances,
  readWorkerLocations,
  type CandidateMetric,
} from '../../lib/matching.js';
import { createNotification } from '../../lib/notifications.js';
import { supabaseAdmin } from '../../lib/supabase.js';
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
 * What leaves this function is deliberately thin: a handle, the skill, the
 * worker's own name and photo, three aggregate numbers, and a distance. The name
 * and photo are present only for a worker who is `discoverable`, which the
 * aggregation enforces, and they are what let an employer tell two otherwise
 * identical candidates apart before deciding whom to invite. Contact details are
 * not here: those are released by an accepted invitation, not by a search.
 * There is no worker id, email, phone, or coordinate in the returned shape, and
 * nothing here is reachable that would let a caller join a card back to a person
 * beyond the name they chose to publish.
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

  // Read once for the whole result set rather than per card, so the saved state
  // on every star costs a single indexed query.
  const savedBySkill = await savedWorkersForSkill(employerId, requiredSkill);

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
      // Identity, for a worker who is `discoverable` — the flag is applied in the
      // aggregation, so a card that reaches this point belongs to someone who
      // agreed to be found. An employer choosing between two workers who are
      // otherwise identical on paper needs to be able to tell them apart.
      displayName: metric.displayName,
      avatarUrl: metric.avatarUrl,
      // Whether this employer has already saved this worker for this skill, so the
      // star on the card reflects what is stored rather than resetting on reload.
      savedId: savedBySkill.get(metric.workerId) ?? null,
      // Only the verified count reaches an employer, and it already excludes
      // withheld records — `flagged` and `fraud_blocked` are not added in.
      //
      // Deliberately no separate count for either. They are different claims: a
      // `flagged` record is the engine withholding a confirmation pending a human,
      // and a `fraud_blocked` one is a person having upheld it. Publishing them as
      // a number against the worker would let an open question read as a settled
      // judgement, which is the conflation the review policy exists to prevent.
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

  // Enforced here, at the write, not merely displayed on a settings page: a
  // worker whose preference is `approved_only` is reachable only by accounts a
  // person has reviewed and approved. The refusal is generic so it does not
  // confirm a worker's privacy setting to an unapproved employer.
  const [workerProfile, employerProfile] = await Promise.all([
    db
      .select({ invitationPreference: profiles.invitationPreference })
      .from(profiles)
      .where(eq(profiles.userId, workerId))
      .limit(1),
    db
      .select({ organizationName: profiles.organizationName })
      .from(profiles)
      .where(eq(profiles.userId, employerId))
      .limit(1),
  ]);

  if (workerProfile[0]?.invitationPreference === 'approved_only') {
    const { status } = await getOwnApproval(employerId);
    if (status !== 'approved') {
      throw AppError.forbidden('This candidate is not accepting invitations from unapproved employers.');
    }
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
    await notifyOfferReceived(workerId, employerProfile[0]?.organizationName ?? null);
    return toSentOffer(row);
  }

  const inserted = await db
    .insert(directOffers)
    .values({ employerId, workerId, note: input.note ?? null, specId })
    .returning();

  await notifyOfferReceived(workerId, employerProfile[0]?.organizationName ?? null);

  return toSentOffer(one(inserted));
}

/**
 * The worker-facing "an invitation arrived" moment.
 *
 * The name disclosed is the organization name, the same single fact the worker
 * is shown on the invitations page; nothing else about the account is carried
 * into the notification.
 */
async function notifyOfferReceived(workerId: string, organizationName: string | null): Promise<void> {
  await createNotification(
    workerId,
    'offer_received',
    'New invitation',
    organizationName
      ? `${organizationName} invited you to connect.`
      : 'An employer invited you to connect.',
    '/invites',
  );
}

/**
 * The employer-facing "your invitation was answered" moment.
 *
 * Only an acceptance names the worker: identity flows one way and only after
 * agreement, so a decline stays "a candidate" and repeats nothing the employer
 * was not already entitled to. The write is fail-soft on purpose — the worker's
 * decision is already recorded, and a notification (or a database that has not
 * yet gained the newer kind labels) must not turn a successful answer into a
 * failure.
 */
async function notifyOfferResponse(
  employerId: string,
  workerId: string,
  accepted: boolean,
): Promise<void> {
  try {
    const name = accepted ? await loadWorkerName(workerId) : null;
    const who = name?.trim() || 'A candidate';

    await createNotification(
      employerId,
      accepted ? 'offer_accepted' : 'offer_declined',
      accepted ? 'Invitation accepted' : 'Invitation declined',
      accepted
        ? `${who} accepted your invitation. Their contact details are now available.`
        : 'A candidate declined your invitation.',
      '/employer/candidates',
    );
  } catch (error) {
    logger.warn('Offer response notification failed', {
      product: env.PRODUCT_NAME,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The worker's stored name, for an acceptance notification. Null when unset. */
async function loadWorkerName(workerId: string): Promise<string | null> {
  const rows = await db
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.userId, workerId))
    .limit(1);

  return rows[0]?.fullName ?? null;
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
    .select({
      id: directOffers.id,
      status: directOffers.status,
      employerId: directOffers.employerId,
    })
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

  await notifyOfferResponse(offer.employerId, workerId, response === 'accepted');

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

// ---------------------------------------------------------------------------
// Employer dashboard, accepted candidates, admin console
// ---------------------------------------------------------------------------

/**
 * The employer dashboard's headline numbers.
 *
 * Every count comes from the employer's own rows. The match counts recompute the
 * same aggregation a search runs — verified proofs per worker for a skill, then
 * the distance filter — so a number on the dashboard cannot describe a candidate
 * the search would not return. A saved search with no location on the employer's
 * profile simply skips the distance filter, exactly as an ad-hoc search does.
 */
export async function getEmployerOverview(employerId: string): Promise<EmployerOverviewResponse> {
  const [approval, sending, specs, offerCounts, employerProfile] = await Promise.all([
    getOwnApproval(employerId),
    getOfferSendingStatus(employerId),
    listSpecs(employerId),
    db
      .select({ status: directOffers.status, count: sql<number>`count(*)::int` })
      .from(directOffers)
      .where(eq(directOffers.employerId, employerId))
      .groupBy(directOffers.status),
    db
      .select({ locationGps: profiles.locationGps })
      .from(profiles)
      .where(eq(profiles.userId, employerId))
      .limit(1),
  ]);

  const counts = new Map(offerCounts.map((row) => [row.status, Number(row.count)]));
  const reference = parseCoordinate(employerProfile[0]?.locationGps ?? null);
  const matches = await matchCountsForSpecs(specs, reference);

  return {
    status: approval.status,
    note: approval.note,
    reviewedAt: approval.reviewedAt,
    sending,
    activeSearches: specs.filter((spec) => spec.isActive).length,
    pausedSearches: specs.filter((spec) => !spec.isActive).length,
    pendingInvites: counts.get('pending') ?? 0,
    acceptedCandidates: counts.get('accepted') ?? 0,
    declinedInvites: counts.get('declined') ?? 0,
    totalMatches: matches.reduce((sum, match) => sum + match.matchCount, 0),
    matches,
  };
}

/**
 * How many candidates each saved search currently matches.
 *
 * Runs per spec rather than once for the union of skills, because a spec carries
 * its own proof threshold and radius and the count on screen has to be the count
 * that spec would return.
 */
async function matchCountsForSpecs(
  specs: CapabilitySpec[],
  reference: Coordinate | null,
): Promise<SpecMatchCount[]> {
  return Promise.all(
    specs.map(async (spec) => {
      const metrics = await aggregateCandidateMetrics(spec.requiredSkill, spec.minProofThreshold);
      if (!reference || metrics.length === 0) {
        return {
          specId: spec.id,
          requiredSkill: spec.requiredSkill,
          isActive: spec.isActive,
          matchCount: metrics.length,
        };
      }

      const locations = await readWorkerLocations(metrics.map((metric) => metric.workerId));
      const distances = measureDistances(metrics, locations, reference);
      const matchCount = metrics.filter((metric) => {
        const distanceKm = distances.get(metric.workerId);
        // As in search: only a measured distance can fail the radius. A worker who
        // shared no location is unknown, not far, and is counted rather than hidden.
        return distanceKm === undefined || distanceKm <= spec.maxDistanceKm;
      }).length;

      return {
        specId: spec.id,
        requiredSkill: spec.requiredSkill,
        isActive: spec.isActive,
        matchCount,
      };
    }),
  );
}

/**
 * Candidates whose invitation this employer accepted.
 *
 * Only accepted rows are read, and only for the employer on the offer. Contact
 * details are the thing acceptance buys, so they are read for exactly the workers
 * who said yes and for nobody else.
 */
export async function listAcceptedCandidates(employerId: string): Promise<AcceptedCandidate[]> {
  const rows = await db
    .select({
      offerId: directOffers.id,
      workerId: directOffers.workerId,
      note: directOffers.note,
      respondedAt: directOffers.respondedAt,
      fullName: profiles.fullName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(directOffers)
    .leftJoin(profiles, eq(profiles.userId, directOffers.workerId))
    .where(and(eq(directOffers.employerId, employerId), eq(directOffers.status, 'accepted')))
    .orderBy(desc(directOffers.respondedAt), desc(directOffers.createdAt));

  const contacts = await readAcceptedContacts(rows.map((row) => row.workerId));

  return rows.map((row) => {
    const contact = contacts.get(row.workerId);
    return {
      offerId: row.offerId,
      workerId: row.workerId,
      fullName: row.fullName,
      avatarUrl: row.avatarUrl,
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
      note: row.note,
      acceptedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
    };
  });
}

/**
 * The accepted workers' email and phone, from Supabase Auth.
 *
 * Email and phone live in Auth, not `profiles`, and only an accepted candidate
 * has agreed to be contacted. Each lookup is for a worker id the employer was
 * already granted by an accepted invitation, so this is correspondence, not a
 * directory read. A provider failure degrades that one candidate's contact to
 * null rather than failing the whole page, and nothing identifying is logged.
 */
async function readAcceptedContacts(
  workerIds: string[],
): Promise<Map<string, { email: string | null; phone: string | null }>> {
  const contacts = new Map<string, { email: string | null; phone: string | null }>();
  const unique = [...new Set(workerIds)];

  await Promise.all(
    unique.map(async (workerId) => {
      try {
        const { data, error } = await supabaseAdmin.auth.admin.getUserById(workerId);
        if (error || !data.user) return;
        contacts.set(workerId, {
          email: data.user.email ?? null,
          phone: data.user.phone ?? null,
        });
      } catch (error) {
        logger.warn('Could not read an accepted candidate contact', {
          product: env.PRODUCT_NAME,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );

  return contacts;
}

/**
 * Every employer account, for the admin approval console.
 *
 * Ordered so the queue is the first thing an administrator sees: pending first,
 * then oldest first within a status. Reviewers are deliberately not joined in —
 * the console shows the account under review and nothing about who else has
 * touched it.
 */
export async function listEmployersForAdmin(): Promise<AdminEmployerListItem[]> {
  const rows = await db
    .select({
      employerId: users.id,
      organizationName: profiles.organizationName,
      contactName: profiles.fullName,
      status: employerApprovals.status,
      note: employerApprovals.note,
      reviewedAt: employerApprovals.reviewedAt,
      registeredAt: users.createdAt,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .leftJoin(employerApprovals, eq(employerApprovals.employerId, users.id))
    .where(eq(users.role, 'employer'))
    .orderBy(asc(users.createdAt));

  const priority: Record<EmployerVerificationStatus, number> = {
    pending: 0,
    approved: 1,
    rejected: 2,
  };

  return rows
    .map((row) => ({
      employerId: row.employerId,
      organizationName: row.organizationName,
      contactName: row.contactName,
      status: row.status ?? 'pending',
      note: row.note,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      registeredAt: row.registeredAt.toISOString(),
    }))
    .sort((a, b) => priority[a.status] - priority[b.status]);
}

export type { CandidateMetric };