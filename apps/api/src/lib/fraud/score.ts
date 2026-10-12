/**
 * Combines the individual trust signals into one score and one decision.
 *
 * The score runs 0 (suspicious) to 1 (well supported). Two properties matter
 * more than the exact arithmetic:
 *
 * * **Missing evidence is neutral.** A signal that could not be evaluated
 *   contributes nothing, in either direction. Otherwise a client who declines
 *   geolocation would be scored as suspicious, and anyone could defeat the whole
 *   engine by withholding data.
 * * **Only a confirmed endorsement can be blocked.** A rejection is a client
 *   saying the work did not happen. It is not evidence of fraud, so it is never
 *   scored and never blocked, whatever the other signals say.
 *
 * The weights are deliberately unequal. Proximity is the strongest signal
 * because it is the only one grounded in an independent physical fact. Collusion
 * and media provenance are weaker: both rest on metadata a motivated party
 * controls, and both are heuristics on data that is thin this early.
 */
import { AppError } from '../errors.js';
import { NEUTRAL_WEIGHT as NEUTRAL_COLLUSION_WEIGHT } from './collusion.js';
import type { MediaSignals } from '../media-scrub.js';
import type { ProximityResult } from './proximity.js';
import type { CollusionAssessment } from './collusion.js';

export type Verdict = 'counted' | 'flagged' | 'blocked';

export interface ScoreInput {
  response: 'confirmed' | 'rejected';
  proximity: ProximityResult;
  collusion: CollusionAssessment;
  media: MediaSignals | null;
  /** False when no capture time was available to compare against. */
  captureTimeConflict: boolean;
}

export interface FraudAssessment {
  /** 0..1. Null when the response was a rejection. */
  score: number | null;
  verdict: Verdict;
  /** One line per signal, stored so the decision is explainable. */
  reasons: string[];
  /** The per-signal breakdown behind the score. */
  detail: Record<string, unknown>;
}

export interface ScoreThresholds {
  /** Proximity distance in km still treated as the same site. */
  proximityKm: number;
  /** Score at or below which a confirmed proof is blocked. */
  blockBelow: number;
}

export const DEFAULT_THRESHOLDS: ScoreThresholds = {
  proximityKm: 2,
  // Generous. At this stage a false block costs an honest worker a real
  // verification, which is worse than letting a mediocre case through, so the
  // gate only fires when several signals agree.
  blockBelow: 0.25,
};

/**
 * How many independent families of evidence were adverse, and how many the
 * engine used to require.
 *
 * Kept because it is the honest record of the policy change: a block used to need
 * two of these, and no longer does, because two weak signals agreeing is not
 * corroboration. The stored breakdown now records `adverseSignalGroups` for the
 * reviewer instead of using it as the gate.
 */
export const MIN_INDEPENDENT_SIGNALS_FOR_BLOCK = 2;

/**
 * Per-signal contributions, each in 0..1 where 1 is fully trustworthy.
 *
 * Exported so the unit assertions can pin the weights rather than re-deriving
 * them from the combined score, which would make a weight change invisible.
 */
const WEIGHTS = {
  proximity: 0.5,
  collusion: 0.3,
  media: 0.2,
} as const;

/**
 * Proximity sub-score.
 *
 * `within` scores full marks and `unavailable` is exactly neutral, because an
 * absent location is an absence of evidence and must not read as either a pass
 * or a failure.
 *
 * `outside` scales from just under neutral down to zero, reaching zero at ten
 * times the threshold. An earlier version bottomed out at 0.5, which meant a
 * client confirming from another continent scored 50% on the strongest signal in
 * the system — enough on its own to carry a colluded endorsement over the block
 * threshold, which is precisely the case the check exists to catch.
 */
export function proximityScore(proximity: ProximityResult, thresholdKm: number): number {
  if (proximity.status === 'within') return 1;
  if (proximity.status === 'unavailable' || proximity.distanceKm === null) return 0.5;

  const ratio = proximity.distanceKm / Math.max(thresholdKm, 0.001);
  const over = Math.max(0, ratio - 1);
  // Zero at the threshold, one at ten times it.
  const penalty = Math.min(1, over / 9);

  return clamp(0.5 - penalty * 0.5, 0, 0.5);
}

/**
 * Media sub-score.
 *
 * Starts at neutral and moves on findings. Note what this does not claim: a
 * clean, plausibly-timestamped photo is not evidence of authenticity, so it can
 * never raise the score above neutral on its own. It can only lower it. The
 * absence of a camera signature is mildly suspicious because capture devices
 * reliably write one; nothing here claims to detect generated images.
 */
