/**
 * Declared provenance for uploaded evidence.
 *
 * ## Why this is not a detector
 *
 * It is tempting to read Feature 2.4 as "call a service and find out", and the
 * honest answer is that a probabilistic detector cannot be trusted with a
 * worker's livelihood. Independently benchmarked in 2026 across 16 detector
 * families and 291 generators, the published zero-shot results are damning for
 * the idea:
 *
 * * No detector is reliable across datasets — rankings are near-uncorrelated
 *   between them, and accuracy spread across methods was 37 percentage points.
 * * Detection collapses on current commercial generators: Flux Dev, Firefly v4
 *   and Midjourney v7 were detected at roughly **18–30%** average accuracy.
 * * Accuracy by generation year fell from about 79% for 2020-era generators to
 *   about 38% for 2024 models.
 * * An independent audit of five commercial tools on 15 **authentic** press
 *   photographs found they declared real images AI-generated between 6% and
 *   **40%** of the time, and on heavily edited genuine images one tool found
 *   only 33%.
 *
 * Read plainly: a detector that is wrong about modern generators 70–80% of the
 * time, and wrong about real photographs up to 40% of the time, cannot decide
 * whether a worker keeps a verification. A false block costs an honest worker
 * real income; a missed synthetic image costs the network one bad record, which
 * a rejecting recipient can still catch by looking at the photograph.
 *
 * So this module reads only what is **cryptographically declared** by the file
 * itself. A C2PA Content Credentials manifest is a signed chain from the
 * capturing device or application. When one is present and its assertions are
 * internally consistent, the file is telling the truth about its own origin —
 * which is a fact, not a probability. When one is absent, **nothing is claimed
 * in either direction**, because the overwhelming majority of real photographs
 * carry none.
 *
 * That asymmetry is the whole design. Presence can raise confidence; absence
 * never lowers it. The output is recorded as provenance context, never as a
 * rejection reason, and nothing here claims to identify a generator.
 *
 * ## Deliberately out of scope
 *
 * * Calling a hosted detector (Sightengine, Hive, Verigin, and the rest). Their
 *   own published false-positive rates are the argument against them above, and
 *   each would additionally require shipping a worker's evidence to a third
 *   party — a privacy cost this project has already decided not to pay.
 * * Reading EXIF or software tags for this purpose. `media-scrub.ts` already
 *   derives and then destroys those; they are forgeable by anyone, which is
 *   exactly why they are weak evidence there and no evidence at all here.
 */

export type ProvenanceOutcome = 'declared_capture' | 'declared_synthetic' | 'none' | 'unreadable';

/** The IPTC namespace prefix the digital source type is declared under. */
const SOURCE_TYPE_URN = 'http://iptc.org/std/photometadata/photoshop/iptcExt/';

/**
 * A small reader for JPEG segments and PNG chunks, looking only for C2PA.
 *
 * C2PA data lives in a JPEG APP11 segment or a PNG `caBX` chunk. Verifying its
 * signature chain properly needs a full JUMBF/COSE parser, which is a large
 * dependency with its own update cadence — and this project does not take a new
 * runtime dependency for a signal that can only ever be advisory.
 *
 * So this reads the **declaration**, not the signature. That is a deliberate
 * downgrade in strength and the limit is stated plainly: an attacker who
 * fabricates a well-formed segment can make a synthetic file claim to be a
 * camera photograph. The consequence is bounded, because the only thing this
 * output is allowed to do is raise a question for a human — it can never reject
 * an upload, and a forged "capture" claim does not gain the worker a verified
 * badge. Nothing downstream treats `declared_capture` as proof.
 */
interface C2paFinding {
  present: boolean;
  /** The declared digital source type, when the segment carried one. */
  sourceType: string | null;
  /** The application or device named in the manifest, for the audit trail. */
  claimGenerator: string | null;
  readable: boolean;
}

const EMPTY_FINDING: C2paFinding = {
  present: false,
  sourceType: null,
  claimGenerator: null,
  readable: false,
};

/** IPTC photo metadata namespace prefix, where the digital source type is declared. */

/**
 * The published IPTC digital source types this module acts on.
 *
 * Grouped rather than compared one by one at the call site, because the decision
 * that matters is "does this file declare itself generated", and naming that
 * group once makes it impossible for a later edit to treat a benign type as
 * synthetic by accident.
 */
const SYNTHETIC_SOURCE_TYPES: ReadonlySet<string> = new Set([
  'trainedAlgorithmicMedia',
  'compositeSynthetic',
  'algorithmicMedia',
]);

const CAPTURE_SOURCE_TYPE = 'digitalCapture';

function scanBufferForC2pa(buffer: Buffer, label: string): C2paFinding {
  const asText = buffer.toString('latin1');

  // A JPEG carries C2PA in an APP11 segment (0xFFEB) holding a JUMBF box; a PNG
  // uses a `caBX` chunk. The segment marker alone is not sufficient evidence —
  // APP11 is also used by unrelated writers — so the namespace reference is
  // required for the reading to be treated as a declaration at all. That is what
  // keeps an ordinary JPEG with a coincidental APP11 segment out of the findings.
  const sourceIndex = asText.indexOf(SOURCE_TYPE_URN);
  const looksLikeC2pa =
    (label === 'jpeg' && buffer.includes(Buffer.from([0xff, 0xeb]))) ||
    asText.includes('c2pa') ||
    asText.includes('jumb');

  if (!looksLikeC2pa || sourceIndex === -1) {
    return { ...EMPTY_FINDING, present: sourceIndex !== -1 };
  }

  const sourceType = readValueAfter(asText, sourceIndex + SOURCE_TYPE_URN.length);

  // The claim generator is an ASCII string in the manifest; recorded only to make
  // a later decision auditable. It is not used to identify anything.
  const generatorMatch = /c2pa\.\w+|"claim_generator"\s*:\s*"([^"]+)"/.exec(asText);
  const claimGenerator = generatorMatch?.[1] ?? null;

  return { present: true, sourceType, claimGenerator, readable: sourceType !== null };
}

