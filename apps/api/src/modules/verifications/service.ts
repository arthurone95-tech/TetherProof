import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { ERROR_CODES } from '@tetherproof/shared';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { capabilityBlocks, verifications, workProofLogs } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { assessCollusion, type Endorsement } from '../../lib/fraud/collusion.js';
import { evaluateProximity } from '../../lib/fraud/proximity.js';
import {
  assertUsableThresholds,
  assess,
  proofStatusFor,
  type FraudAssessment,
} from '../../lib/fraud/score.js';
import type { MediaSignals } from '../../lib/media-scrub.js';
import { hashVerificationToken } from '../../lib/token.js';
import type { ConfirmInput } from './schemas.js';

/**
 * Everything a client sees from an SMS/WhatsApp link.
 *
 * Deliberately excludes worker identity, verifier phone number, GPS telemetry,
 * fraud score, and media URLs, which would leak PII or let a link holder probe
 * the anti-fraud system.
 */
export interface VerificationSummary {
  skillTag: string | null;
  taskSummary: string;
  status: 'awaiting_response' | 'confirmed' | 'rejected';
  expiresAt: string;
  respondedAt: string | null;
}

async function loadByTokenHash(tokenHash: string) {
  const rows = await db
    .select({
      id: verifications.id,
      response: verifications.response,
      expiresAt: verifications.expiresAt,
      completedAt: verifications.completedAt,
      verifierPhoneHash: verifications.verifierPhoneHash,
      workProofId: workProofLogs.id,
      workerId: workProofLogs.workerId,
      description: workProofLogs.description,
      submissionGps: workProofLogs.submissionGps,
      createdAt: workProofLogs.createdAt,
      anonymisedAt: workProofLogs.anonymisedAt,
      skillTag: capabilityBlocks.skillTag,
    })
    .from(verifications)
    .innerJoin(workProofLogs, eq(verifications.workProofId, workProofLogs.id))
    .leftJoin(capabilityBlocks, eq(workProofLogs.capabilityBlockId, capabilityBlocks.id))
    .where(eq(verifications.tokenHash, tokenHash))
    .limit(1);

  return rows[0];
}

type LoadedVerification = Awaited<ReturnType<typeof loadByTokenHash>>;

/**
 * A verification whose proof is still attached to a live worker.
 *
 * Named rather than inlined so `assertUsable` and its callers cannot disagree
 * about the shape. `workerId` is non-null here because every caller needs it as an
 * identity: the collusion graph keys on it, and a null would be a node standing in
 * for every deleted worker at once.
 */
type UsableVerification = NonNullable<LoadedVerification> & { workerId: string };

function assertUsable(record: LoadedVerification): asserts record is UsableVerification {
  if (!record) {
    throw new AppError({
      code: ERROR_CODES.VERIFICATION_TOKEN_INVALID,
      message: 'This verification link is not valid.',
      status: 404,
    });
  }

  // A proof whose worker has deleted their account is retained but closed.
  //
  // The link was dispatched to a client while the worker was on the platform, and
  // answering it now would write a verification outcome, a fraud score, and a
  // timestamp onto a record the worker asked to be released from them. The record
  // survives anonymisation so that the counts it contributes to stay true; letting
  // a year-old link keep mutating it would undermine exactly that.
  //
  // The refusal is reported as a spent link rather than an error about the
  // worker: the client is not the reason this cannot be answered, and saying
  // otherwise would tell a third party that an account was deleted.
  if (record.anonymisedAt !== null) {
    throw new AppError({
      code: ERROR_CODES.VERIFICATION_TOKEN_CONSUMED,
      message: 'This verification link is no longer active.',
      status: 409,
    });
  }

  if (record.response !== 'none') {
    throw new AppError({
      code: ERROR_CODES.VERIFICATION_TOKEN_CONSUMED,
      message: 'This verification link has already been used.',
      status: 409,
    });
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    throw new AppError({
      code: ERROR_CODES.VERIFICATION_TOKEN_EXPIRED,
      message: 'This verification link has expired. Ask the worker to send a new one.',
      status: 410,
    });
  }
}

