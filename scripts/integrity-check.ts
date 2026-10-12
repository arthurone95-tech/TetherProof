/**
 * Unit assertions for the evidence-integrity gate.
 *
 *   npm run integrity-check
 *
 * No server, database, or live project is involved. These are the cases that
 * decide whether an honest worker keeps their evidence, so they are asserted
 * directly rather than through mocks.
 *
 * The assertions that matter most are the negative ones: that a file with no
 * metadata is *accepted*, and that nothing here can be read as a claim to detect
 * AI-generated media. A gate that quietly became a detector would be the worst
 * possible outcome of this module, because it would be enforcing something it
 * cannot actually do.
 */
import { EVIDENCE_REASONS, assessEvidenceIntegrity } from '../apps/api/src/lib/media-integrity.js';
import {
  assessDeclaredProvenance,
  readDeclaredProvenance,
} from '../apps/api/src/lib/media-provenance.js';
import type { MediaSignals } from '../apps/api/src/lib/media-scrub.js';
import { assessCollusion, type Endorsement } from '../apps/api/src/lib/fraud/collusion.js';
import { assess, DEFAULT_THRESHOLDS, proofStatusFor } from '../apps/api/src/lib/fraud/score.js';
import { evaluateProximity } from '../apps/api/src/lib/fraud/proximity.js';
import { hashVerifierKey, hashVerifierPhone } from '../apps/api/src/lib/token.js';
import { normalizeVerifierKey } from '../apps/api/src/lib/verifier-key.js';

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

const signals = (over: Partial<MediaSignals> = {}): MediaSignals => ({
  hasCameraSignature: null,
  timestampPlausible: null,
  encoderKnown: null,
  ...over,
});

/* ------------------------------------------------------------------------ */

section('A clean file is accepted');

{
  const result = assessEvidenceIntegrity({
    signals: signals({ hasCameraSignature: true, timestampPlausible: true, encoderKnown: true }),
    contentType: 'image/jpeg',
  });

  check('a fully-signed photograph is accepted', result.outcome === 'accepted', result.outcome);
  check('an accepted file reports no findings', result.findings.length === 0, result.findings.join('|'));
  check('an accepted file carries the neutral reason', result.reason === EVIDENCE_REASONS.ok);
}

/* ------------------------------------------------------------------------ */

section('Missing metadata is NOT a finding');

{
  // The single most important assertion in this file. A file with no camera
  // signature and no capture time is what arrives after any messaging app has
  // re-compressed it, and it is the large majority of genuine evidence. Treating
  // it as suspicious would punish honest workers and hand anyone a one-step way to
  // make a file look innocent.
  const result = assessEvidenceIntegrity({
    signals: signals({ hasCameraSignature: false, timestampPlausible: null, encoderKnown: true }),
    contentType: 'image/jpeg',
  });

  check('a file with no camera signature is still accepted', result.outcome === 'accepted', result.outcome);
  check('absence of a signature cannot reject', result.outcome !== 'rejected');
  check(
    'the absence is recorded as context without changing the outcome',
    result.findings.includes(EVIDENCE_REASONS.noCameraSignature),
    result.findings.join('|'),
  );
}

{
  // Audio carries no camera signature and no capture time at all. All three
  // signals are null, which means "not determinable", never "false".
  const result = assessEvidenceIntegrity({
    signals: signals(),
    contentType: 'audio/mp4',
  });

  check('an audio file with no applicable signals is accepted', result.outcome === 'accepted', result.outcome);
  check('an audio file produces no findings', result.findings.length === 0, result.findings.join('|'));
}

/* ------------------------------------------------------------------------ */

section('Structural failure is rejected');

{
  const result = assessEvidenceIntegrity({
    signals: signals({ encoderKnown: false }),
    contentType: 'image/png',
  });

  check('a container that is not what it claims is rejected', result.outcome === 'rejected', result.outcome);
  check(
    'the rejection reason is the container, never a detector',
    result.reason === EVIDENCE_REASONS.unreadableContainer,
    result.reason,
  );
}