export function mediaScore(media: MediaSignals | null, captureTimeConflict: boolean): number {
  if (!media) return 0.5;

  let score = 0.5;
  let anyEvaluated = false;

  if (media.hasCameraSignature !== null) {
    anyEvaluated = true;
    if (!media.hasCameraSignature) score -= 0.1;
  }

  if (media.timestampPlausible !== null) {
    anyEvaluated = true;
    if (!media.timestampPlausible) score -= 0.1;
  }

  if (media.encoderKnown !== null) {
    anyEvaluated = true;
    if (!media.encoderKnown) score -= 0.15;
  }

  // Deliberately a further penalty rather than a substitute for the timestamp
  // check: a future capture time is a contradiction, not a weak signal.
  if (captureTimeConflict) score -= 0.2;

  // Nothing was assessable, so there is no evidence either way.
  if (!anyEvaluated && !captureTimeConflict) return 0.5;

  return clamp(score, 0, 1);
}

export function assess(input: ScoreInput, thresholds: ScoreThresholds = DEFAULT_THRESHOLDS): FraudAssessment {
  const detail: Record<string, unknown> = {
    proximity: {
      status: input.proximity.status,
      distanceKm: input.proximity.distanceKm,
      thresholdKm: thresholds.proximityKm,
    },
    collusion: {
      evaluated: input.collusion.evaluated,
      weight: input.collusion.weight,
      facts: input.collusion.facts,
      findings: input.collusion.findings,
    },
    media: input.media,
    captureTimeConflict: input.captureTimeConflict,
  };

  // A rejection is the client stating the work did not happen. That is not
  // fraud, and scoring it would let a malicious worker farm rejections from
  // colluding clients to generate free dispute traffic against real workers.
  if (input.response === 'rejected') {
    return {
      score: null,
      verdict: 'counted',
      reasons: ['Client reported the work as not completed. Not scored as fraud.'],
      detail,
    };
  }

  const parts = [
    { weight: WEIGHTS.proximity, score: proximityScore(input.proximity, thresholds.proximityKm) },
    { weight: WEIGHTS.collusion, score: input.collusion.weight },
    { weight: WEIGHTS.media, score: mediaScore(input.media, input.captureTimeConflict) },
  ];

  const total = parts.reduce((sum, p) => sum + p.weight * p.score, 0);
  const score = Math.round(clamp(total, 0, 1) * 1000) / 1000;

  const reasons: string[] = [];
  if (input.proximity.status === 'within') reasons.push(input.proximity.detail);
  if (input.proximity.status === 'outside') reasons.push(input.proximity.detail);
  if (input.proximity.status === 'unavailable') reasons.push(input.proximity.detail);
  for (const finding of input.collusion.findings) reasons.push(finding);
  if (input.media && mediaScore(input.media, input.captureTimeConflict) < 0.5) {
    reasons.push('The uploaded file carried fewer capture details than a camera normally writes.');
  }
  if (input.captureTimeConflict) {
    reasons.push('The file claimed to be captured after it was submitted.');
  }
  if (reasons.length === 0) reasons.push('No adverse signals were found.');

  const groups = adverseSignalGroups(input);

  return {
    score,
    verdict: verdictFor({ score, groups, blockBelow: thresholds.blockBelow }),
    reasons,
    detail: {
      ...detail,
      // Reported for explanation, not for the verdict. The engine no longer
      // requires a number of corroborating families — it withholds anything at
      // or below the threshold — but how much of the score came from how many
      // sources is exactly what a reviewer needs to judge whether the decision
      // was fair, so it stays in the stored breakdown.
      corroboration: {
        adverseSignalGroups: groups,
        /**
         * Kept, and now informational only. A block used to require this many
         * independent families; it no longer does, because two weak signals
         * agreeing is not corroboration. The constant is retained so the stored
         * detail records the policy that was in force when the row was written,
         * which is what makes an old row still readable.
         */
        formerlyRequiredForBlock: MIN_INDEPENDENT_SIGNALS_FOR_BLOCK,
      },
    },
  };
}

/**
 * How many independent families of evidence are against this endorsement.
 *
 * Three families exist: where the verifier says they were (proximity), who else
 * has confirmed this worker (collusion), and what the uploaded file itself says
 * (media).
 *
 * Collusion counts only when its weight actually fell below neutral. A verifier
 * who was not identified produces an explanatory finding — "network diversity
 * could not be assessed" — which records an *absence* of evidence and must never
 * be counted against the worker. Counting findings here would have made every
 * anonymous confirmation corroborate an attack.
 *
 * Reported for explanation rather than for the verdict: after the three-way
 * outcome policy, the count no longer decides anything, because the families are
 * not equally trustworthy and agreement between weak signals proves nothing. It
 * stays in the stored breakdown so a reviewer can see how much of the score came
 * from how many sources.
 */
function adverseSignalGroups(input: ScoreInput): number {
  let groups = 0;
  if (input.proximity.status === 'outside') groups += 1;
  if (input.collusion.weight < NEUTRAL_COLLUSION_WEIGHT) groups += 1;
  if (mediaScore(input.media, input.captureTimeConflict) < 0.5) groups += 1;
  return groups;
}