function toSummary(record: NonNullable<LoadedVerification>): VerificationSummary {
  return {
    skillTag: record.skillTag,
    taskSummary: record.description,
    status: record.response === 'none' ? 'awaiting_response' : record.response,
    expiresAt: record.expiresAt.toISOString(),
    respondedAt: record.completedAt ? record.completedAt.toISOString() : null,
  };
}

/** Public read of a verification link. Safe to call without authentication. */
export async function getVerificationSummary(rawToken: string): Promise<VerificationSummary> {
  const record = await loadByTokenHash(hashVerificationToken(rawToken));
  if (!record) {
    throw new AppError({
      code: ERROR_CODES.VERIFICATION_TOKEN_INVALID,
      message: 'This verification link is not valid.',
      status: 404,
    });
  }
  return toSummary(record);
}

/**
 * Every completed endorsement by an identifiable verifier, except the one being
 * scored.
 *
 * The exclusion is load-bearing. Including the row under assessment would make
 * a verifier's very first approval look like a second one, which is exactly the
 * signal the isolated-verifier check looks for, so every new verifier would be
 * treated as a returning one.
 *
 * Bounded deliberately. A growing network would otherwise mean an unbounded read
 * on the hot path of every confirmation, and the weights only distinguish "a few"
 * from "many" anyway.
 */
const COLLUSION_HISTORY_LIMIT = 1000;

async function loadEndorsementHistory(excludeVerificationId: string): Promise<Endorsement[]> {
  const rows = await db
    .select({
      workerId: workProofLogs.workerId,
      verifierKey: verifications.verifierPhoneHash,
    })
    .from(verifications)
    .innerJoin(workProofLogs, eq(verifications.workProofId, workProofLogs.id))
    .where(
      and(
        isNotNull(verifications.verifierPhoneHash),
        // Rejections are excluded: a client saying work did not happen is not an
        // endorsement, and letting them count as one would inflate a colluding
        // verifier's apparent reach.
        eq(verifications.response, 'confirmed'),
        ne(verifications.id, excludeVerificationId),
        // Anonymised proofs are excluded, because a null worker id would collapse
        // every deleted worker into a single node of the graph. That node would
        // make a verifier look more diverse than they are, so the filter would
        // fail open on exactly the rings it exists to catch.
        //
        // The limit of this choice is worth stating: a verifier who built their
        // apparent reach through workers who have since deleted their accounts
        // now looks narrower than they are. Correcting for that needs the
        // approvals counted per distinct deleted account, which the retention
        // policy deliberately does not keep.
        isNotNull(workProofLogs.workerId),
      ),
    )
    .limit(COLLUSION_HISTORY_LIMIT);

  // `isNotNull` above is a runtime filter, not a type-level one: drizzle 0.45
  // returns a plain `SQL` from it, so the compiler still sees `string | null`
  // here. The guard is kept rather than papered over with a cast so that this
  // function cannot hand the graph a null node even if the query is edited later.
  return rows.flatMap((row) =>
    row.workerId === null ? [] : [{ workerId: row.workerId, verifierKey: row.verifierKey }],
  );
}

/** Provenance signals for a proof, or null if the row predates this feature. */
async function loadMediaSignals(workProofId: string): Promise<MediaSignals | null> {
  const rows = await db
    .select({
      evaluated: workProofLogs.mediaSignalEvaluated,
      hasCameraSignature: workProofLogs.mediaHasCameraSignature,
      timestampPlausible: workProofLogs.mediaTimestampPlausible,
      encoderKnown: workProofLogs.mediaEncoderKnown,
    })
    .from(workProofLogs)
    .where(eq(workProofLogs.id, workProofId))
    .limit(1);

  const row = rows[0];
  if (!row?.evaluated) return null;

  return {
    hasCameraSignature: row.hasCameraSignature,
    timestampPlausible: row.timestampPlausible,
    encoderKnown: row.encoderKnown,
  };
}

