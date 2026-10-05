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
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { capabilityBlocks, profiles, verifications, workProofLogs } from '../db/schema.js';
import type { Coordinate } from './geo.js';
import { distanceKm, parseCoordinate } from './geo.js';

/**
 * One worker's standing for one skill, with no identity attached.
 *
 * `trustScore` is the mean fraud score of the confirmations behind the counted
 * proofs, where 1 is fully supported. It is null rather than 0 when nothing has
 * been scored: a worker with no scored verifications has an unknown trust
 * profile, and reporting that as zero would rank them below a worker whose proofs
 * were confirmed on weak supporting evidence. Absence is not badness.
 */
export interface CandidateMetric {
  workerId: string;
  verifiedProofs: number;
  rejectedProofs: number;
  fraudBlockedProofs: number;
  trustScore: number | null;
  lastVerifiedAt: Date | null;
}

/**
 * Aggregates per-worker metrics for one skill tag.
 *
 * Only `verified` proofs count toward `verifiedProofs`, and `fraud_blocked` proofs
 * are tallied separately and never added in. The entire purpose of the anti-fraud
 * engine is that a blocked proof carries no weight, so folding it into a total
 * would undo that work at the one place where a number is displayed to a third
 * party.
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
  const verified = sql<number>`count(distinct ${workProofLogs.id}) filter (where ${workProofLogs.verificationStatus} = 'verified')::int`;
  const rejected = sql<number>`count(distinct ${workProofLogs.id}) filter (where ${workProofLogs.verificationStatus} = 'rejected')::int`;
  const blocked = sql<number>`count(distinct ${workProofLogs.id}) filter (where ${workProofLogs.verificationStatus} = 'fraud_blocked')::int`;

  const rows = await db
    .select({
      workerId: workProofLogs.workerId,
      verifiedProofs: verified.as('verified_proofs'),
      rejectedProofs: rejected.as('rejected_proofs'),
      fraudBlockedProofs: blocked.as('fraud_blocked_proofs'),
      // Scored over the confirmations behind these proofs. Averaging over proof
      // rows instead would fold unscored and pending proofs in as if they scored
      // zero, dragging every new worker toward distrust.
      trustScore: sql<string | null>`avg(${verifications.fraudScore})`.as('trust_score'),
      lastVerifiedAt: sql<string | null>`max(${verifications.completedAt})`.as('last_verified_at'),
    })
    .from(workProofLogs)
    .innerJoin(
      capabilityBlocks,
      and(
        eq(capabilityBlocks.id, workProofLogs.capabilityBlockId),
        sql`lower(${capabilityBlocks.skillTag}) = lower(${skillTag})`,
      ),
    )
    .leftJoin(
      verifications,
      and(eq(verifications.workProofId, workProofLogs.id), eq(verifications.response, 'confirmed')),
    )
    .groupBy(workProofLogs.workerId)
    .having(sql`count(distinct ${workProofLogs.id}) filter (where ${workProofLogs.verificationStatus} = 'verified') >= ${minVerifiedProofs}`)
    .orderBy(sql`verified_proofs desc, trust_score desc nulls last`);

  return rows.map((row) => ({
    workerId: row.workerId,
    verifiedProofs: Number(row.verifiedProofs),
    rejectedProofs: Number(row.rejectedProofs),
    fraudBlockedProofs: Number(row.fraudBlockedProofs),
    trustScore: row.trustScore === null ? null : Number(row.trustScore),
    lastVerifiedAt: toDate(row.lastVerifiedAt),
  }));
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