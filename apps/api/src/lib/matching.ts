/**
 * Read-time aggregation for zero-knowledge talent search.
 *
 * Feature 4.2 ranks candidates on verified performance metrics, and those metrics
 * must be derived from proof records rather than read off the worker, because the
 * worker is exactly what must not be disclosed.
 *
 * Nothing here is cached. `capability_blocks.proof_count` and `last_verified_at`
 * existed until migration 0004 and no code path ever wrote them, so they always
 * read zero; a search that trusted them would rank on a lie. Aggregating from
 * `work_proof_logs` at read time costs an indexed scan over a few thousand rows at
 * pre-launch volume and cannot drift out of step with the proofs it summarises.
 */
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { capabilityBlocks, profiles, verifications, workProofLogs } from '../db/schema.js';
import type { Coordinate } from './geo.js';
import { distanceKm, parseCoordinate } from './geo.js';

/**
 * One worker's standing for one skill, with no identity attached.
 *
 * `trustScore` is the mean fraud score of the confirmations behind the counted
 * verified proofs, where 1 is fully supported. It is null rather than 0 when
 * nothing has been scored: a worker with no scored verifications has an unknown
 * trust profile, and reporting that as zero would rank them below a worker whose
 * proofs were confirmed on weak supporting evidence. Absence is not badness.
 *
 * It covers the same records as `verifiedProofs` and no others. A proof the
 * platform is withholding is an open question, and a question must not be able to
 * lower a score — otherwise "flagged" would be a quiet penalty after all, and one
 * that an overturned review could never undo.
 */
