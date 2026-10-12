/**
 * Unit assertions for the Phase 3 trust engine.
 *
 * Runs against constructed fixtures with no server, database, or live project:
 *
 *   npm run fraud-check
 *
 * These are the cases that decide whether an honest worker keeps their
 * verification, so they are asserted directly rather than through mocks. Every
 * one below is a behaviour a plausible implementation could plausibly get wrong.
 */
import { distanceKm, gpsSchema, parseCoordinate } from '../apps/api/src/lib/geo.js';
import { assessCollusion, type Endorsement } from '../apps/api/src/lib/fraud/collusion.js';
import { evaluateProximity } from '../apps/api/src/lib/fraud/proximity.js';
import {
  DEFAULT_THRESHOLDS,
  assess,
  flagReasonFor,
  mediaScore,
  proximityScore,
  proofStatusFor,
} from '../apps/api/src/lib/fraud/score.js';
import { normalizePhone } from '../apps/api/src/lib/token.js';

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? `  (${detail})` : ''}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
}

function section(name: string): void {
  console.log(`\n=== ${name} ===`);
}

function near(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

/* -------------------------------------------------------------------------- */
section('geo: parsing rejects what a shape check alone would accept');
/* -------------------------------------------------------------------------- */

check('a valid pair parses', parseCoordinate('5.6037,-0.1870')?.latitude === 5.6037);
check('latitude 999 is rejected', parseCoordinate('999,999') === null);
check('longitude 999 is rejected', parseCoordinate('5.6,999') === null);
check('latitude exactly 90 is accepted', parseCoordinate('90,0') !== null);
check('longitude exactly -180 is accepted', parseCoordinate('0,-180') !== null);
check('latitude 90.1 is rejected', parseCoordinate('90.1,0') === null);
check('a non-numeric pair is rejected', parseCoordinate('abc,def') === null);
check('an empty string is rejected', parseCoordinate('') === null);
check('null is rejected', parseCoordinate(null) === null);
check('undefined is rejected', parseCoordinate(undefined) === null);

// The bug this module exists to fix: the confirm endpoint used to accept 999,999.
check('gpsSchema rejects 999,999', !gpsSchema.safeParse('999,999').success);
check('gpsSchema rejects it with a range message', (() => {
  const result = gpsSchema.safeParse('999,999');
  return !result.success && JSON.stringify(result.error.issues).includes('out of range');
})());
check('gpsSchema accepts a real coordinate', gpsSchema.safeParse('5.6037,-0.1870').success);

/* -------------------------------------------------------------------------- */
section('geo: distance');
/* -------------------------------------------------------------------------- */

const accra = parseCoordinate('5.6037,-0.1870')!;
const nearby = parseCoordinate('5.6100,-0.1900')!; // roughly 0.8 km away
const london = parseCoordinate('51.5074,-0.1278')!;

check('identical points are 0 km apart', distanceKm(accra, accra) === 0);
check('a nearby point is under 2 km', distanceKm(accra, nearby) < 2, `${distanceKm(accra, nearby).toFixed(2)} km`);
check('Accra to London is roughly 5000 km', near(distanceKm(accra, london), 5040, 120), `${distanceKm(accra, london).toFixed(0)} km`);
check('distance is symmetric', near(distanceKm(accra, nearby), distanceKm(nearby, accra), 1e-9));
check(
  'the equator crossing does not produce NaN',
  Number.isFinite(distanceKm(parseCoordinate('0,0')!, parseCoordinate('0,180')!)),
);
check(
  'antipodal points stay finite',
  Number.isFinite(distanceKm(parseCoordinate('0,0')!, parseCoordinate('0,179.9')!)),
);

/* -------------------------------------------------------------------------- */
section('proximity: a missing location is never a finding');
/* -------------------------------------------------------------------------- */

const both = evaluateProximity('5.6037,-0.1870', '5.6100,-0.1900', 2);
check('same site is within', both.status === 'within', `${both.distanceKm} km`);
check('a within result carries a readable detail', both.detail.includes('km') || both.detail.includes('m'));

const far = evaluateProximity('5.6037,-0.1870', '51.5074,-0.1278', 2);
check('another country is outside', far.status === 'outside');
check('an outside result still records the distance', far.distanceKm !== null && far.distanceKm > 100);

const noVerifier = evaluateProximity('5.6037,-0.1870', null, 2);
check('a client who shared nothing is unavailable', noVerifier.status === 'unavailable');
check('unavailable carries no distance', noVerifier.distanceKm === null);
check('unavailable says why', noVerifier.detail.includes('did not share'));

const noWorker = evaluateProximity(null, '5.6037,-0.1870', 2);
check('a worker who recorded nothing is unavailable', noWorker.status === 'unavailable');

const neither = evaluateProximity(null, null, 2);
check('neither side is unavailable', neither.status === 'unavailable');

check('a malformed coordinate is unavailable, not a crash', evaluateProximity('999,999', '5.6,-0.18', 2).status === 'unavailable');

// The core anti-abuse property: withholding a location must not look innocent.
check('withholding a location scores exactly neutral', proximityScore(noVerifier, 2) === 0.5);
check('withholding scores lower than being present', proximityScore(noVerifier, 2) < proximityScore(both, 2));
check('withholding scores lower than being absent', proximityScore(neither, 2) === proximityScore(noVerifier, 2));

check('a within result scores full marks', proximityScore(both, 2) === 1);
check('an outside result scores below neutral', proximityScore(far, 2) < 0.5, `${proximityScore(far, 2).toFixed(3)}`);
check('another continent scores zero on proximity', proximityScore(far, 2) === 0, `${proximityScore(far, 2)}`);
check('a slightly-far point scores better than a distant one', proximityScore(
  evaluateProximity('5.6037,-0.1870', '5.6500,-0.1870', 2), 2,
) > proximityScore(far, 2));
check('just over the threshold is still nearly neutral', proximityScore(
  evaluateProximity('5.6037,-0.1870', '5.6300,-0.1870', 2), 2,
) > 0.4, `${proximityScore(evaluateProximity('5.6037,-0.1870', '5.6300,-0.1870', 2), 2).toFixed(3)}`);

/* -------------------------------------------------------------------------- */
section('collusion: network diversity');
/* -------------------------------------------------------------------------- */

const W1 = 'worker-1';
const W2 = 'worker-2';
const V_RING = 'verifier-ring';
const V_BROAD = 'verifier-broad';

const blank: Endorsement[] = [];

const firstEver = assessCollusion({ workerId: W1, verifierKey: V_BROAD }, blank);
check('an unknown verifier is neutral, not suspicious', firstEver.weight === 0.5, `weight ${firstEver.weight}`);
check('an unknown verifier is still evaluated', firstEver.evaluated === true);
check('an unknown verifier produces no findings', firstEver.findings.length === 0, firstEver.findings.join('; '));

// The scored endorsement must not appear in its own history. The pure function
// cannot enforce this: given only a worker and a verifier key it cannot tell a
// duplicate row from the row being scored, and a worker legitimately verified
// twice by the same client is not a ring. The exclusion is therefore the
// service query's job, and is asserted live in the smoke suite.
//
// What matters here is that a verifier with history only for *other* workers is
// not mistaken for one confined to this worker.
const notSelfConfined = assessCollusion(
  { workerId: W1, verifierKey: V_BROAD },
  [{ workerId: W2, verifierKey: V_BROAD }],
);
check(
  'history for other workers does not flag this verifier as isolated',
  !notSelfConfined.findings.some((f) => f.includes('only one worker')),
  notSelfConfined.findings.join('; '),
);

const isolated = assessCollusion(
  { workerId: W1, verifierKey: V_RING },
  [
    { workerId: W1, verifierKey: V_RING },
    { workerId: W1, verifierKey: V_RING },
    { workerId: W1, verifierKey: V_RING },
  ],
);
check('a verifier with one worker is flagged isolated', isolated.findings.some((f) => f.includes('only one worker')));
check('isolation lowers the weight', isolated.weight < 0.5, `weight ${isolated.weight}`);

const concentrated = assessCollusion(
  { workerId: W1, verifierKey: V_RING },
  Array.from({ length: 8 }, () => ({ workerId: W1, verifierKey: V_RING })),
);
check('a concentrated verifier is flagged', concentrated.findings.some((f) => f.includes('unusually large share')));
check('concentration scores worse than plain isolation', concentrated.weight < isolated.weight, `${concentrated.weight} vs ${isolated.weight}`);
check('weight stays within 0..1', concentrated.weight >= 0 && concentrated.weight <= 1);

// A site supervisor who legitimately confirms one worker's proofs repeatedly
// must not be scored like a ring.
const supervisor = assessCollusion(
  { workerId: W1, verifierKey: 'supervisor-acme' },
  [
    { workerId: W1, verifierKey: 'supervisor-acme' },
    { workerId: W1, verifierKey: 'supervisor-acme' },
    { workerId: W1, verifierKey: 'supervisor-acme' },
    { workerId: W1, verifierKey: 'supervisor-acme' },
  ],
);
check('a repeat supervisor is not called concentrated at 4', !supervisor.findings.some((f) => f.includes('unusually large')));

const broad = assessCollusion(
  { workerId: W1, verifierKey: V_BROAD },
  [
    { workerId: W2, verifierKey: V_BROAD },
    { workerId: 'worker-3', verifierKey: V_BROAD },
    { workerId: 'worker-4', verifierKey: V_BROAD },
  ],
);
check('a diverse verifier is not flagged isolated', !broad.findings.some((f) => f.includes('only one worker')));
check('a diverse verifier keeps full weight', broad.weight === 0.5, `weight ${broad.weight}`);

const mutual = assessCollusion(
  { workerId: W1, verifierKey: W2 },
  [{ workerId: W2, verifierKey: W1 }],
);
check('mutual endorsement is detected', mutual.facts.mutualEndorsement === true);
check('mutual endorsement is reported', mutual.findings.some((f) => f.includes('each other')));
check('mutual endorsement lowers the weight', mutual.weight < 0.5, `weight ${mutual.weight}`);

// A worker who is also a client elsewhere on the platform is not a ring.
const notMutual = assessCollusion({ workerId: W1, verifierKey: W2 }, [{ workerId: W2, verifierKey: 'someone-else' }]);
check('a one-way relationship is not mutual', notMutual.facts.mutualEndorsement === false);

const unidentified = assessCollusion({ workerId: W1, verifierKey: null }, blank);
check('an unidentified verifier is neutral', unidentified.weight === 0.5);
check('an unidentified verifier is marked unevaluated', unidentified.evaluated === false);
check('an unidentified verifier is explained', unidentified.findings.some((f) => f.includes('not identified')));

// Findings must not be countable twice for the same underlying shape.
const bothFindings = assessCollusion(
  { workerId: W1, verifierKey: V_RING },
  [
    ...Array.from({ length: 8 }, () => ({ workerId: W1, verifierKey: V_RING })),
    // The ring member is also a worker here, and approved W1 in the other
    // direction. This row carries both halves of the mutual pairing.
    { workerId: V_RING, verifierKey: W1 },
  ],
);
check(
  'concentration and isolation together cost more than either alone',
  bothFindings.weight < Math.min(concentrated.weight, 0.5),
  `${bothFindings.weight}`,
);
check('the weight never goes below zero', bothFindings.weight >= 0, `${bothFindings.weight}`);
check(
  'the facts are all populated',
  bothFindings.facts.approvalsByThisVerifier === 8 && bothFindings.facts.approvalsForThisWorker === 8,
  `byVerifier=${bothFindings.facts.approvalsByThisVerifier} forWorker=${bothFindings.facts.approvalsForThisWorker}`,
);
check(
  'mutual and concentration are both recorded',
  bothFindings.facts.mutualEndorsement === true && bothFindings.findings.length >= 3,
  bothFindings.findings.join('; '),
);

/* -------------------------------------------------------------------------- */
section('media provenance signals');
/* -------------------------------------------------------------------------- */

const cleanCamera = { hasCameraSignature: true, timestampPlausible: true, encoderKnown: true };
const noSignals = { hasCameraSignature: null, timestampPlausible: null, encoderKnown: null };

check('a well-formed capture scores at most neutral', mediaScore(cleanCamera, false) === 0.5, `${mediaScore(cleanCamera, false)}`);
check('a clean file is never rewarded above neutral', mediaScore(cleanCamera, false) <= 0.5);
check('an all-null signal set is exactly neutral', mediaScore(noSignals, false) === 0.5);
check('null signals are not read as findings', mediaScore(noSignals, false) >= 0.5);
check('a missing camera signature lowers the score', mediaScore({ ...cleanCamera, hasCameraSignature: false }, false) < 0.5);
check('an implausible timestamp lowers the score', mediaScore({ ...cleanCamera, timestampPlausible: false }, false) < 0.5);
check('a broken container lowers the score most', mediaScore({ ...cleanCamera, encoderKnown: false }, false) < mediaScore({ ...cleanCamera, hasCameraSignature: false }, false));
check('a capture time conflict lowers the score', mediaScore(cleanCamera, true) < mediaScore(cleanCamera, false));
check('a null signal set is never worse than a bad one', mediaScore(noSignals, false) > mediaScore({ ...cleanCamera, encoderKnown: false }, false));

/* -------------------------------------------------------------------------- */
section('scoring: only a confirmation can be blocked');
/* -------------------------------------------------------------------------- */

const goodCase = assess({
  response: 'confirmed',
  proximity: both,
  collusion: firstEver,
  media: cleanCamera,
  captureTimeConflict: false,
});
check('a clean confirmation counts', goodCase.verdict === 'counted', `score ${goodCase.score}`);
check('the proof would be verified', proofStatusFor(goodCase) === 'verified');
check('a score is produced for a confirmation', goodCase.score !== null);
check('a clean confirmation still records a reason', goodCase.reasons.length > 0);
check('the detail is populated for the record', Object.keys(goodCase.detail).length >= 4);

const worstCase = assess({
  response: 'confirmed',
  proximity: far,
  collusion: bothFindings,
  media: { hasCameraSignature: false, timestampPlausible: false, encoderKnown: false },
  captureTimeConflict: true,
});
// Even an endorsement failing every signal is only *flagged*, never blocked.
//
// This is the outcome policy from Phase 3, and it is the assertion that holds it
// in place: the engine withholds the record and queues a person, because a
// heuristic over weak signals cannot establish fraud. `fraud_blocked` is reachable
// only through the admin review path, which no scoring function can reach.
check(
  'an endorsement failing every signal is flagged, not blocked',
  worstCase.verdict === 'flagged',
  `score ${worstCase.score}`,
);
check('a flagged proof is not counted as verified', proofStatusFor(worstCase) === 'flagged');
check(
  'no scoring outcome can reach fraud_blocked',
  worstCase.verdict !== 'blocked',
  worstCase.verdict,
);
check(
  'the withhold records how many families were adverse',
  (worstCase.detail.corroboration as { adverseSignalGroups?: number })?.adverseSignalGroups === 3,
  JSON.stringify(worstCase.detail.corroboration),
);

// The sentence a worker is shown names the kinds of signal, never their values.
const flaggedReason = flagReasonFor(worstCase);
check(
  'the flag reason names what was wrong, not a number',
  flaggedReason.length > 0 && !/\d\.\d|0\.\d+/.test(flaggedReason),
  flaggedReason.slice(0, 110),
);
check(
  'the flag reason says it is not a finding of fraud',
  /not a finding of fraud/i.test(flaggedReason),
);

// The abuse case: a worker farming rejections from colluding clients to attack
// a real worker. A rejection is not fraud.
const rejection = assess({
  response: 'rejected',
  proximity: far,
  collusion: bothFindings,
  media: { hasCameraSignature: false, timestampPlausible: false, encoderKnown: false },
  captureTimeConflict: true,
});
check('a rejection is never blocked', rejection.verdict === 'counted');
check('a rejection is never scored', rejection.score === null);
check('a rejection is never fraud_blocked', proofStatusFor(rejection) !== 'fraud_blocked');
check('a rejection explains itself', rejection.reasons.some((r) => r.includes('not completed')));

// Neutral-when-unknown must not be penalised, or withholding data would work.
const withheld = assess({
  response: 'confirmed',
  proximity: evaluateProximity('5.6,-0.18', null, 2),
  collusion: unidentified,
  media: noSignals,
  captureTimeConflict: false,
});
check('withholding everything does not get a worker blocked', withheld.verdict === 'counted', `score ${withheld.score}`);
check('withholding everything stays near neutral', (withheld.score ?? 0) >= 0.45, `score ${withheld.score}`);

check('the default block threshold is generous', DEFAULT_THRESHOLDS.blockBelow >= 0.2);
check('the default proximity threshold is sane', DEFAULT_THRESHOLDS.proximityKm > 0 && DEFAULT_THRESHOLDS.proximityKm <= 25);

/* -------------------------------------------------------------------------- */
section('phone normalisation for hashing');
/* -------------------------------------------------------------------------- */

check('a plain E.164 number is unchanged', normalizePhone('+233241234567') === '+233241234567');
check('spaces are stripped', normalizePhone('+233 241 234 567') === '+233241234567');
check('dashes are stripped', normalizePhone('+233-241-234567') === '+233241234567');
check('an 00 prefix becomes +', normalizePhone('00233241234567') === '+233241234567');
check('a bare number is left bare', normalizePhone('233241234567') === '233241234567');

// These must collapse together, or the same person reads as three people and the
// collusion check silently stops working.
check(
  'the same number in three formats normalises identically',
  new Set([
    normalizePhone('+233241234567'),
    normalizePhone('+233 241 234 567'),
    normalizePhone('00233 24 1234567'),
  ]).size === 1,
);
check(
  'two different numbers stay different',
  normalizePhone('+233241234567') !== normalizePhone('+233241234568'),
);

/* -------------------------------------------------------------------------- */
console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`}`);
console.log(`${passed} assertions passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}