{
  // Rejection must not depend on anything else being present or absent. A file
  // that is structurally broken is refused whatever its metadata says.
  const result = assessEvidenceIntegrity({
    signals: signals({
      encoderKnown: false,
      hasCameraSignature: true,
      timestampPlausible: true,
    }),
    contentType: 'image/jpeg',
  });

  check('a perfect capture signature does not rescue a broken container', result.outcome === 'rejected', result.outcome);
}

/* ------------------------------------------------------------------------ */

section('Contradictory capture time needs review, not refusal');

{
  const result = assessEvidenceIntegrity({
    signals: signals({ timestampPlausible: false, encoderKnown: true }),
    contentType: 'image/jpeg',
  });

  check('a contradictory timestamp is flagged for review', result.outcome === 'needs_review', result.outcome);
  check('it is not rejected outright', result.outcome !== 'rejected');
  check(
    'the finding names the contradiction',
    result.findings.includes(EVIDENCE_REASONS.contradictoryCaptureTime),
    result.findings.join('|'),
  );
}

/* ------------------------------------------------------------------------ */

section('No outcome claims to detect generated media');

{
  const all = [
    assessEvidenceIntegrity({ signals: signals({ encoderKnown: true }), contentType: 'image/png' }),
    assessEvidenceIntegrity({ signals: signals({ encoderKnown: false }), contentType: 'image/png' }),
    assessEvidenceIntegrity({ signals: signals({ timestampPlausible: false }), contentType: 'image/jpeg' }),
  ];

  const reasons = all.map((r) => r.reason).join(' ').toLowerCase();
  const findings = all.flatMap((r) => r.findings).join(' ').toLowerCase();

  check('no reason mentions AI', !reasons.includes('ai '), reasons);
  check('no reason claims generation or synthesis', !reasons.includes('generat') && !reasons.includes('synthet'), reasons);
  check('no finding mentions a detector', !findings.includes('detect'), findings);
  check('no outcome is named "fake"', !all.some((r) => r.outcome.includes('fake')), all.map((r) => r.outcome).join('|'));
}

/* ------------------------------------------------------------------------ */

section('Declared provenance is read, never guessed');

{
  // A file with no manifest is the ordinary case and must say nothing.
  const plain = readDeclaredProvenance(Buffer.from('not really a jpeg at all'), 'image/jpeg');
  check('a file with no manifest reports none', plain.outcome === 'none', plain.outcome);
  check(
    'no manifest produces no review',
    assessDeclaredProvenance(plain).warrantsReview === false,
  );

  // Audio has no visual provenance; it must not be treated as suspicious for that.
  const audio = readDeclaredProvenance(Buffer.from('ID3somemp3data'), 'audio/mpeg');
  check('audio reports no provenance claim', audio.outcome === 'none', audio.outcome);
}

{
  // A manifest that declares a generative model is a question for a human, never
  // a refusal. This is the single most important behaviour in this section: the
  // signature was not verified and no detector was consulted, so blocking on this
  // would be a false claim of detection.
  const declaring = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xeb]),
    Buffer.from('c2pa.claim_generator', 'latin1'),
    Buffer.from('http://iptc.org/std/photometadata/photoshop/iptcExt/ResourceDesc/trainedAlgorithmicMedia', 'latin1'),
  ]);
  const read = readDeclaredProvenance(declaring, 'image/jpeg');
  check('a generated declaration is read', read.outcome === 'declared_synthetic', read.outcome);

  const assessed = assessDeclaredProvenance(read);
  check('it warrants review', assessed.warrantsReview === true);
  check(
    'it records the declared source type',
    assessed.declaredSourceType === 'trainedAlgorithmicMedia',
    String(assessed.declaredSourceType),
  );
  check(
    'the summary names no detector and no score',
    !/detect|score|probability|%/i.test(assessed.summary),
    assessed.summary,
  );
}

