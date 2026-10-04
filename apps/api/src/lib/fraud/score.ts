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
import type { MediaSignals } from '../media-scrub.js';
import type { ProximityResult } from './proximity.js';
import type { CollusionAssessment } from './collusion.js';

export type Verdict = 'counted' | 'blocked';

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

  return {
    score,
    verdict: score <= thresholds.blockBelow ? 'blocked' : 'counted',
    reasons,
    detail,
  };
}

/**
 * Applies the verdict to a proof's status.
 *
 * Kept separate from `assess` so the pure scoring stays testable without a
 * database, and so the one place that maps a score onto an enum is obvious.
 */
export function proofStatusFor(assessment: FraudAssessment): 'verified' | 'fraud_blocked' {
  return assessment.verdict === 'blocked' ? 'fraud_blocked' : 'verified';
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