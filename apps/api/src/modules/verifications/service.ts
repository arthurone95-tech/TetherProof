import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { ERROR_CODES } from '@tetherproof/shared';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { capabilityBlocks, profiles, verifications, workProofLogs } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { assessCollusion, type Endorsement } from '../../lib/fraud/collusion.js';
import { evaluateProximity } from '../../lib/fraud/proximity.js';
import {
  assertUsableThresholds,
  assess,
  flagReasonFor,
  proofStatusFor,
  type FraudAssessment,
} from '../../lib/fraud/score.js';
import type { MediaSignals } from '../../lib/media-scrub.js';
import { createNotification } from '../../lib/notifications.js';
import { createSignedMediaUrl, mediaKindFromPath } from '../../lib/storage.js';
import { hashVerificationToken, hashVerifierKey } from '../../lib/token.js';
import { normalizeVerifierKey } from '../../lib/verifier-key.js';
import type { ConfirmInput } from './schemas.js';

/**
 * Everything a client sees from an SMS/WhatsApp link.
 *
 * Deliberately excludes worker identity, verifier phone number, GPS telemetry,
 * fraud score, and media URLs, which would leak PII or let a link holder probe
 * the anti-fraud system.
 */
/**
 * Everything a client sees from a link they were sent.
 *
 * Deliberately excludes worker identity, verifier phone number, GPS telemetry,
 * fraud score, and the storage path of the media, none of which the person
 * answering is entitled to. The evidence itself *is* included, because a
 * confirmation asked for on the strength of a photograph is not a confirmation
 * if the photograph cannot be seen — but it arrives as a short-lived signed URL,
 * minted here at read time from a private bucket, so the link holder never
 * receives a storage credential or a reusable object address.
 */
export interface VerificationSummary {
  skillTag: string | null;
  /** The worker's own words about the job, shown verbatim so it can be checked. */
  taskSummary: string;
  status: 'awaiting_response' | 'confirmed' | 'rejected';
  expiresAt: string;
  respondedAt: string | null;
  /** The proficiency tier the worker claims for this skill, 1 to 3. */
  skillLevel: number | null;
  /** When the worker logged the work, so a stale claim is recognisable. */
  loggedAt: string;
  /** Whether the evidence is a photograph or a recording. */
  mediaKind: 'image' | 'audio' | null;
  /** Short-lived signed URL for the evidence, or null when it cannot be produced. */
  mediaUrl: string | null;
  /**
   * True when evidence exists but could not be signed for this request.
   *
   * Distinct from "no evidence", so the page can say the file is unavailable
   * rather than implying the worker submitted nothing.
   */
  mediaUnavailable: boolean;
  /**
   * Who did the work, when the worker allows it to be shown here.
   *
   * Both are null when the worker set `showNameOnVerificationLink` to false, when
   * they have no profile row, or when their account has been anonymised — all three
   * arrive at the page as the same absence, so there is no way to tell a private
   * worker from a nameless one.
   */
  workerName: string | null;
  workerAvatarUrl: string | null;
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
      skillLevel: capabilityBlocks.skillLevel,
      mediaUrl: workProofLogs.mediaUrl,
      // Read here but shaped at the edge, never returned raw. A confirmation link
      // is forwardable, so what leaves this module for the page is only the name
      // and photo, and only when the worker has not opted out of being named on
      // it. The flag is carried rather than applied in SQL so that a worker who
      // switched it off is anonymous for the same reason as one who never had a
      // profile at all — the page cannot tell the two apart, and neither can a
      // caller.
      workerFullName: profiles.fullName,
      workerAvatarUrl: profiles.avatarUrl,
      showNameOnVerificationLink: profiles.showNameOnVerificationLink,
    })
    .from(verifications)
    .innerJoin(workProofLogs, eq(verifications.workProofId, workProofLogs.id))
    .leftJoin(capabilityBlocks, eq(workProofLogs.capabilityBlockId, capabilityBlocks.id))
    .leftJoin(profiles, eq(profiles.userId, workProofLogs.workerId))
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

