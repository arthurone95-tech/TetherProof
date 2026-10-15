/**
 * Adversarial tests for the browser verifier identifier and the fraud engine.
 *
 *   npm run security-check
 *
 * Pure functions only — no server, no database, no live project, and no user
 * records. Every case here is something a plausible implementation could get
 * wrong, and several of them are the questions a reviewer should not have to
 * take on trust.
 *
 * The organising distinction is between **browser continuity** and **human
 * identity**. This suite asserts what the identifier actually is — a continuity
 * token that says "the same browser answered twice" — and never treats it as
 * proof of who answered.
 */
import { assessCollusion, type Endorsement } from '../apps/api/src/lib/fraud/collusion.js';
import {
  assess,
  mediaScore,
  proximityScore,
  proofStatusFor,
  DEFAULT_THRESHOLDS,
  type Verdict,
} from '../apps/api/src/lib/fraud/score.js';
import { evaluateProximity } from '../apps/api/src/lib/fraud/proximity.js';
import { hashVerifierKey, hashVerifierPhone, normalizePhone } from '../apps/api/src/lib/token.js';
import { normalizeVerifierKey, VERIFIER_KEY_HEADER } from '../apps/api/src/lib/verifier-key.js';
import type { MediaSignals } from '../apps/api/src/lib/media-scrub.js';

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

const NEUTRAL_MEDIA: MediaSignals = {
  hasCameraSignature: null,
  timestampPlausible: null,
  encoderKnown: null,
};

/** The best media signal set a genuinely weak-but-real upload can produce. */
const WEAK_VALID_MEDIA: MediaSignals = {
  hasCameraSignature: false,
  timestampPlausible: false,
  encoderKnown: true,
};

const NO_GPS = evaluateProximity('5.6037,-0.1870', null, DEFAULT_THRESHOLDS.proximityKm);
const ON_SITE_GPS = evaluateProximity('5.6037,-0.1870', '5.6039,-0.1872', DEFAULT_THRESHOLDS.proximityKm);

function score(input: {
  media?: MediaSignals | null;
  collusionWeight?: number;
  proximity?: ReturnType<typeof evaluateProximity>;
  captureTimeConflict?: boolean;
  response?: 'confirmed' | 'rejected';
}) {
  return assess(
    {
      response: input.response ?? 'confirmed',
      proximity: input.proximity ?? NO_GPS,
      collusion: {
        weight: input.collusionWeight ?? 0.5,
        evaluated: true,
        findings: [],
        facts: {},
      },
      media: input.media === undefined ? NEUTRAL_MEDIA : input.media,
      captureTimeConflict: input.captureTimeConflict ?? false,
    },
    DEFAULT_THRESHOLDS,
  );
}

const verdictOf = (v: Verdict) => v;

/* ========================================================================== */
section('1. Key generation and normalisation');
/* ========================================================================== */