/**
 * Reads the digital source type that follows the IPTC namespace reference.
 *
 * The value appears in the manifest either as a bare token
 * (`…/iptcExt/trainedAlgorithmicMedia`) or inside a CBOR string
 * (`"digitalSourceType":"http://…/trainedAlgorithmicMedia"`). Both are accepted,
 * because both occur in the wild and reading only one would silently miss half
 * the manifests that exist. The URN is stripped so the caller sees the bare type
 * name and never has to know where it came from.
 */
function readValueAfter(text: string, from: number): string | null {
  // The value is the last path segment, but the namespace is a prefix of a longer
  // URN whose intermediate segment varies (`…/iptcExt/digitalSourceType/
  // trainedAlgorithmicMedia` on some writers, `…/iptcExt/ResourceDesc/…` on
  // others). Taking the first segment would read "ResourceDesc" — a field name,
  // not a value — so the value is searched for by its known vocabulary instead.
  const slice = text.slice(from, from + 200);
  for (const candidate of KNOWN_SOURCE_TYPES) {
    if (slice.includes(candidate)) return candidate;
  }
  return null;
}

/**
 * The digital source types this module can name.
 *
 * A closed vocabulary, so an unrecognised manifest yields "nothing to say" rather
 * than a guess. Every entry is a published IPTC value, not a pattern.
 */
const KNOWN_SOURCE_TYPES = [
  ...SYNTHETIC_SOURCE_TYPES,
  CAPTURE_SOURCE_TYPE,
  'negativeFilm',
  'positiveFilm',
] as const;

/**
 * Reads declared provenance from media, before its metadata is discarded.
 *
 * Never throws. A file that cannot be read yields `unreadable`, which is treated
 * as "nothing to say" rather than as a problem.
 */
export function readDeclaredProvenance(
  buffer: Buffer,
  contentType: string,
): { outcome: ProvenanceOutcome; finding: C2paFinding } {
  const type = contentType.toLowerCase();
  if (!type.startsWith('image/')) {
    // Audio carries no visual provenance and no Content Credentials manifest.
    return { outcome: 'none', finding: EMPTY_FINDING };
  }

  let finding: C2paFinding;
  try {
    if (type === 'image/jpeg') finding = scanBufferForC2pa(buffer, 'jpeg');
    else if (type === 'image/png') finding = scanBufferForC2pa(buffer, 'png');
    else finding = EMPTY_FINDING; // WebP and HEIC carry no C2PA in practice today.
  } catch {
    return { outcome: 'unreadable', finding: EMPTY_FINDING };
  }

  if (!finding.present) return { outcome: 'none', finding };
  if (!finding.readable || finding.sourceType === null) return { outcome: 'unreadable', finding };

  if (SYNTHETIC_SOURCE_TYPES.has(finding.sourceType)) {
    return { outcome: 'declared_synthetic', finding };
  }
  if (finding.sourceType === CAPTURE_SOURCE_TYPE) return { outcome: 'declared_capture', finding };

  // A manifest exists and is readable but declares something this module has no
  // opinion about (a composite, a screenshot with edits). That is not a finding.
  return { outcome: 'none', finding };
}

export interface ProvenanceAssessment {
  outcome: ProvenanceOutcome;
  /** Safe to store and to log. Never names a detector or claims a score. */
  summary: string;
  /** The declared source type, for the audit trail. Null when nothing was read. */
  declaredSourceType: string | null;
  /** Whether this may justify showing a file to a human reviewer. */
  warrantsReview: boolean;
}

/**
 * Turns a declared-provenance reading into a decision aid.
 *
 * The mapping is deliberately asymmetric and is the reason this module cannot
 * become a false-accusation machine:
 *
 * * `declared_synthetic` → **review**, never rejection. The file says it was
 *   made by a generative model. That is worth a human's attention, and it is not
 *   proof, so it blocks nothing.
 * * `declared_capture` → recorded as provenance context and nothing more.
 * * `none` / `unreadable` → **no finding at all**, which is the overwhelmingly
 *   common case and is treated as ordinary.
 *
 * There is no branch in which a file is refused for its provenance, because a
 * signature was not verified and a detector was not consulted.
 */
export function assessDeclaredProvenance(input: {
  outcome: ProvenanceOutcome;
  finding: C2paFinding;
}): ProvenanceAssessment {
  const { outcome, finding } = input;

  if (outcome === 'declared_synthetic') {
    return {
      outcome,
      summary: `The file declares it was produced by a generative model (${finding.sourceType}). It has been kept for review rather than accepted or refused.`,
      declaredSourceType: finding.sourceType,
      warrantsReview: true,
    };
  }

  if (outcome === 'declared_capture') {
    return {
      outcome,
      summary:
        'The file carries a provenance claim of camera capture. Its signature was not verified here, so treat it as context and not as a guarantee.',
      declaredSourceType: finding.sourceType,
      warrantsReview: false,
    };
  }

  if (outcome === 'unreadable') {
    return {
      outcome,
      summary: 'A provenance manifest was present but could not be read. Treated as no information.',
      declaredSourceType: null,
      warrantsReview: false,
    };
  }

  return {
    outcome: 'none',
    summary: 'The file carries no signed provenance claim. Most real photographs do not, and that is not a finding.',
    declaredSourceType: null,
    warrantsReview: false,
  };
}