/**
 * Applies the verdict, and it is the only place a proof is ever withheld.
 *
 * A low score alone is **not** sufficient, and neither are two adverse families.
 * This is the correction of a demonstrated defect rather than a tuning change.
 *
 * The proximity signal is the heaviest in the engine at 50%, and it is read from
 * a field the token holder supplies in the same request as their answer. A holder
 * who declared a location on the far side of the planet drove proximity to zero,
 * and because every other signal was neutral for a well-formed upload, that one
 * fabricated field put the total exactly on the threshold. The proof was marked
 * `fraud_blocked` — permanently, with no path back, and visible to employers as a
 * fraud count on the worker's record.
 *
 * The second family did not save it either. **The families are not equally
 * trustworthy, and two weak signals agreeing is not two strong signals.** Media
 * provenance is a consistency check on a file that ordinary re-compression
 * routinely strips; collusion is a shape a legitimate site supervisor produces by
 * working one site all week; proximity is a self-declaration. Each can be true of
 * an honest worker, and each can be arranged by someone aiming to make a
 * competitor look bad.
 *
 * So the outcome, and the mapping is deliberately asymmetric:
 *
 * * `counted` — above the threshold. The ordinary case.
 * * `flagged` — at or below it. The record is **withheld from counting as proof**
 *   and queued for a human, and it is explicitly *not* an accusation of fraud.
 *   Withholding the badge is the entire protective effect: the record stops
 *   helping the worker and stops being held against them.
 * * `blocked` — never reached automatically. `fraud_blocked` is reserved for a
 *   human who has read the evidence and agreed, and is set by the admin review
 *   path rather than by this engine.
 *
 * That last point is the substantive decision. An automated heuristic over weak
 * signals cannot establish fraud, and a system that lets it try will eventually
 * brand an honest worker. The engine decides what may be *trusted*, not who is a
 * liar — so it withholds, and a person decides.
 */
function verdictFor(input: { score: number; groups: number; blockBelow: number }): Verdict {
  if (input.score > input.blockBelow) return 'counted';
  return 'flagged';
}

/**
 * Applies the verdict to a proof's status.
 *
 * Kept separate from `assess` so the pure scoring stays testable without a
 * database, and so the one place that maps a verdict onto an enum is obvious.
 *
 * An automated decision can only ever produce `flagged`. `fraud_blocked` is
 * reachable only through the admin review path, which requires a person, an
 * identity, and a recorded reason.
 */
export function proofStatusFor(assessment: FraudAssessment): 'verified' | 'flagged' {
  return assessment.verdict === 'flagged' ? 'flagged' : 'verified';
}

/**
 * One sentence, safe to show a worker, naming what raised a record.
 *
 * Built from the *kinds* of signal that fired and never from their values. A
 * worker can act on "the file you uploaded carried no capture details"; they can
 * do nothing with "your score was 0.23 against a threshold of 0.25", and
 * publishing the threshold would tell anyone with a grudge how far to push.
 *
 * Exported because the same sentence is stored, returned to the worker, and shown
 * to an admin reviewing an appeal — three surfaces that must not drift apart.
 */
export function flagReasonFor(assessment: FraudAssessment): string {
  const detail = assessment.detail as Record<string, unknown>;
  const proximity = detail.proximity as { status?: string } | undefined;
  const collusion = detail.collusion as { findings?: string[]; weight?: number } | undefined;
  const media = detail.media as Parameters<typeof mediaScore>[0] | undefined;
  const conflict = Boolean(detail.captureTimeConflict);

  const kinds: string[] = [];
  if (proximity?.status === 'outside') {
    kinds.push('the confirmation came from a different place than the job was logged');
  }
  if ((collusion?.weight ?? 0.5) < NEUTRAL_COLLUSION_WEIGHT) {
    kinds.push('the same client has confirmed several proofs for one worker');
  }
  if (mediaScore(media ?? null, conflict) < 0.5) {
    kinds.push('the uploaded file carried fewer capture details than a camera normally writes');
  }

  if (kinds.length === 0) {
    return 'This record is held for review. It is not a finding of fraud, and you can ask for it to be looked at again.';
  }

  return `Held for review: ${kinds.join('; ')}. This is not a finding of fraud, and you can ask for it to be looked at again.`;
}

/** Guards against a threshold being configured into an accidental always-block. */
export function assertUsableThresholds(thresholds: ScoreThresholds): void {
  if (!(thresholds.proximityKm > 0)) {
    throw AppError.internal('The proximity threshold must be greater than zero.');
  }
  if (!(thresholds.blockBelow > 0 && thresholds.blockBelow < 1)) {
    throw AppError.internal('The fraud block threshold must fall strictly between zero and one.');
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}