/**
 * Runs the trust engine over one completed endorsement.
 *
 * Split out from `submitVerification` because it is pure of the write: the score
 * is computed first, and only then applied. The order is what stops a
 * `fraud_blocked` verdict from overwriting itself with `verified` a moment later.
 */
async function evaluateTrust(
  record: UsableVerification,
  response: 'confirmed' | 'rejected',
  verifierGps: string | null,
): Promise<FraudAssessment> {
  const thresholds = {
    proximityKm: env.FRAUD_PROXIMITY_KM,
    blockBelow: env.FRAUD_BLOCK_BELOW,
  };
  assertUsableThresholds(thresholds);

  const [history, media] = await Promise.all([
    loadEndorsementHistory(record.id),
    loadMediaSignals(record.workProofId),
  ]);

  const proximity = evaluateProximity(
    record.submissionGps,
    verifierGps,
    thresholds.proximityKm,
  );

  const collusion = assessCollusion(
    { workerId: record.workerId, verifierKey: record.verifierPhoneHash },
    history,
  );

  return assess(
    {
      response,
      proximity,
      collusion,
      media,
      // The capture timestamp was discarded by the scrubber, so the engine cannot
      // re-derive this. The provenance column already records the verdict as a
      // boolean, and an implausible capture time is the case that matters.
      captureTimeConflict: media?.timestampPlausible === false,
    },
    thresholds,
  );
}

/**
 * Records the client's answer, scores it, and applies the verdict.
 *
 * The transition from `none` to a terminal response happens inside a single
 * conditional UPDATE, so two simultaneous taps cannot both be accepted.
 */
export async function submitVerification(
  rawToken: string,
  input: ConfirmInput,
): Promise<{
  status: 'confirmed' | 'rejected';
  skillTag: string | null;
  fraudScore: number | null;
  verificationStatus: 'verified' | 'rejected' | 'fraud_blocked';
}> {
  const tokenHash = hashVerificationToken(rawToken);
  const record = await loadByTokenHash(tokenHash);
  assertUsable(record);

  const response = input.response;
  const verifierGps = input.verifierGps ?? null;

  // Scored before the write, so the verdict is known when the proof status is
  // set. Reversing these two would write `verified` and then immediately
  // overwrite it, leaving a blocked proof counted as verified in between.
  const assessment = await evaluateTrust(record, response, verifierGps);

  const completedAt = new Date();
  const updated = await db
    .update(verifications)
    .set({
      response,
      verifierGps,
      completedAt,
      proximityKm: assessment.detail.proximity
        ? (assessment.detail.proximity as { distanceKm: number | null }).distanceKm
        : null,
      proximityStatus: proximityStatusFrom(assessment),
      fraudScore: assessment.score,
      fraudScoreDetail: assessment.detail,
    })
    .where(and(eq(verifications.tokenHash, tokenHash), eq(verifications.response, 'none')))
    .returning({ id: verifications.id });

  if (updated.length === 0) {
    throw new AppError({
      code: ERROR_CODES.VERIFICATION_TOKEN_CONSUMED,
      message: 'This verification link has already been used.',
      status: 409,
    });
  }

  // A rejection is reported as a rejection. A confirmed endorsement that trips
  // the gate is reported as confirmed to the client, because the client did
  // confirm it, but the proof is blocked from counting as verified.
  const proofStatus =
    response === 'rejected' ? 'rejected' : proofStatusFor(assessment);

  await db
    .update(workProofLogs)
    .set({ verificationStatus: proofStatus })
    .where(eq(workProofLogs.id, record.workProofId));

  return {
    status: response,
    skillTag: record.skillTag,
    fraudScore: assessment.score,
    verificationStatus: proofStatus,
  };
}

/** Pulls the proximity enum value back out of the stored detail blob. */
function proximityStatusFrom(assessment: FraudAssessment): 'within' | 'outside' | 'unavailable' {
  const detail = assessment.detail.proximity as { status?: string } | undefined;
  if (detail?.status === 'within' || detail?.status === 'outside') return detail.status;
  return 'unavailable';
}
