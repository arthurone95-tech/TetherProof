/**
 * Proximity evaluation: Feature 2.3.
 *
 * Compares where the worker said the work happened with where the client was
 * when they tapped the link.
 *
 * The central discipline here is that a missing location is not a finding.
 * A client who declines to share geolocation, or taps from a desktop, or is on a
 * VPN, produces no signal at all. Treating that absence as either a pass or a
 * failure would let a privacy-respecting user be penalised, and would let an
 * attacker disable the check simply by withholding a location. `unavailable` is
 * a first-class outcome that the scorer reads as neutral.
 */
import { distanceKm, parseCoordinate } from '../geo.js';
import { proximityStatus } from '../../db/schema.js';

export interface ProximityResult {
  status: typeof proximityStatus.enumValues[number];
  /** Null whenever status is `unavailable`. */
  distanceKm: number | null;
  /**
   * A plain-language reason, stored so a blocked proof can be explained to the
   * worker without anyone reconstructing the calculation by hand.
   */
  detail: string;
}

/**
 * Evaluates how far apart the two parties were.
 *
 * @param submissionGps Where the worker said the work happened.
 * @param verifierGps Where the client was when they tapped.
 * @param thresholdKm Distance treated as "same site". Below any plausible
 *   driving distance for a single job, so it flags remote confirmation without
 *   penalising a large site or a traffic delay.
 */
export function evaluateProximity(
  submissionGps: string | null,
  verifierGps: string | null,
  thresholdKm: number,
): ProximityResult {
  const submission = parseCoordinate(submissionGps);
  const verifier = parseCoordinate(verifierGps);

  if (!submission && !verifier) {
    return {
      status: 'unavailable',
      distanceKm: null,
      detail: 'No location was available from either the worker or the client.',
    };
  }

  if (!submission) {
    return {
      status: 'unavailable',
      distanceKm: null,
      detail: 'The worker did not record a location for this proof.',
    };
  }

  if (!verifier) {
    return {
      status: 'unavailable',
      distanceKm: null,
      detail: 'The client did not share a location when confirming.',
    };
  }

  const km = distanceKm(submission, verifier);

  if (km <= thresholdKm) {
    return {
      status: 'within',
      distanceKm: Math.round(km * 100) / 100,
      detail: `Client confirmed ${formatKm(km)} from the worker's recorded position.`,
    };
  }

  return {
    status: 'outside',
    distanceKm: Math.round(km * 100) / 100,
    detail: `Client confirmed ${formatKm(km)} away from the worker's recorded position.`,
  };
}

function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

/**
 * Whether the submission timestamp is consistent with the capture claim.
 *
 * A worker who backdates a proof so that a photo appears to predate the job
 * would otherwise defeat the proximity check by simply omitting their location,
 * turning the comparison into `unavailable` and the score into neutral. This
 * closes that route: a capture time that postdates the submission is itself a
 * finding, whether or not either location was shared.
 *
 * Returns null when there is no capture time to judge, which is the normal case
 * for audio and for any photo whose EXIF was already absent.
 */
export function captureTimeConflictsWithSubmission(
  capturedAt: Date | null,
  submittedAt: Date,
): boolean {
  if (!capturedAt) return false;

  const toleranceMs = 5 * 60 * 1000;
  return capturedAt.getTime() > submittedAt.getTime() + toleranceMs;
}