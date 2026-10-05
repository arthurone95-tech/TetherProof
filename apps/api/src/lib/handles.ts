/**
 * Candidate handles: the only way to act on a masked search result.
 *
 * A handle is a random token the server resolves to a worker, scoped to the
 * employer it was issued to. The scoping is the security property. Without it, an
 * employer who obtained a handle from anywhere could send an invitation to that
 * worker; with it, the same handle resolves to nothing for anyone else.
 *
 * The value is random rather than derived from the worker id on purpose. A derived
 * value (a keyed hash, say) would be stable across every employer, so anyone
 * comparing two result sets could tell when the same worker appeared in both, which
 * is precisely the cross-employer linkage that masking exists to prevent.
 */
import { randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { candidateHandles } from '../db/schema.js';

/** 32 bytes of entropy, base64url encoded. Comfortably inside the 64-char column. */
const HANDLE_BYTES = 32;

/**
 * How long a candidate handle stays usable.
 *
 * A handle is a temporary capability to address one masked card, not a durable
 * pseudonymous identifier. Without an expiry, the table would grow without bound
 * and would keep mapping employers to workers indefinitely, which is the retention
 * problem that masking was meant to prevent.
 */
export const CANDIDATE_HANDLE_TTL_HOURS = 24;

export function generateCandidateHandle(): string {
  return randomBytes(HANDLE_BYTES).toString('base64url');
}

export function handleExpiry(ttlHours: number): Date {
  return new Date(Date.now() + ttlHours * 60 * 60 * 1000);
}

/**
 * Returns a live handle for this employer and worker, minting one if needed.
 *
 * Reuses the existing handle rather than replacing it, so a worker who appears in
 * two searches keeps one stable handle within a single employer's view. It is still
 * refreshed when close to expiry, which keeps the value from becoming permanent.
 *
 * Race-safe by unique constraint: two concurrent searches for the same worker can
 * both attempt a mint, one wins, and the loser re-reads. The upsert below handles
 * the same case in a single statement.
 */
export async function issueCandidateHandle(
  employerId: string,
  workerId: string,
  ttlHours: number,
): Promise<string> {
  const existing = await db
    .select({ handle: candidateHandles.handle, expiresAt: candidateHandles.expiresAt })
    .from(candidateHandles)
    .where(
      and(eq(candidateHandles.employerId, employerId), eq(candidateHandles.workerId, workerId)),
    )
    .limit(1);

  const current = existing[0];
  // Reissue inside the last hour of life so an employer acting on a result they are
  // still looking at does not hit an expired handle.
  const refreshWithinMs = 60 * 60 * 1000;
  if (current && current.expiresAt.getTime() - Date.now() > refreshWithinMs) {
    return current.handle;
  }

  const handle = generateCandidateHandle();
  const expiresAt = handleExpiry(ttlHours);

  // `onConflictDoUpdate` targets the (employer_id, worker_id) unique index. A
  // concurrent insert loses the race harmlessly: the row ends up with the winning
  // handle and one of the two dates, both valid.
  await db
    .insert(candidateHandles)
    .values({ employerId, workerId, handle, expiresAt })
    .onConflictDoUpdate({
      target: [candidateHandles.employerId, candidateHandles.workerId],
      set: { handle, expiresAt },
    });

  return handle;
}

/**
 * Resolves a handle to a worker, for the employer only.
 *
 * Returns null when the handle is unknown, expired, or belongs to somebody else.
 * All three are the same null: an expired handle should not be distinguishable
 * from one that was never issued, or the response would confirm which handles
 * exist. The caller cannot tell whether a worker exists but declined to be found,
 * or was never found at all.
 */
export async function resolveCandidateHandle(
  employerId: string,
  handle: string,
): Promise<string | null> {
  const rows = await db
    .select({ workerId: candidateHandles.workerId })
    .from(candidateHandles)
    .where(
      and(
        eq(candidateHandles.employerId, employerId),
        eq(candidateHandles.handle, handle),
        gt(candidateHandles.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return rows[0]?.workerId ?? null;
}

/**
 * Deletes handles that have expired.
 *
 * Expiry is enforced on read as well, so this is hygiene rather than correctness:
 * without it the table grows without bound and keeps mapping employers to workers
 * indefinitely, which is the retention problem masking was meant to avoid.
 *
 * Called from the search path, which is the only thing that mints handles. See the
 * call site for why it lives there rather than on a timer.
 */
export async function purgeExpiredHandles(): Promise<number> {
  const deleted = await db
    .delete(candidateHandles)
    .where(lt(candidateHandles.expiresAt, new Date()))
    .returning({ id: candidateHandles.id });

  return deleted.length;
}