{
  const capture = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xeb]),
    Buffer.from('c2pa.claim_generator', 'latin1'),
    Buffer.from('http://iptc.org/std/photometadata/photoshop/iptcExt/ResourceDesc/digitalCapture', 'latin1'),
  ]);
  const read = readDeclaredProvenance(capture, 'image/jpeg');
  check('a capture declaration is read', read.outcome === 'declared_capture', read.outcome);

  const assessed = assessDeclaredProvenance(read);
  check('a capture claim warrants no review', assessed.warrantsReview === false);
  check(
    'a capture claim is explicitly not a guarantee',
    /not a guarantee|context/i.test(assessed.summary),
    assessed.summary,
  );
  // The wording must never let a reader take an unverified declaration for proof.
  // "verified" is allowed only in the sentence that says the signature was *not*
  // verified, so the check looks for the word used affirmatively rather than
  // banning it outright.
  check(
    'a capture claim is never described as proof',
    !/\b(proven|certain|authentic)\b/i.test(assessed.summary) &&
      !/\bis verified\b/i.test(assessed.summary),
    assessed.summary,
  );
}

{
  // WebP and HEIC carry no manifest today; they must be silent, not "unreadable".
  const webp = readDeclaredProvenance(Buffer.from('RIFF____WEBPVP8 '), 'image/webp');
  check('webp reports no claim rather than an error', webp.outcome === 'none', webp.outcome);

  const heic = readDeclaredProvenance(Buffer.from('\0\0\0 ftypmif1'), 'image/heic');
  check('heic reports no claim rather than an error', heic.outcome === 'none', heic.outcome);
}

/* ------------------------------------------------------------------------ */

section('Verifier pseudonyms restore the collusion signal');

{
  // The gap: with no identity on an answer, the engine cannot see a ring. This
  // pins the behaviour that made the gap invisible — an absent key is neutral,
  // never a penalty — so restoring identity cannot be done by making absence
  // suspicious.
  const anonymous = assessCollusion({ workerId: 'worker-a', verifierKey: null }, []);
  check('an unidentified verifier is neutral', anonymous.weight === 0.5, String(anonymous.weight));
  check('an unidentified verifier is not evaluated', anonymous.evaluated === false);
}

{
  // What a self-generated pseudonym buys. The fixture mirrors the shape the smoke
  // suite drives: one client approving the same worker again and again. That is
  // both what a closed ring looks like and what a site supervisor legitimately
  // looks like, which is why the engine needs repetition *and* isolation before
  // it moves the score.
  const history: Endorsement[] = Array.from({ length: 5 }, () => ({
    workerId: 'worker-a',
    verifierKey: 'HASH',
  }));

  const seen = assessCollusion({ workerId: 'worker-a', verifierKey: 'HASH' }, history);
  const unseen = assessCollusion({ workerId: 'worker-a', verifierKey: null }, history);

  check('a recognised verifier is evaluated', seen.evaluated === true);
  check(
    'recognition lowers the weight below neutral',
    seen.weight < unseen.weight,
    `${seen.weight} vs ${unseen.weight}`,
  );
  check(
    'concentration is detected when the pattern warrants it',
    seen.findings.some((f) => /large share|only one worker/i.test(f)),
    seen.findings.join(' | '),
  );
  check('the score never drops below zero', seen.weight >= 0 && seen.weight <= 1, String(seen.weight));
}

{
  // A verifier who approves many *different* workers is the ordinary case for a
  // training provider or an inspector, and must not be treated as a ring.
  const diverse: Endorsement[] = Array.from({ length: 6 }, (_, i) => ({
    workerId: `worker-${i}`,
    verifierKey: 'HASH',
  }));
  const broad = assessCollusion({ workerId: 'worker-new', verifierKey: 'HASH' }, diverse);
  check('approving many different workers raises no finding', broad.findings.length === 0, broad.findings.join(' | '));
  check('that verifier stays neutral', broad.weight === 0.5, String(broad.weight));
}

