/**
 * An employer's saved workers.
 *
 * Search is stateless by design — it re-issues handles that expire, and it holds
 * no list — so an employer who meant to come back to someone had nowhere to put
 * them. This module is that somewhere.
 *
 * The privacy shape of search is deliberately preserved. A worker reaches this
 * module as a candidate handle and leaves it as one: the handle is resolved to a
 * worker id on save and a fresh handle is issued on read, so the client never
 * handles the id the row stores. Saving a candidate still passes through
 * `discoverable`, and a worker who has opted out cannot be saved — not refused
 * loudly, because that would confirm they exist, but simply never resolved.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { SavedWorker } from '@tetherproof/shared';
import { db } from '../../db/client.js';
import { employerSavedWorkers } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import {
  CANDIDATE_HANDLE_TTL_HOURS,
  issueCandidateHandle,
  resolveCandidateHandle,
} from '../../lib/handles.js';
import { aggregateCandidateMetrics } from '../../lib/matching.js';

/**
 * Saves one worker for one employer.
 *
 * Takes the handle rather than a worker id, which is the only thing the client
 * has been given. The skill travels alongside so the saved entry remembers what
 * the employer was looking at — the same worker can be saved under two skills,
 * because "a plumber I need this month" and "the electrician from last year" are
 * genuinely different intentions.
 *
 * Idempotent. Saving the same pair twice is a double tap rather than a second
 * intention, so it must land on the one existing row and keep the moment the
 * employer first decided. Implemented as insert-or-ignore followed by a read
 * rather than an upsert: an upsert needs a `set` clause, and an empty one asks
 * the driver to update nothing, which drizzle rejects outright.
 */
export async function saveWorker(
  employerId: string,
  input: { candidateHandle: string; skillTag: string },
): Promise<{ savedId: string }> {
  const workerId = await resolveCandidateHandle(employerId, input.candidateHandle);
  if (!workerId) {
    // The same null the handle resolver returns for an expired handle and for one
    // belonging to somebody else. Distinguishing them would let an employer probe
    // which handles exist.
    throw AppError.notFound(
      'That candidate could not be saved. Run the search again and try once more.',
    );
  }

  const inserted = await db
    .insert(employerSavedWorkers)
    .values({ employerId, workerId, skillTag: input.skillTag })
    .onConflictDoNothing({
      target: [
        employerSavedWorkers.employerId,
        employerSavedWorkers.workerId,
        employerSavedWorkers.skillTag,
      ],
    })
    .returning({ id: employerSavedWorkers.id });

  if (inserted[0]) return { savedId: inserted[0].id };

  // The row already existed. Re-read it rather than reporting success blind, so
  // the id handed back is one that is genuinely stored.
  const [existing] = await db
    .select({ id: employerSavedWorkers.id })
    .from(employerSavedWorkers)
    .where(
      and(
        eq(employerSavedWorkers.employerId, employerId),
        eq(employerSavedWorkers.workerId, workerId),
        eq(employerSavedWorkers.skillTag, input.skillTag),
      ),
    )
    .limit(1);

  if (!existing) {
    // Only reachable if the row vanished between the two statements, which needs a
    // concurrent delete. Reporting a save that did not happen would be worse.
    throw AppError.internal('That worker could not be saved.');
  }

  return { savedId: existing.id };
}

/**
 * Removes one saved worker.
 *
 * Scoped to `employerId` in the predicate, so a saved id belonging to another
 * employer matches nothing and is reported the same way as one that never
 * existed. The caller cannot use this endpoint to discover whether an id is real.
 */
export async function unsaveWorker(employerId: string, savedId: string): Promise<void> {
  await db
    .delete(employerSavedWorkers)
    .where(
      and(eq(employerSavedWorkers.id, savedId), eq(employerSavedWorkers.employerId, employerId)),
    );
}

/**
 * The employer's saved workers, newest first.
 *
 * The numbers on each card come from the same aggregation search uses, not from a
 * second implementation written for this list. That matters for two reasons: it
 * cannot drift from what a search would report for the same worker, and it brings
 * the `discoverable` gate with it. A worker who opted out after being saved drops
 * out here rather than lingering in a list their choice should have removed them
 * from — so the saved list is not a back door to someone who has withdrawn.
 *
 * A worker who has deleted their account is gone by cascade and never reaches
 * this query. No row and no count is fabricated for them.
 */
export async function listSavedWorkers(employerId: string): Promise<SavedWorker[]> {
  const rows = await db
    .select({
      savedId: employerSavedWorkers.id,
      savedAt: employerSavedWorkers.createdAt,
      workerId: employerSavedWorkers.workerId,
      skillTag: employerSavedWorkers.skillTag,
    })
    .from(employerSavedWorkers)
    .where(eq(employerSavedWorkers.employerId, employerId))
    .orderBy(desc(employerSavedWorkers.createdAt));

  if (rows.length === 0) return [];

  // One aggregation per distinct skill rather than per saved row, because the
  // result set is keyed by worker and a worker saved under several skills needs
  // only one pass per skill to be looked up.
  const bySkill = new Map<string, Map<string, Awaited<ReturnType<typeof aggregateCandidateMetrics>>[number]>>();
  for (const skillTag of new Set(rows.map((row) => row.skillTag))) {
    const metrics = await aggregateCandidateMetrics(skillTag, 1);
    bySkill.set(skillTag, new Map(metrics.map((metric) => [metric.workerId, metric])));
  }

  const workers: SavedWorker[] = [];
  for (const row of rows) {
    const metric = bySkill.get(row.skillTag)?.get(row.workerId);
    // Absent means the worker is no longer discoverable, or no longer has
    // verified proof for this skill. Either way they are not listed, and the row
    // is left in place so re-saving later is still a single tap rather than a
    // re-entry of the handle that has since expired.
    if (!metric) continue;

    const handle = await issueCandidateHandle(employerId, row.workerId, CANDIDATE_HANDLE_TTL_HOURS);
    workers.push({
      savedId: row.savedId,
      savedAt: row.savedAt.toISOString(),
      candidateHandle: handle,
      skillTag: row.skillTag,
      displayName: metric.displayName,
      avatarUrl: metric.avatarUrl,
      verifiedProofs: metric.verifiedProofs,
      trustScore: metric.trustScore,
      lastVerifiedAt: metric.lastVerifiedAt ? metric.lastVerifiedAt.toISOString() : null,
      distanceKm: null,
    });
  }

  return workers;
}

/**
 * Saved rows for one employer and skill, keyed by worker id.
 *
 * Used to mark search cards already saved, so the star on a result reflects what
 * is stored rather than what the employer last tapped in this browser. Keyed by
 * worker id rather than by name or photo: two workers can share either, and
 * matching on those would fill in the wrong star and unsave the wrong person.
 */
export async function savedWorkersForSkill(
  employerId: string,
  skillTag: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ workerId: employerSavedWorkers.workerId, savedId: employerSavedWorkers.id })
    .from(employerSavedWorkers)
    .where(
      and(
        eq(employerSavedWorkers.employerId, employerId),
        eq(employerSavedWorkers.skillTag, skillTag),
      ),
    );

  return new Map(rows.map((row) => [row.workerId, row.savedId]));
}