/**
 * Shapes a row into the summary the verification page renders.
 *
 * The evidence is signed here rather than stored as an address. `mediaUrl` in the
 * database is a bucket-relative object path, which is not a URL anyone can open;
 * minting a short-lived signed one per request is what lets a client who was sent
 * the link actually look at the photograph, without the bucket becoming public and
 * without a storage credential ever leaving this process.
 *
 * A signing failure is deliberately not an error. The decision itself is still
 * answerable without the picture, so refusing to show the page because storage had
 * a bad minute would take away the recipient's one chance to record it. The page
 * says the file is unavailable and the answer still stands.
 */
async function toSummary(record: NonNullable<LoadedVerification>): Promise<VerificationSummary> {
  let mediaUrl: string | null = null;
  let mediaUnavailable = false;

  if (record.mediaUrl) {
    try {
      mediaUrl = await createSignedMediaUrl(record.mediaUrl);
    } catch {
      mediaUnavailable = true;
    }
  }

  return {
    skillTag: record.skillTag,
    taskSummary: record.description,
    status: record.response === 'none' ? 'awaiting_response' : record.response,
    expiresAt: record.expiresAt.toISOString(),
    respondedAt: record.completedAt ? record.completedAt.toISOString() : null,
    skillLevel: record.skillLevel,
    loggedAt: record.createdAt.toISOString(),
    mediaKind: record.mediaUrl ? mediaKindFromPath(record.mediaUrl) : null,
    mediaUrl,
    mediaUnavailable,
    // One decision, applied to both fields at once. Reading them separately would
    // let a future edit show the photo while withholding the name, which is the
    // combination that identifies someone with no stated reason.
    workerName: record.showNameOnVerificationLink ? record.workerFullName : null,
    workerAvatarUrl: record.showNameOnVerificationLink ? record.workerAvatarUrl : null,
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

  // Closed for the same reason `assertUsable` closes it on submission, and with
  // the same sentence, so a reader never sees an answerable form for a proof
  // that cannot be answered: the verifier would fill in an answer, press the
  // button, be refused, and "Try again" would bring the identical form back —
  // an endless retry against a state nothing can change.
  //
  // Spent and expired links are deliberately still shown. A spent one carries
  // the outcome, which is information the reader came for; an expired one can
  // be recognised from `expiresAt`. Only the deleted-worker case has nothing to
  // report and no way to say why, and reporting it at read time means it is
  // never reached. As on submission, the wording must not become a signal that
  // an account was deleted, so it is the wording for a spent link.
  if (record.anonymisedAt !== null) {
    throw new AppError({
      code: ERROR_CODES.VERIFICATION_TOKEN_CONSUMED,
      message: 'This verification link is no longer active.',
      status: 409,
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

/**
 * A verifier is identifiable either by the salted hash of a phone number supplied
 * at submission, or by the salted hash of a self-generated browser pseudonym sent
 * with the answer. Both live in the same column, which is why the history filter
 * tests the column for presence rather than for one particular source: the graph
 * does not care which mechanism identified the verifier, only that it was the
 * same one twice. See `lib/verifier-key.ts` for why the second mechanism exists
 * and what it cannot do.
 */
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
 * is computed first, and only then applied. The order is what stops a `flagged`
 * verdict from being overwritten with `verified` a moment later.
 */
async function evaluateTrust(
  record: UsableVerification,
  response: 'confirmed' | 'rejected',
  verifierGps: string | null,
  verifierKeyHash: string | null,
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

  // The pseudonym this answer arrived with, if any, is what identifies the
  // verifier for this decision. It is stored on the row below and read back here
  // so the graph and the stored record can never disagree about who answered.
  const collusion = assessCollusion(
    { workerId: record.workerId, verifierKey: verifierKeyHash ?? record.verifierPhoneHash },
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
  verificationStatus: 'verified' | 'rejected' | 'flagged';
  /** True when the platform is withholding the record despite this confirmation. */
  withheld: boolean;
  withheldReason: string | null;
}> {
  const tokenHash = hashVerificationToken(rawToken);
  const record = await loadByTokenHash(tokenHash);
  assertUsable(record);

  const response = input.response;
  const verifierGps = input.verifierGps ?? null;

  // The recipient's own browser pseudonym, if they chose to send one. Normalised
  // and hashed before it is written, exactly as a phone number would be, so the
  // column never holds a reversible value and a malformed header is simply absent
  // rather than stored.
  const deviceKey = normalizeVerifierKey(input.verifierKey);
  const verifierKeyHash = deviceKey ? hashVerifierKey(deviceKey) : null;

  // Scored before the write, so the verdict is known when the proof status is
  // set. Reversing these two would write `verified` and then immediately
  // overwrite it, leaving a blocked proof counted as verified in between.
  const assessment = await evaluateTrust(record, response, verifierGps, verifierKeyHash);

  const completedAt = new Date();
  const updated = await db
    .update(verifications)
    .set({
      response,
      verifierGps,
      completedAt,
      // Written only when the recipient supplied one, so the column stays null for
      // the anonymous answers it already covered — a null here means "this
      // verifier chose not to be recognised", which the engine reads as neutral
      // rather than as a finding.
      ...(verifierKeyHash ? { verifierPhoneHash: verifierKeyHash } : {}),
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

  // A rejection is reported as a rejection. A confirmed endorsement is reported
  // as confirmed, whatever the engine decided, because from the client's side they
  // did confirm it — and the client is told the withheld outcome too, so nobody
  // leaves the page believing the record is now trusted.
  const proofStatus =
    response === 'rejected' ? 'rejected' : proofStatusFor(assessment);

  await db
    .update(workProofLogs)
    .set({
      verificationStatus: proofStatus,
      // Written only when something was withheld, so an ordinary confirmation
      // leaves these null and a flagged record always carries both when it
      // happened and a sentence the worker is allowed to read.
      ...(proofStatus === 'flagged'
        ? { flaggedAt: new Date(), flagReason: flagReasonFor(assessment) }
        : {}),
    })
    .where(eq(workProofLogs.id, record.workProofId));

  // The verifier's decision and the platform's assessment of the record are two
  // different facts, and the worker is owed both.
  //
  // A confirmation the engine then withholds is still a confirmation: the client
  // did answer, and saying otherwise would misreport what happened. But telling
  // the worker only "a client confirmed your work" would hide that their record
  // is not counting — the exact failure that made `fraud_blocked` indefensible,
  // an undisclosed penalty the worker could neither see nor answer.
  await createNotification(
    record.workerId,
    response === 'confirmed' ? 'verification_confirmed' : 'verification_rejected',
    proofStatus === 'flagged'
      ? 'Work confirmed but held for review'
      : response === 'confirmed'
        ? 'Work verified'
        : 'Work not confirmed',
    proofStatus === 'flagged'
      ? `${record.skillTag ?? 'That skill'} — the client confirmed this work, and it is being held back from counting while it is reviewed. Nothing has been decided against you.`
      : `${record.skillTag ?? 'That skill'} — a client ${
          response === 'confirmed' ? 'confirmed' : 'did not confirm'
        } your work.`,
    `/logs/${record.workProofId}`,
  );

  return {
    status: response,
    skillTag: record.skillTag,
    fraudScore: assessment.score,
    // Narrowed for the client: a rejection is `rejected`, and a confirmed answer
    // is either counted or withheld. `fraud_blocked` is deliberately absent —
    // the engine cannot produce it, and a client is never told a record was ruled
    // fraudulent, because nobody has ruled on it.
    verificationStatus: proofStatus === 'rejected' ? 'rejected' : proofStatus,
    // The client is told the platform's assessment as well as their own answer, so
    // the page can never imply that tapping Confirm made the record trusted. A
    // withheld record is reported plainly rather than as a success.
    withheld: proofStatus === 'flagged',
    withheldReason: proofStatus === 'flagged' ? flagReasonFor(assessment) : null,
  };
}

/** Pulls the proximity enum value back out of the stored detail blob. */
function proximityStatusFrom(assessment: FraudAssessment): 'within' | 'outside' | 'unavailable' {
  const detail = assessment.detail.proximity as { status?: string } | undefined;
  if (detail?.status === 'within' || detail?.status === 'outside') return detail.status;
  return 'unavailable';
}
