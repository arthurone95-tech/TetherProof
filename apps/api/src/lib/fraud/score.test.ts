import { describe, expect, it } from 'vitest';
import {
  assertUsableThresholds,
  DEFAULT_THRESHOLDS,
  flagReasonFor,
  proofStatusFor,
  assess,
  type ScoreInput,
} from './score.js';

/**
 * The scoring engine's three-way outcome, tested directly.
 *
 * The most consequential decision in the product is the one this module exists to
 * get right: an automated process may withhold a record, but it may not accuse
 * anyone of fraud. `fraud_blocked` is a claim about a person, and it is reachable
 * only when a person reads the evidence and upholds it.
 *
 * The live suite asserts the same boundary end to end through the API. These
 * tests check it at the function that decides, with no database in the way, so an
 * edit to the weights or the threshold cannot pass unnoticed.
 *
 * Every input is built through the real `assess` with its signals varied, rather
 * than by hand-writing an assessment object â€” a test that invents its own shape
 * proves nothing about the code that runs. That matters more than it sounds: an
 * earlier draft of this file mocked `collusion` with the wrong fields and produced
 * a `NaN` score, which the engine handled safely but which the test would have
 * happily reported as a pass on the wrong grounds.
 */

/** Signals that support the claim: a client standing on the site, clean media. */
function cleanSignals(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    response: 'confirmed',
    proximity: { status: 'within', distanceKm: 0.1, detail: 'on site' },
    collusion: {
      // `weight` is trust, not suspicion: 1 means the endorsement carries full
      // independent information.
      weight: 1,
      evaluated: true,
      findings: [],
      facts: {
        approvalsByThisVerifier: 0,
        distinctWorkersThisVerifierApproved: 0,
        approvalsForThisWorker: 0,
        approvalsFromThisWorker: 0,
        mutualEndorsement: false,
      },
    },
    media: null,
    captureTimeConflict: false,
    ...overrides,
  };
}

/** The same verifier, one whose endorsements carry no independent weight. */
function adverseCollusion() {
  return {
    weight: 0,
    evaluated: true,
    findings: [
      'this verifier has approved several works for a single worker',
      'the approvals are concentrated on one worker',
    ],
    facts: {
      approvalsByThisVerifier: 9,
      distinctWorkersThisVerifierApproved: 1,
      approvalsForThisWorker: 1,
      approvalsFromThisWorker: 0,
      mutualEndorsement: false,
    },
  };
}

describe('assess verdict', () => {
  it('counts a confirmation that nothing about contradicts', () => {
    const assessment = assess(cleanSignals());
    expect(assessment.verdict).toBe('counted');
    expect(proofStatusFor(assessment)).toBe('verified');
  });

  it('withholds rather than accusing when every signal is adverse', () => {
    // A client far from the site, all their approvals going to one worker, and a
    // capture time that cannot be reconciled. Whatever the total, an automated
    // process may withhold â€” never accuse.
    const assessment = assess(
      cleanSignals({
        proximity: { status: 'outside', distanceKm: 5400, detail: 'far from the site' },
        collusion: adverseCollusion(),
        captureTimeConflict: true,
      }),
    );

    expect(assessment.verdict).toBe('flagged');
    expect(assessment.verdict).not.toBe('blocked');
    expect(proofStatusFor(assessment)).toBe('flagged');
  });

  it('never reaches the accusation at any severity', () => {
    // The type still permits `blocked` for the review path's vocabulary. This
    // asserts the engine does not emit it, for the most adverse input it accepts.
    const worst = cleanSignals({
      proximity: { status: 'outside', distanceKm: 20000, detail: 'on another continent' },
      media: {
        readable: true,
        hasCameraSignature: false,
        declaredCapture: 'synthetic',
        sourceType: 'synthetic',
        confidence: 0,
        findings: ['no camera signature'],
      } as never,
      captureTimeConflict: true,
    });

    expect(assess(worst).verdict).not.toBe('blocked');
  });

  it('leaves a rejection unscored, because a refusal is not evidence against a worker', () => {
    const assessment = assess(cleanSignals({ response: 'rejected' }));
    expect(assessment.score).toBeNull();
  });

  it('treats an unevaluable collusion graph as no evidence rather than as suspicion', () => {
    // A verifier with no key cannot appear in the graph at all. Absence of a graph
    // must not read as a bad graph, or every keyless client would be penalised.
    const assessment = assess(
      cleanSignals({
        collusion: { ...adverseCollusion(), weight: 1, evaluated: false, findings: [] },
      }),
    );

    expect(assessment.verdict).toBe('counted');
  });
});

describe('proofStatusFor', () => {
  it('returns only the two states the engine is allowed to write', () => {
    for (const signal of [
      cleanSignals(),
      cleanSignals({ proximity: { status: 'unavailable', distanceKm: null, detail: 'no location shared' } }),
    ]) {
      expect(['verified', 'flagged']).toContain(proofStatusFor(assess(signal)));
    }
  });
});

describe('flagReasonFor', () => {
  it('states that the record is not a finding of fraud', () => {
    const assessment = assess(
      cleanSignals({ proximity: { status: 'outside', distanceKm: 5400, detail: 'far from the site' } }),
    );
    expect(flagReasonFor(assessment)).toMatch(/not a finding of fraud/i);
  });

  it('never publishes a score, a threshold, or any number', () => {
    // The reason is shown to the worker. A score describes the detector rather
    // than helping the worker answer it, and publishing one invites tuning
    // behaviour to move the threshold that follows it.
    const assessment = assess(
      cleanSignals({
        proximity: { status: 'outside', distanceKm: 5400, detail: 'far from the site' },
        captureTimeConflict: true,
      }),
    );
    const reason = flagReasonFor(assessment);

    expect(reason).not.toMatch(/\d/);
    expect(reason).not.toMatch(/threshold/i);
    expect(reason).not.toMatch(/score/i);
  });
});

describe('thresholds', () => {
  it('ships with the withhold threshold the product was agreed on', () => {
    expect(DEFAULT_THRESHOLDS.blockBelow).toBe(0.25);
  });

  it('refuses a threshold that is not strictly between 0 and 1', () => {
    expect(() => assertUsableThresholds({ proximityKm: 2, blockBelow: 0 })).toThrow();
    expect(() => assertUsableThresholds({ proximityKm: 2, blockBelow: 1 })).toThrow();
    expect(() => assertUsableThresholds({ proximityKm: 0, blockBelow: 0.25 })).toThrow();
  });

  it('accepts a usable pair', () => {
    expect(() => assertUsableThresholds(DEFAULT_THRESHOLDS)).not.toThrow();
  });
});
