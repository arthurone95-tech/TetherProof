/**
 * Collusion weighting: Feature 2.2, "Graph Centrality Collusion Filter".
 *
 * The stated goal is to stop closed endorsement rings, where a handful of people
 * mutually approve each other's work.
 *
 * What actually makes a verification trustworthy is **network diversity**: a
 * confirmation from someone who sees a wide range of workers' work carries more
 * information than one from a verifier who only ever appears alongside a single
 * worker. A ring defeats that by construction, because every confirmation in it
 * comes from a verifier with exactly one connection.
 *
 * So this computes a weight in 0..1 from the verifier's position in the
 * endorsement graph, and it is deliberately conservative:
 *
 * * A verifier seen for the first time is **neutral**, not suspicious. New
 *   verifiers are the normal case for a young network, and penalising them
 *   would punish exactly the growth the product wants.
 * * Only patterns that are independently meaningful move the score: a verifier
 *   who has approved many proofs for one worker, and mutual approval between two
 *   workers.
 * * Every finding carries the numbers behind it, so a decision can be explained
 *   rather than merely enforced.
 *
 * This is a heuristic on a graph that will be small for a long time. It is
 * weighted as weak evidence for that reason, and the thresholds are named
 * constants rather than scattered magic numbers so they can be recalibrated
 * against real usage once there is any.
 */

/** One endorsement: who was verified, and by whom. */
export interface Endorsement {
  workerId: string;
  /** Salted hash of the verifier's phone, or null when the number was not given. */
  verifierKey: string | null;
}

export interface CollusionAssessment {
  /** 0..1. Higher means the endorsement looks more trustworthy. */
  weight: number;
  /** A verifier with no key cannot appear in the graph at all. */
  evaluated: boolean;
  findings: string[];
  /** The numbers behind the findings, stored for explanation. */
  facts: {
    approvalsByThisVerifier: number | null;
    distinctWorkersThisVerifierApproved: number | null;
    approvalsForThisWorker: number | null;
    approvalsFromThisWorker: number | null;
    mutualEndorsement: boolean | null;
  };
}

/**
 * A verifier approving many proofs for a single worker is not evidence of a ring
 * by itself, since a site supervisor legitimately does exactly that. It becomes
 * evidence in proportion to how concentrated it is.
 */
const CONCENTRATION_SUSPICIOUS_ABOVE = 5;

/** Weight assigned when the graph could not be evaluated at all. */
const NEUTRAL_WEIGHT = 0.5;

const FINDING_CONCENTRATED_APPROVALS =
  'One verifier has confirmed an unusually large share of this worker’s proofs.';
const FINDING_MUTUAL = 'This worker and the verifier have confirmed work for each other.';
const FINDING_ISOLATED = 'This verifier has confirmed work for only one worker.';
const FINDING_UNIDENTIFIABLE = 'The client was not identified, so network diversity could not be assessed.';

/**
 * Scores one endorsement against the endorsement graph.
 *
 * `history` must exclude the endorsement being scored, or a verifier's very
 * first approval would look like a repeat. Passing a set that still contains the
 * row under assessment is the easy mistake here, and it makes isolated verifiers
 * look like frequent ones.
 *
 * @param target The endorsement now being scored.
 * @param history Every other completed endorsement, in either direction.
 */
export function assessCollusion(target: Endorsement, history: Endorsement[]): CollusionAssessment {
  const facts: CollusionAssessment['facts'] = {
    approvalsByThisVerifier: null,
    distinctWorkersThisVerifierApproved: null,
    approvalsForThisWorker: null,
    approvalsFromThisWorker: null,
    mutualEndorsement: null,
  };

  if (!target.verifierKey) {
    // Not evidence against the worker. An unidentified client simply means the
    // diversity question cannot be asked, so the weight stays neutral.
    return {
      weight: NEUTRAL_WEIGHT,
      evaluated: false,
      findings: [FINDING_UNIDENTIFIABLE],
      facts,
    };
  }

  const byThisVerifier = history.filter((e) => e.verifierKey === target.verifierKey);
  const approvalsForThisWorker = history.filter((e) => e.workerId === target.workerId);
  const approvalsFromThisWorker = history.filter((e) => e.workerId === target.verifierKey);

  // The endorsement under assessment is itself one of this verifier's approvals,
  // so the worker they are approving now counts toward the diversity set.
  // Leaving it out flags every verifier's *second* approval as isolated, because
  // before this one they had approved exactly the other single worker.
  const workersApproved = new Set([target.workerId, ...byThisVerifier.map((e) => e.workerId)]);

  facts.approvalsByThisVerifier = byThisVerifier.length;
  facts.distinctWorkersThisVerifierApproved = workersApproved.size;
  facts.approvalsForThisWorker = approvalsForThisWorker.length;
  facts.approvalsFromThisWorker = approvalsFromThisWorker.length;

  // Mutual means the two have confirmed work for each other: somewhere in the
  // history, the verifier acting as a worker approved this worker AND this
  // worker approved the verifier. Both directions are required, which is why
  // this looks for a single row carrying both pairings rather than testing
  // either side alone. Testing one side at a time would flag every worker who
  // is also a client elsewhere on the platform, which is most of them.
  const mutual = history.some(
    (e) => e.workerId === target.verifierKey && e.verifierKey === target.workerId,
  );
  facts.mutualEndorsement = mutual;

  const findings: string[] = [];

  // Diversity: a verifier whose approvals all went to one worker has an
  // endorsement that carries little independent information, whatever the
  // reason. Requires at least one prior approval, or a brand-new verifier would
  // be penalised for the crime of being new. Reported even when thin, because it
  // is the shape a ring takes before it is large enough to be obvious.
  const isolated = byThisVerifier.length > 0 && workersApproved.size === 1;

  // Concentration: this is the weight-bearing signal.
  const concentrated = byThisVerifier.length >= CONCENTRATION_SUSPICIOUS_ABOVE && isolated;

  if (isolated) findings.push(FINDING_ISOLATED);
  if (concentrated) findings.push(FINDING_CONCENTRATED_APPROVALS);
  if (mutual) findings.push(FINDING_MUTUAL);

  // Start from the neutral weight and apply each finding once, so adding a
  // second finding for the same underlying shape cannot double-count it.
  let weight = NEUTRAL_WEIGHT;
  if (isolated) weight -= 0.15;
  if (concentrated) weight -= 0.2;
  if (mutual) weight -= 0.15;

  return {
    weight: clamp(weight, 0, 1),
    evaluated: true,
    findings,
    facts,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}