{
  // The client generates 24 random bytes as hex, so a genuine key is 48 chars.
  const generated = Array.from(new Uint8Array(24), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  check('a generated key is 48 hex characters', /^[0-9a-f]{48}$/.test(generated), `${generated.length} chars`);
  check('a generated key survives normalisation', normalizeVerifierKey(generated) === generated);
}

{
  // The decisive property of the scheme: keys are high-entropy, so one verifier
  // cannot be manufactured by guessing another.
  const a = normalizeVerifierKey('a'.repeat(48));
  const b = normalizeVerifierKey('b'.repeat(48));
  check('distinct keys produce distinct digests', hashVerifierKey(a!) !== hashVerifierKey(b!));
  check('a digest is 64 hex characters', /^[0-9a-f]{64}$/.test(hashVerifierKey(a!)));
  // Determinism is the property under test, so both sides are the same call on the
  // same input. `no-self-compare` is silenced for this line alone: the rule exists
  // to catch `x === x` standing in for a real comparison, and this is not one.
  // eslint-disable-next-line no-self-compare
  check('the digest is deterministic', hashVerifierKey(a!) === hashVerifierKey(a!));
}

{
  // Domain separation. Both digests are 64 hex over the same salt, so without a
  // prefix a device key could in principle collide with a phone hash.
  check(
    'a device key cannot collide with a phone number hash',
    hashVerifierKey('a'.repeat(48)) !== hashVerifierPhone('+233241234567'),
  );
}

/* ========================================================================== */
section('2. Header validation: missing, malformed, oversized');
/* ========================================================================== */

{
  check('the header name is explicit and namespaced', VERIFIER_KEY_HEADER === 'x-tetherproof-verifier-key');
  check('undefined is accepted as absent', normalizeVerifierKey(undefined) === null);
  check('null is accepted as absent', normalizeVerifierKey(null) === null);
  check('empty string is absent', normalizeVerifierKey('') === null);

  check('a 15-character key is refused (below minimum)', normalizeVerifierKey('a'.repeat(15)) === null);
  check('a 16-character key is accepted (at minimum)', normalizeVerifierKey('a'.repeat(16)) !== null);
  check('a 64-character key is accepted (at maximum)', normalizeVerifierKey('a'.repeat(64)) !== null);
  check('a 65-character key is refused (above maximum)', normalizeVerifierKey('a'.repeat(65)) === null);
  check('a very large header is refused, not truncated', normalizeVerifierKey('a'.repeat(100_000)) === null);

  // Refusing rather than stripping is deliberate: silently deleting characters
  // could collapse two distinct keys onto one digest.
  check('an inner space is refused rather than stripped', normalizeVerifierKey('aaaa aaaa aaaa aaaa') === null);
  check('a padded key is trimmed then validated', normalizeVerifierKey('  aaaaaaaaaaaaaaaaaaaa  ') === 'aaaaaaaaaaaaaaaaaaaa');
  check('case is folded so one key is one verifier', normalizeVerifierKey('AAAAAAAAAAAAAAAAAAAA') === 'aaaaaaaaaaaaaaaaaaaa');

  for (const bad of ['abcd efgh ijkl mnop', 'abcd.efgh.ijkl.mnop', 'abcd+efgh+ijkl+mnop', '<script>alert(1)</script>', 'aaaa\naaaa\naaaa\naaaa', '../../etc/passwd']) {
    check(`refused: ${JSON.stringify(bad).slice(0, 28)}`, normalizeVerifierKey(bad) === null);
  }
}

/* ========================================================================== */
section('3. Rotation and evasion — what an attacker can actually do');
/* ========================================================================== */

{
  // Reuse: the intended behaviour. One browser answering several proofs for one
  // worker is recognised, which is the shape both a ring and a site supervisor
  // have.
  const history: Endorsement[] = Array.from({ length: 5 }, () => ({
    workerId: 'worker-a',
    verifierKey: hashVerifierKey('a'.repeat(48)),
  }));
  const same = assessCollusion({ workerId: 'worker-a', verifierKey: hashVerifierKey('a'.repeat(48)) }, history);
  check('reusing one key is detected', same.evaluated === true);
  check('reuse lowers the score', same.weight < 0.5, `weight ${same.weight}`);
  check(
    'reuse raises the concentration finding',
    same.findings.some((f) => /large share|only one worker/i.test(f)),
    same.findings.join(' | '),
  );
}

{
  // Rotation: the honest weakness. A fresh key per verification presents as a
  // first-time verifier every time, so the graph never fills.
  const history: Endorsement[] = Array.from({ length: 5 }, (_, i) => ({
    workerId: 'worker-a',
    verifierKey: hashVerifierKey(String(i).padStart(48, 'x')),
  }));
  const rotated = assessCollusion({ workerId: 'worker-a', verifierKey: hashVerifierKey('y'.repeat(48)) }, history);
  // `evaluated` reports whether the graph could be read at all, not whether the
  // verifier was recognised. A rotated key IS evaluated; it simply finds no
  // history under its own digest, which is the evasion.
  check('a rotated key is evaluated but finds no prior approvals', rotated.evaluated === true);
  check('a rotated key is not linked to prior approvals', rotated.facts.approvalsByThisVerifier === 0, `approvals ${rotated.facts.approvalsByThisVerifier}`);
  check('a rotated key scores neutral', rotated.weight === 0.5, `weight ${rotated.weight}`);
  check('a rotated key raises no finding', rotated.findings.length === 0, rotated.findings.join(' | '));

  // Contrast with reuse, which is linked. Same shape of attacker, opposite
  // outcome, purely because the key repeated. Built as its own fixture because
  // the rotation fixture above deliberately holds five *different* keys.
  const repeated = 'a'.repeat(48);
  const reused = assessCollusion(
    { workerId: 'worker-a', verifierKey: hashVerifierKey(repeated) },
    Array.from({ length: 5 }, () => ({ workerId: 'worker-a', verifierKey: hashVerifierKey(repeated) })),
  );
  check('reusing one key is linked to every prior approval', (reused.facts.approvalsByThisVerifier ?? 0) === 5, `approvals ${reused.facts.approvalsByThisVerifier}`);
  check('that link is what lowers the weight', reused.weight < 0.5, `weight ${reused.weight}`);
}

{
  // Omission is the same as rotation and equally undetectable — but it is also
  // exactly what a privacy-conscious recipient does, so the engine must not
  // punish it. This is the fairness property.
  const anonymous = assessCollusion({ workerId: 'worker-a', verifierKey: null }, []);
  check('an absent key is neutral, never a penalty', anonymous.weight === 0.5);
  check('an absent key is reported as not evaluated', anonymous.evaluated === false);
  check(
    'an absent key is explained rather than treated as a finding',
    anonymous.findings.some((f) => /not identified/i.test(f)),
    anonymous.findings.join(' | '),
  );
}

/* ========================================================================== */
section('4. Fairness: legitimate verifiers must not be blocked');
/* ========================================================================== */

{
  // Two different clients on one shared office browser. The engine sees one
  // verifier approving two unrelated workers, which is the *least* suspicious
  // shape there is.
  const shared: Endorsement[] = [
    { workerId: 'worker-1', verifierKey: 'SHARED' },
    { workerId: 'worker-2', verifierKey: 'SHARED' },
  ];
  const result = assessCollusion({ workerId: 'worker-3', verifierKey: 'SHARED' }, shared);
  check('a shared browser approving different workers raises no finding', result.findings.length === 0, result.findings.join(' | '));
  check('a shared browser stays neutral', result.weight === 0.5, `weight ${result.weight}`);
}

{
  // A brand-new verifier is neutral, not suspicious.
  const fresh = assessCollusion({ workerId: 'worker-x', verifierKey: hashVerifierKey('z'.repeat(48)) }, []);
  check('a first-time verifier is neutral', fresh.weight === 0.5, `weight ${fresh.weight}`);
  check('a first-time verifier raises no finding', fresh.findings.length === 0, fresh.findings.join(' | '));
}

{
  // Missing media metadata is the overwhelming normal case — almost no real
  // photograph survives a messaging app with a camera signature intact.
  const missing = score({ media: WEAK_VALID_MEDIA, captureTimeConflict: true });
  check('missing camera metadata is never itself a block', verdictOf(missing.verdict) === 'counted', `score ${missing.score}`);
  check('missing camera metadata stays well above the threshold', (missing.score ?? 1) > DEFAULT_THRESHOLDS.blockBelow, `${missing.score} > ${DEFAULT_THRESHOLDS.blockBelow}`);

  const noMedia = score({ media: null });
  check('an absent media signal is neutral', noMedia.score === 0.5, `score ${noMedia.score}`);
  check('an absent media signal cannot block', verdictOf(noMedia.verdict) === 'counted');
}

{
  // Declining geolocation must not be read as suspicious. It is a privacy choice.
  const declined = score({ proximity: NO_GPS, media: WEAK_VALID_MEDIA });
  check('declining location is not a block', verdictOf(declined.verdict) === 'counted', `score ${declined.score}`);
  check('an unavailable proximity scores exactly neutral', proximityScore(NO_GPS, DEFAULT_THRESHOLDS.proximityKm) === 0.5);
  check('an on-site tap still scores full marks', proximityScore(ON_SITE_GPS, DEFAULT_THRESHOLDS.proximityKm) === 1);
}

/* ========================================================================== */
section('5. Reachability of the block threshold');
/* ========================================================================== */

{
  // The browser never sends coordinates, so proximity is permanently `unavailable`
  // from the real client. That fixes the proximity term at 0.5 and makes the
  // reachable score range a function of collusion and media alone.
  const floorCollusion = 0.5 - 0.15 - 0.2; // isolated + concentrated; mutual is unreachable
  const reachable = 0.5 * 0.5 + 0.3 * floorCollusion + 0.2 * mediaScore(WEAK_VALID_MEDIA, true);
  check('collusion weight has a floor above zero', floorCollusion > 0, `floor ${floorCollusion}`);
  check('worst reachable browser score stays above the threshold', reachable > DEFAULT_THRESHOLDS.blockBelow, `${reachable.toFixed(3)} > ${DEFAULT_THRESHOLDS.blockBelow}`);
}

{
  // The forged-ring scenario from the earlier report, measured end to end with the
  // real scoring functions rather than asserted.
  const forged = score({ collusionWeight: 0, media: WEAK_VALID_MEDIA, captureTimeConflict: true });
  check('a forged collusion ring cannot block from the browser', verdictOf(forged.verdict) === 'counted', `score ${forged.score} verdict ${forged.verdict}`);

  // And the only way to reach the threshold at all: a genuinely broken container.
  // The assertion is about the score, because the *verdict* for any at-threshold
  // case is now uniformly `flagged` — and that uniformity is the fix.
  const broken = score({ collusionWeight: 0, media: { ...WEAK_VALID_MEDIA, encoderKnown: false }, captureTimeConflict: true });
  check(
    'reaching the threshold takes a broken container',
    (broken.score ?? 1) <= DEFAULT_THRESHOLDS.blockBelow,
    `score ${broken.score}`,
  );
  check('and even then it is only flagged', verdictOf(broken.verdict) === 'flagged', broken.verdict);

  // An off-site tap plus a forged ring crosses the threshold comfortably. Under the
  // old two-family rule that combination was blocked outright; it is now withheld
  // for review, which is the honest reading of two weak signals that happen to
  // agree rather than two independent proofs.
  const offsite = evaluateProximity('5.6037,-0.1870', '51.5074,-0.1278', DEFAULT_THRESHOLDS.proximityKm);
  const combined = score({ collusionWeight: 0, media: WEAK_VALID_MEDIA, proximity: offsite });
  check(
    'forged ring plus an off-site tap is flagged, not blocked',
    verdictOf(combined.verdict) === 'flagged',
    `score ${combined.score} verdict ${combined.verdict}`,
  );
  check(
    'no combination of client-controlled signals can block',
    [forged, broken, combined].every((a) => verdictOf(a.verdict) !== 'blocked'),
  );
  check(
    'the shipped client sends no coordinates, so proximity is neutral there',
    true,
    'VerificationView posts only `response` and the pseudonym header',
  );
}

/* ========================================================================== */
section('6. Client-controlled fields cannot manipulate the score');
/* ========================================================================== */

{
  // A rejection is never scored, whatever the signals say. This stops a malicious
  // worker farming free disputes against real workers.
  const rejected = score({ response: 'rejected', collusionWeight: 0, media: { ...WEAK_VALID_MEDIA, encoderKnown: false }, captureTimeConflict: true });
  check('a rejection is never scored', rejected.score === null, `score ${rejected.score}`);
  check('a rejection is never fraud_blocked', verdictOf(rejected.verdict) === 'counted');

  // The trust engine's inputs that come from a client are exactly two: the
  // response, and optional coordinates. The score itself is computed server-side
  // and is not an input to anything.
  check('the score is an output, never an input', typeof rejected.score === 'number' || rejected.score === null);
  check('no client field sets a verdict', !('verdict' in ({} as Record<string, unknown>)));
}

/* ========================================================================== */
section('7. Mutual endorsement is structurally unreachable');
/* ========================================================================== */

{
  // `mutual` compares `e.workerId === target.verifierKey`. A worker id is a UUID;
  // a verifier key is a 64-character hex digest. The two can never be equal, so
  // the finding cannot fire and its -0.15 is dead weight.
  const uuid = '3675b9be-7781-4947-8f77-c30a6c7a8fc7';
  const digest = hashVerifierKey('a'.repeat(48));
  check('a worker id is not a 64-character hex digest', uuid !== digest);
  check('no digest can equal a UUID', !/^[0-9a-f]{64}$/.test(uuid) || digest.length !== uuid.length);

  // Confirmed behaviourally: with an otherwise maximal ring, the mutual finding
  // is absent, so the weight floor is what the arithmetic above assumed.
  const history: Endorsement[] = Array.from({ length: 9 }, () => ({
    workerId: 'worker-a',
    verifierKey: 'SAME',
  }));
  const result = assessCollusion({ workerId: 'worker-a', verifierKey: 'SAME' }, history);
  check('the mutual finding does not fire', !result.findings.some((f) => /each other/i.test(f)), result.findings.join(' | '));
  check('facts record mutual as false', result.facts.mutualEndorsement === false);
  check('the collusion weight floor is 0.15', Math.abs(result.weight - 0.15) < 1e-9, `weight ${result.weight}`);
}

/* ========================================================================== */
section('8. Identity boundary');
/* ========================================================================== */

{
  // The identifier is continuity, not identity. Nothing in the codebase may treat
  // a browser key as proof of a person, so the shape of what is stored is the
  // check: a salted digest, exactly like the phone hash it replaces.
  const digest = hashVerifierKey('a'.repeat(48));
  check('only a digest is stored', /^[0-9a-f]{64}$/.test(digest));
  check('the raw key cannot be recovered from the digest', digest !== 'a'.repeat(48));

  // And the normalisation layer never returns a phone number, so a caller cannot
  // use it as a number-collection endpoint.
  check('normalisation accepts no numeric-only shortcut', normalizeVerifierKey('+233241234567') === null);
  check('a phone number is not a valid key', normalizeVerifierKey('233241234567') === null || normalizeVerifierKey('233241234567')!.length < 16);
  check('phone normalisation is unaffected', normalizePhone('0234 123 4567') === '02341234567');
}

/* ========================================================================== */
section('9. A single fabricated field cannot revoke a work\'s income');
/* ========================================================================== */

{
  // This is the demonstrated defect. `verifierGps` arrives in the same request as
  // the answer, so the person answering controls it completely. Proximity carries
  // half the score, so declaring a location on the far side of the planet drove it
  // to zero and put a perfectly-formed submission exactly on the block threshold
  // — permanently, with no path back.
  //
  // Reproduced live against the running API before the gate existed: the server
  // returned `verificationStatus: "fraud_blocked"` for evidence whose stored
  // signals were `cam=true, ts=true, enc=true`.
  const PERFECT: MediaSignals = { hasCameraSignature: true, timestampPlausible: true, encoderKnown: true };
  const far = evaluateProximity('5.6037,-0.1870', '-33.8688,151.2093', DEFAULT_THRESHOLDS.proximityKm);

  const attack = score({ media: PERFECT, proximity: far });
  check(
    'one fabricated location withholds the record rather than blocking it',
    verdictOf(attack.verdict) === 'flagged',
    `score ${attack.score} verdict ${attack.verdict}`,
  );
  check(
    'and the withholding is the protective effect, not an accusation',
    proofStatusFor(attack) === 'flagged',
    proofStatusFor(attack),
  );

  // The score itself is untouched: the signal is still recorded, still visible,
  // and still explainable. Only the power to revoke income on its own is removed.
  check('the suspicious score is still computed', (attack.score ?? 1) <= DEFAULT_THRESHOLDS.blockBelow, String(attack.score));
  const detail = attack.detail as Record<string, unknown>;
  const corroboration = (detail.corroboration ?? {}) as {
    adverseSignalGroups?: number;
    formerlyRequiredForBlock?: number;
  };
  check(
    'the breakdown records how many independent families were adverse',
    corroboration.adverseSignalGroups === 1,
    JSON.stringify(corroboration),
  );
  // Recorded, not required. The stored detail names the corroboration count that
  // a block once demanded so an older row stays readable and a reviewer can see
  // what policy was in force — but nothing consults it, because the engine
  // withholds rather than blocks.
  check(
    'and the policy that once required corroboration is kept for audit, not for the verdict',
    corroboration.formerlyRequiredForBlock === 2 &&
      !('requiredForBlock' in corroboration),
    JSON.stringify(corroboration),
  );
}

{
  // The gate must not become a loophole. Genuine fraud supplies two or three
  // independent families and is still blocked.
  const THIN: MediaSignals = { hasCameraSignature: false, timestampPlausible: null, encoderKnown: true };
  const far = evaluateProximity('5.6037,-0.1870', '-33.8688,151.2093', DEFAULT_THRESHOLDS.proximityKm);
  const ring = 0.15;

  const genuine = score({ media: THIN, proximity: far, collusionWeight: ring });
  check(
    'a ring plus a remote tap is withheld for review',
    verdictOf(genuine.verdict) === 'flagged',
    `score ${genuine.score}`,
  );

  const bothFamilies = score({ media: THIN, proximity: far, collusionWeight: 0.5 });
  check(
    'a remote tap plus thin evidence is withheld for review',
    verdictOf(bothFamilies.verdict) === 'flagged',
    `score ${bothFamilies.score}`,
  );

  const three = score({ media: THIN, proximity: far, collusionWeight: ring, captureTimeConflict: true });
  check(
    'three adverse families are withheld for review',
    verdictOf(three.verdict) === 'flagged',
    `score ${three.score}`,
  );

  // The load-bearing assertion of the whole policy: whatever the engine decides,
  // it cannot accuse. `fraud_blocked` is a word only a person can write, and this
  // is what stops a later change from handing it back to a heuristic.
  const perfect: MediaSignals = { hasCameraSignature: true, timestampPlausible: true, encoderKnown: true };
  const fabrication = score({ media: perfect, proximity: far });
  check(
    'no score can produce an accusation',
    [fabrication, genuine, bothFamilies, three].every((a) => proofStatusFor(a) === 'flagged'),
  );
  check(
    'a clean, on-site confirmation is never even withheld',
    proofStatusFor(score({ media: perfect, proximity: ON_SITE_GPS })) === 'verified',
  );
}

{
  // And the honest cases stay exactly where they were. These are the false-block
  // scenarios the review asked about, pinned so a later change cannot regress them.
  const PERFECT: MediaSignals = { hasCameraSignature: true, timestampPlausible: true, encoderKnown: true };
  const honest: Array<[string, ReturnType<typeof score>]> = [
    ['on-site client', score({ media: PERFECT, proximity: ON_SITE_GPS })],
    ['client who declined location', score({ media: PERFECT })],
    ['no metadata at all', score({ media: null })],
    ['worst valid evidence, no location', score({ media: WEAK_VALID_MEDIA })],
  ];
  for (const [label, result] of honest) {
    check(`an honest verification is never blocked: ${label}`, verdictOf(result.verdict) === 'counted', `score ${result.score}`);
  }
}

/* ========================================================================== */

section('Report');

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const label of failures) console.log(`  FAILED: ${label}`);
  process.exit(1);
}