export interface CandidateMetric {
  workerId: string;
  verifiedProofs: number;
  rejectedProofs: number;
  /** Withheld pending a human decision. Not a finding against the worker. */
  flaggedProofs: number;
  /** Withheld after a person upheld it. */
  fraudBlockedProofs: number;
  trustScore: number | null;
  lastVerifiedAt: Date | null;
  /**
   * The name shown to an employer, and their photo, when they have one.
   *
   * Both are read here rather than joined in later so that they are subject to
   * exactly the same `discoverable` filter as the counts beside them. A worker who
   * has opted out of search must not become visible merely because a name was
   * attached to the row after the counts were chosen.
   */
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * The words a skill search must all appear in, for a skill tag to match.
 *
 * An employer typing "solar" means the worker who logged "Solar Panel
 * Installation", and the previous equality test required them to reproduce the
 * worker's own wording exactly — capitalisation and all — before anything came
 * back. That is not a reasonable thing to ask of someone looking for help.
 *
 * Every returned term must appear in the tag, so a multi-word query narrows and a
 * single word broadens, which is what a person expects from the two. Splitting on
 * non-alphanumerics rather than spaces keeps punctuation out of the terms, which
 * also means no term can contain a `LIKE` wildcard and the pattern needs no
 * escaping.
 *
 * Terms shorter than three characters are dropped. "a", "of" and "in" appear in a
 * large share of real skill tags, so matching on them would return most of the
 * network for a query carrying no intent. A query left with no usable term at all
 * falls back to the whole trimmed string, so it still narrows rather than matching
 * everything.
 */
const MIN_SEARCH_TERM_LENGTH = 3;

export function skillSearchTerms(skillTag: string): string[] {
  const terms = skillTag
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((term) => term.length >= MIN_SEARCH_TERM_LENGTH);

  if (terms.length > 0) return terms;

  const whole = skillTag.trim().toLowerCase();
  return whole.length > 0 ? [whole] : [];
}

/**
 * Aggregates per-worker metrics for one skill tag.
 *
 * Only `verified` proofs count toward `verifiedProofs`, `trustScore` and
 * `lastVerifiedAt`. A `flagged` proof is withheld pending a person and a
 * `fraud_blocked` one was upheld after review; the entire purpose of the engine
 * is that a withheld proof carries no weight, so folding either into a total
 * would undo that work at the one place where a number is displayed to a third
 * party. They are tallied separately, for an administrator, and never added in.
 *
 * Rejections are counted as context, not as evidence against the worker: a
 * rejection is never scored, per `doc/13` E-019, so it says something about the
 * client who refused rather than about the work.
 *
 * Proofs are counted with `count(distinct ...)` rather than `count(*)` because a
 * proof can legitimately accumulate more than one verification row over its life,
 * and a plain count would inflate every metric for anyone who has re-sent a link.
 *
 * Skill tags match case-insensitively. A worker who records "Welding" and an
 * employer who searches "welding" are describing the same skill, and a
 * case-sensitive join would report the network as empty.
 */
export async function aggregateCandidateMetrics(
  skillTag: string,
  minVerifiedProofs: number,
): Promise<CandidateMetric[]> {
  // Every term must appear somewhere in the stored tag, case-insensitively. An
  // empty term list — a query that was nothing but punctuation — matches nothing,
  // because returning the whole network for a query with no words in it is the one
  // outcome a search must never produce.
  const terms = skillSearchTerms(skillTag);
  // A query with no usable term matches nothing. Left to the query builder an
  // empty condition list would match every worker with verified proof, so the
  // refusal is made here where it can be explicit.
  if (terms.length === 0) return [];
  const tagMatches = terms.map((term) => sql`lower(${capabilityBlocks.skillTag}) like ${`%${term}%`}`);

  const verified = sql<number>`count(distinct ${workProofLogs.id}) filter (where ${workProofLogs.verificationStatus} = 'verified')::int`;
  const rejected = sql<number>`count(distinct ${workProofLogs.id}) filter (where ${workProofLogs.verificationStatus} = 'rejected')::int`;
  // Split rather than lumped, because the two are different claims. `flagged` is
  // the engine withholding a record pending a human; `fraud_blocked` is a person
  // having upheld that. An employer shown a single combined "fraud" count would
  // read the automatic one as a judgement nobody made.
  const flagged = sql<number>`count(distinct ${workProofLogs.id}) filter (where ${workProofLogs.verificationStatus} = 'flagged')::int`;
  const blocked = sql<number>`count(distinct ${workProofLogs.id}) filter (where ${workProofLogs.verificationStatus} = 'fraud_blocked')::int`;

  const rows = await db
    .select({
      workerId: workProofLogs.workerId,
      verifiedProofs: verified.as('verified_proofs'),
      rejectedProofs: rejected.as('rejected_proofs'),
      flaggedProofs: flagged.as('flagged_proofs'),
      fraudBlockedProofs: blocked.as('fraud_blocked_proofs'),
      // Scored over the confirmations behind *verified* proofs, and nothing else.
      //
      // Averaging over proof rows instead would fold unscored and pending proofs
      // in as if they scored zero, dragging every new worker toward distrust.
      //
      // The `filter` is the part that matters. Without it the average covers every
      // confirmed verification, including the ones behind a `flagged` or a
      // `fraud_blocked` record — so a proof the platform explicitly refuses to
      // call fraud would still permanently lower a worker's score in an employer's
      // search, and still rank them below someone else. That is the engine's
      // withholding reading as a penalty, which is precisely what the three-way
      // outcome policy exists to prevent. Worse, it is unrecoverable: an admin who
      // overturns the flag restores the proof but not the score it dragged down.
      //
      // With the filter, `trustScore` describes exactly the proofs counted in
      // `verifiedProofs`, so the number and the score always agree, and restoring
      // a record restores the score with it.
      trustScore: sql<string | null>`avg(${verifications.fraudScore}) filter (where ${workProofLogs.verificationStatus} = 'verified')`.as('trust_score'),
      // The same filter, for the same reason. A date a withheld record supplied is
      // not evidence of this worker having done verified work, and reporting it as
      // "last verified" would show an employer a recency the record does not have.
      lastVerifiedAt: sql<string | null>`max(${verifications.completedAt}) filter (where ${workProofLogs.verificationStatus} = 'verified')`.as('last_verified_at'),
      // Carried through the aggregation rather than looked up afterwards, so the
      // name and photo are subject to the same `discoverable` gate as the numbers
      // they sit beside. Grouping by them as well keeps `only_full_group_by` happy.
      displayName: sql<string | null>`max(${profiles.fullName})`.as('display_name'),
      avatarUrl: sql<string | null>`max(${profiles.avatarUrl})`.as('avatar_url'),
    })
    .from(workProofLogs)
    .innerJoin(
      capabilityBlocks,
      and(eq(capabilityBlocks.id, workProofLogs.capabilityBlockId), and(...tagMatches)),
    )
    .leftJoin(
      verifications,
      and(eq(verifications.workProofId, workProofLogs.id), eq(verifications.response, 'confirmed')),
    )
    .leftJoin(profiles, eq(profiles.userId, workProofLogs.workerId))
    .where(
      and(
        // Anonymised records, whose worker deleted their account, are still counted
        // for the network but cannot be offered to anyone: there is no account to
        // address, and issuing a handle for one would violate the candidate_handles
        // foreign key. Without this they would group together under a null worker
        // and surface as a single candidate row with no identity behind it.
        //
        // Excluding them changes no live worker's numbers. Each row is grouped by
        // its own worker, so dropping one worker's anonymised rows removes only
        // their own contribution — which is precisely the retention promise: the
        // row stays, and it stops being anybody's turn to be hired.
        isNotNull(workProofLogs.workerId),
        // A worker who opted out of discoverability is excluded at this layer,
        // so a search token cannot be crafted to probe for them. A missing
        // profile row (an admin-provisioned account) counts as the default,
        // which is discoverable.
        or(isNull(profiles.userId), eq(profiles.discoverable, true)),
      ),
    )
    .groupBy(workProofLogs.workerId, profiles.fullName, profiles.avatarUrl)
    .having(sql`count(distinct ${workProofLogs.id}) filter (where ${workProofLogs.verificationStatus} = 'verified') >= ${minVerifiedProofs}`)
    .orderBy(sql`verified_proofs desc, trust_score desc nulls last`);

  // As in the collusion history, the `isNotNull` above is a runtime filter only:
  // drizzle 0.45 returns a plain `SQL` from it, so the compiler still sees
  // `string | null`. The guard is kept rather than cast away, because a null here
  // would reach `issueCandidateHandle` and violate its foreign key.
  return rows.flatMap((row) =>
    row.workerId === null
      ? []
      : [
          {
            workerId: row.workerId,
            verifiedProofs: Number(row.verifiedProofs),
            rejectedProofs: Number(row.rejectedProofs),
            flaggedProofs: Number(row.flaggedProofs),
            fraudBlockedProofs: Number(row.fraudBlockedProofs),
            trustScore: row.trustScore === null ? null : Number(row.trustScore),
            lastVerifiedAt: toDate(row.lastVerifiedAt),
            // A worker who never set a name still has to be distinguishable from
            // another nameless worker, so the handle stands in rather than the
            // card carrying nothing. The card shows the initial wherever one
            // exists.
            displayName: row.displayName,
            avatarUrl: row.avatarUrl,
          },
        ],
  );
}

/**
 * Normalises a value that may arrive as a `Date` or as a timestamp string.
 *
 * Wrapping an aggregate in `sql<Date>` is a TypeScript assertion and nothing more:
 * it tells the compiler, not the driver. A bare `max(completed_at)` comes back from
 * `pg` as a string, so a call to `.toISOString()` on the asserted value throws a
 * `TypeError` at runtime and the whole search 500s. The type is taken from the
 * aggregate's result rather than the column's, and it is not the type the column
 * alone declares.
 */
function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Reads the stored location for a set of workers.
 *
 * Returns a map keyed by worker id, omitting anyone who shared no usable location.
 * The coordinates are not returned to the client: a distance in kilometres is
 * enough to rank and to filter, and it does not hand an employer a fix on
 * someone's home or workplace.
 */
export async function readWorkerLocations(
  workerIds: readonly string[],
): Promise<Map<string, Coordinate>> {
  const locations = new Map<string, Coordinate>();
  if (workerIds.length === 0) return locations;

  const rows = await db
    .select({ workerId: profiles.userId, locationGps: profiles.locationGps })
    .from(profiles)
    .where(inArray(profiles.userId, [...workerIds]));

  for (const row of rows) {
    const coordinate = parseCoordinate(row.locationGps);
    if (coordinate) locations.set(row.workerId, coordinate);
  }

  return locations;
}

/**
 * Distances for the candidates whose location could be measured.
 *
 * Callers decide what to do with the ones absent from the result. A worker who
 * shared no location is not "far away": it is unknown, and dropping them would
 * hide most of a network that has not opted into geolocation, while treating them
 * as nearby would assert a proximity that was never established. Callers should
 * label them explicitly rather than folding them into either bucket.
 */
export function measureDistances(
  metrics: readonly CandidateMetric[],
  locations: ReadonlyMap<string, Coordinate>,
  reference: Coordinate,
): Map<string, number> {
  const distances = new Map<string, number>();
  for (const metric of metrics) {
    const location = locations.get(metric.workerId);
    if (location) distances.set(metric.workerId, distanceKm(reference, location));
  }
  return distances;
}