{
  // **Abuse property.** A pseudonym arrives from an unauthenticated caller, so it
  // can be forged, and a forged ring must not become a weapon for a competitor to
  // revoke someone else's verification.
  //
  // The boundary was measured rather than assumed, and it is worth stating
  // precisely. With collusion driven all the way to its floor, a worker is still
  // safe as long as their file is a structurally sound container — which every
  // stored upload is, because a broken one is refused at submission and never
  // reaches a verification at all. Reaching the block threshold would additionally
  // require `encoderKnown: false`, i.e. evidence that could not exist here.
  const forged = assess(
    {
      response: 'confirmed',
      proximity: evaluateProximity('5.6037,-0.1870', null, DEFAULT_THRESHOLDS.proximityKm),
      collusion: { weight: 0, evaluated: true, findings: [], facts: {} },
      // The worst a stored proof can actually be: no camera signature and a
      // contradictory clock, but a container that is genuinely what it claims.
      media: { hasCameraSignature: false, timestampPlausible: false, encoderKnown: true },
      captureTimeConflict: true,
    },
    DEFAULT_THRESHOLDS,
  );

  check(
    'a forged ring cannot block a worker whose file is a sound container',
    forged.verdict === 'counted',
    `score=${forged.score} verdict=${forged.verdict} threshold=${DEFAULT_THRESHOLDS.blockBelow}`,
  );
  check(
    'the worst reachable stored proof stays above the threshold',
    (forged.score ?? 1) > DEFAULT_THRESHOLDS.blockBelow,
    String(forged.score),
  );

  // And the case that *would* cross the threshold is asserted too, so this test
  // documents the boundary rather than only the safe side of it. It requires a
  // broken container, which `uploadWorkProofMedia` refuses before a verification
  // exists.
  //
  // The assertion is about the score, not the verdict. Every at-or-below-threshold
  // outcome is now `flagged` — the engine withholds and queues a person, and
  // `fraud_blocked` is reachable only through the admin review path, which no
  // scoring function can enter. Asserting `blocked` here would be asserting the
  // behaviour this policy deliberately removed.
  const unreachable = assess(
    {
      response: 'confirmed',
      proximity: evaluateProximity('5.6037,-0.1870', null, DEFAULT_THRESHOLDS.proximityKm),
      collusion: { weight: 0, evaluated: true, findings: [], facts: {} },
      media: { hasCameraSignature: false, timestampPlausible: false, encoderKnown: false },
      captureTimeConflict: true,
    },
    DEFAULT_THRESHOLDS,
  );
  check(
    'crossing the threshold on a forged ring would need a file that cannot be stored',
    (unreachable.score ?? 1) <= DEFAULT_THRESHOLDS.blockBelow,
    `score=${unreachable.score} verdict=${unreachable.verdict}`,
  );
  check(
    'and even that case is withheld rather than called fraud',
    unreachable.verdict === 'flagged',
    unreachable.verdict,
  );
  check(
    'no score the engine can produce is an accusation',
    [forged, unreachable].every((a) => proofStatusFor(a) === (a === unreachable ? 'flagged' : 'verified')),
    `${proofStatusFor(forged)} / ${proofStatusFor(unreachable)}`,
  );
}

{
  // Normalisation is what makes two spellings of one token the same verifier.
  const a = normalizeVerifierKey('ABCdef0123456789ABCdef0123456789');
  const b = normalizeVerifierKey('abcdef0123456789abcdef0123456789');
  check('a pseudonym normalises to itself', a === 'abcdef0123456789abcdef0123456789', String(a));
  check('case does not create two verifiers', a === b);

  check('a short value is refused', normalizeVerifierKey('short') === null);
  check('an over-long value is refused', normalizeVerifierKey('a'.repeat(65)) === null);
  check('a value with punctuation is refused', normalizeVerifierKey('has spaces and !') === null);
  check('an empty value is refused', normalizeVerifierKey('') === null);
  check('null is refused', normalizeVerifierKey(null) === null);

  // A key hash must not be able to collide with a phone hash: both are 64 hex
  // characters over the same salt, so the domain separation is load-bearing.
  const keyHash = hashVerifierKey('abcdef0123456789abcdef0123456789');
  const phoneHash = hashVerifierPhone('+233241234567');
  check('a key hash is 64 hex characters', /^[0-9a-f]{64}$/.test(keyHash));
  check('a key hash cannot equal a phone hash', keyHash !== phoneHash);
  check('the same pseudonym always hashes the same', keyHash === hashVerifierKey('abcdef0123456789abcdef0123456789'));
}

/* ------------------------------------------------------------------------ */

section('Report');

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const label of failures) console.log(`  FAILED: ${label}`);
  process.exit(1);
}
