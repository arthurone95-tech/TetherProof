/**
 * Decides whether an uploaded file may stand as evidence of completed work.
 *
 * ## What this module does and does not claim
 *
 * It does **not** detect AI-generated media, and no reading of its output should
 * suggest that it does. `doc/13` E-019 recorded why: Phase 2 destroys file
 * metadata before storage, so the timestamps and camera signatures a detector
 * would read no longer exist, and no metadata check can distinguish a generated
 * image from a real one in any case. Nothing here is a detector, and the file it
 * produces is not evidence of anything beyond its own internal consistency.
 *
 * What it *does* judge is narrower and is a fact about the bytes rather than a
 * guess about their origin:
 *
 * * **Structural integrity.** Does the file actually parse as the format it
 *   declares? A JPEG with no frame header, a PNG with a broken chunk CRC, or an
 *   audio file that is not a container at all is not a photograph or a recording
 *   — it is a mislabelled or truncated upload. That is checkable, and a file that
 *   fails it has no business being stored under a promise that it is evidence.
 * * **Internal contradiction.** Does the file's own account of itself conflict
 *   with the moment it was submitted — a capture time in the future, or one from
 *   before any phone camera existed? This is weaker still, because an unset
 *   clock and a stripped export both produce it innocently, so it is reported as
 *   something to look at rather than as grounds for refusal.
 *
 * ## The three outcomes
 *
 * | Outcome | Meaning | Effect on the submission |
 * | --- | --- | --- |
 * | `accepted` | No blocking integrity problem found. | Stored. |
 * | `needs_review` | The file is structurally sound but its provenance is contradictory. | Stored, and the contradiction is recorded for the trust engine. |
 * | `rejected` | The bytes are not the container they claim to be. | Refused, with a message that says the file could not be read. |
 *
 * ## The one rule that matters most
 *
 * **A file with no metadata is `accepted`, never `rejected` and never flagged as
 * generated.** Metadata is stripped by every messaging app, every screenshot, and
 * by this project's own scrubber, so its absence is the normal condition of most
 * genuine evidence. Treating it as a finding would punish exactly the honest
 * uploads it was meant to protect, and would hand anyone a trivial way to make a
 * file look innocent. `hasCameraSignature === false` therefore carries no weight
 * here at all; it is left to the trust engine, which can only lower a score with
 * it and never raises one.
 */
import { AppError } from './errors.js';
import type { MediaSignals } from './media-scrub.js';

export type EvidenceOutcome = 'accepted' | 'needs_review' | 'rejected';

export interface EvidenceAssessment {
  outcome: EvidenceOutcome;
  /**
   * Why, in terms safe to log and to act on.
   *
   * Deliberately a closed vocabulary rather than a provider's own wording. A
   * detector's error text can describe its internals, and a storage or decoder
   * error can quote bucket and object names; neither belongs in a worker's
   * submission response or in a log line.
   */
  reason: string;
  /**
   * What the assessment observed, for the audit trail.
   *
   * This is a record of what was looked at, not a list of objections: an entry
   * here does not imply the outcome was anything other than `accepted`. Only
   * `reason` says what the outcome was decided on.
   */
  findings: string[];
}

/** Reasons a caller may act on. Stable strings, not sentences assembled per call. */
export const EVIDENCE_REASONS = {
  ok: 'The file is a readable image or recording.',
  noCameraSignature: 'The file carried no capture-device details.',
  contradictoryCaptureTime: 'The file recorded a capture time that conflicts with when it was uploaded.',
  unreadableContainer: 'The file is not readable as the kind of media it claims to be.',
} as const;

/**
 * Assesses an uploaded file from the signals the scrubber already derived.
 *
 * Takes the signals rather than the buffer, because by the time this is called the
 * metadata has been read and destroyed — reading it again would be impossible, and
 * passing the buffer around after scrubbing would invite a second pass that keeps
 * data this project has promised to drop.
 *
 * `contentType` is the scrubbed file's type, not the caller's claim: the scrubber
 * has already confirmed the bytes are that container by re-encoding or by its own
 * container check.
 */
export function assessEvidenceIntegrity(input: {
  signals: MediaSignals;
  contentType: string;
}): EvidenceAssessment {
  const findings: string[] = [];
  const { signals } = input;

  // Structural. A null here means the check did not apply to this format — audio
  // carries no camera signature and no capture time — and is not a finding.
  if (signals.encoderKnown === false) {
    findings.push(EVIDENCE_REASONS.unreadableContainer);
    return {
      outcome: 'rejected',
      reason: EVIDENCE_REASONS.unreadableContainer,
      findings,
    };
  }

  // Contradiction, not absence. A file with no timestamp at all is untouched here;
  // only one that states a time which cannot be true is noted.
  const contradicted = signals.timestampPlausible === false;
  if (contradicted) {
    findings.push(EVIDENCE_REASONS.contradictoryCaptureTime);
  }

  // Recorded for the audit trail so the assessment says what it looked at. It is
  // deliberately *not* allowed to affect the outcome: an absent camera signature
  // is what nearly every genuine photo looks like once it has been through a
  // messaging app, and a rule that treated it as a finding would refuse honest
  // evidence while remaining trivially avoidable. The trust engine still carries
  // the signal, where it can only lower a score and never raises one.
  const noSignature = signals.hasCameraSignature === false;
  if (noSignature) {
    findings.push(EVIDENCE_REASONS.noCameraSignature);
  }

  return {
    outcome: contradicted ? 'needs_review' : 'accepted',
    reason: contradicted ? EVIDENCE_REASONS.contradictoryCaptureTime : EVIDENCE_REASONS.ok,
    findings,
  };
}

/**
 * Turns a `rejected` assessment into the refusal the worker sees.
 *
 * Kept apart from the assessment so the wording lives in one place and cannot
 * drift into naming a detector, a threshold, or an anti-fraud signal. The worker
 * is told their file could not be read and asked to try another; why it could not
 * be read is not something the product can usefully explain without describing
 * internals that would help someone craft around them.
 */
export function evidenceRejectionError(): AppError {
  return AppError.badRequest('That file could not be read as a photo or recording. Please try another file.');
}
