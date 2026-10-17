/**
 * Capabilities: what one account is authorised to do (migration `0012`).
 *
 * This is the module that answers "may this person do that", and the one place the
 * answer is formed. Every route still checks at its mount; this is what it checks
 * against.
 *
 * ## The three properties that matter
 *
 * **A capability is a set, not a scalar.** Kojo holds worker, trainee and employer at
 * once, and each of those is granted and revoked independently. Nothing here reads a
 * single role, because there is no longer a single role to read.
 *
 * **Not everything is self-service, and the difference is a security boundary rather
 * than a product preference.** `worker` and `training_provider` may be activated by the
 * person, which is what self-registration always did. `trainee` requires a real
 * institutional enrolment, and `employer` requires an approved business and a
 * membership. Both of those are grants somebody else makes, which is the entire point
 * of an approval.
 *
 * **Administrator is not a capability and is never granted here.** It is read from the
 * server-controlled `app_metadata.role` claim, which is where it has always lived, and
 * which no signup can reach. E-024 is the record of what happens when that boundary is
 * crossed: a self-declared `admin` could approve employers and send unsolicited
 * invitations. `grant` below has no branch that can produce it, so the mistake cannot be
 * made by adding a capability to an enum.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { CapabilitiesResponse, CapabilityStatus, UserCapability } from '@tetherproof/shared';
import { USER_CAPABILITIES } from '@tetherproof/shared';
import { db } from '../../db/client.js';
import { userCapabilities } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';

/**
 * The capabilities a person may grant themselves.
 *
 * `training_provider` is here because that is what self-registration always did, and
 * keeping it preserves current behaviour rather than quietly tightening it. What changed
 * is that it is no longer chosen *at* signup: an account is created with nothing, and
 * activating an institute is a deliberate act on the dashboard afterwards.
 *
 * `admin` cannot appear here, whatever a future edit tries.
 */
const SELF_SERVICE: ReadonlySet<UserCapability> = new Set<UserCapability>([
  'worker',
  'training_provider',
]);

/** One line per capability for the dashboard, saying what to do about it. */
const HOW_TO: Record<UserCapability, string> = {
  worker: 'Activate a personal work profile to log completed jobs and build verified proof.',
  employer:
    'Set up a business and wait for approval. Hiring runs through a business, so this is never something you simply switch on.',
  training_provider: 'Register your institute to manage trainees and sign off practical credentials.',
  trainee: 'Join a training institute with the enrolment code they gave you.',
};

/**
 * Every capability this person holds.
 *
 * The one read every authenticated request depends on, so it is worth being explicit
 * about what it does *not* do: it does not consider the administrator claim. That is
 * read separately and deliberately, because an administrator is not a capability and
 * folding it in here would make it grantable.
 *
 * Ordered, deliberately. Without `ORDER BY` the result is in whatever order the planner
 * returns, which for a composite-key table is index order today and undefined order after
 * a plan change. Anything that treats this list as a sequence — the workspace selector's
 * label, a "which one first" default — would then change behaviour without a code change.
 */
export async function listCapabilities(userId: string): Promise<UserCapability[]> {
  const rows = await db
    .select({ capability: userCapabilities.capability })
    .from(userCapabilities)
    .where(eq(userCapabilities.userId, userId))
    .orderBy(userCapabilities.capability);

  return rows.map((row) => row.capability);
}

/** Whether this account holds a capability. The hot path, called by every guard. */
export async function hasCapability(userId: string, capability: UserCapability): Promise<boolean> {
  const [row] = await db
    .select({ capability: userCapabilities.capability })
    .from(userCapabilities)
    .where(and(eq(userCapabilities.userId, userId), eq(userCapabilities.capability, capability)))
    .limit(1);
  return Boolean(row);
}

/**
 * Whether this account holds any of the capabilities asked for.
 *
 * Takes a set so a route that accepts two of them costs one query. A route requiring both
 * at once should check them separately: holding either is a different claim from holding
 * both, and collapsing them would quietly widen it.
 */
export async function hasAnyCapability(
  userId: string,
  required: readonly UserCapability[],
): Promise<boolean> {
  if (required.length === 0) return true;

  const rows = await db
    .select({ capability: userCapabilities.capability })
    .from(userCapabilities)
    .where(
      and(
        eq(userCapabilities.userId, userId),
        inArray(userCapabilities.capability, [...required] as UserCapability[]),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * Grants a capability. **Not** the entry point for self-service — see
 * `activateSelfService`, which gates which capabilities a person may claim themselves.
 *
 * Unguarded on purpose: enrolment and business approval grant capabilities the person
 * could not grant themselves, and that is the difference between an approval and a
 * self-declaration.
 *
 * Idempotent: the composite primary key makes a repeat a no-op rather than an error.
 * `onConflictDoNothing` rather than an update, because re-granting must not rewrite the
 * original `granted_at` — a capability someone has held for a year should not appear to
 * have been granted a moment ago.
 *
 * `grantedBy` is null for a self-service grant and for the `0012` backfill, which is the
 * honest answer: nobody else was involved.
 */
export async function grant(
  userId: string,
  capability: UserCapability,
  source: 'self' | 'legacy' | 'enrolment' | 'business' | 'admin' | 'registration',
  grantedBy: string | null = null,
): Promise<void> {
  await db
    .insert(userCapabilities)
    .values({ userId, capability, grantSource: source, grantedBy })
    .onConflictDoNothing({ target: [userCapabilities.userId, userCapabilities.capability] });
}

/**
 * Grants a capability the person is allowed to grant themselves.
 *
 * This is the **only** entry point for self-service, and the `SELF_SERVICE` check lives
 * here rather than in the route handler on purpose. `grant` is deliberately unguarded so
 * that enrolment and business approval can grant what the person could not grant
 * themselves; a gate written only in the route would be one forgotten import away from
 * being bypassed by the next route that calls `grant` directly, and the thing being
 * protected — who may hire, and who may hold a student record — is worth more than the
 * convenience of a single function.
 *
 * `employer` and `trainee` are refused. Each is somebody else's decision: an approved
 * business and an institutional enrolment respectively. Allowing either to be
 * self-declared would make the approval flows decorative — the gate would be a form
 * somebody fills in rather than a check somebody passes.
 *
 * Idempotent, so a double tap on an activation button cannot fail.
 */
export async function activateSelfService(
  userId: string,
  capability: UserCapability,
): Promise<void> {
  if (!SELF_SERVICE.has(capability)) {
    throw AppError.forbidden();
  }
  await grant(userId, capability, 'self');
}

/**
 * Revokes a capability, refusing to revoke the last route a person has to their own data.
 *
 * A person with no capability at all would land on a dashboard offering them nothing,
 * having no way to get their own work records back — the records stay, the account just
 * cannot reach them. `worker` is therefore the one capability that cannot be taken away,
 * and a person who no longer wants it simply stops using it. Nothing else is
 * irreversible, so the other two are revokable.
 */
export async function revoke(userId: string, capability: UserCapability): Promise<void> {
  if (capability === 'worker') {
    throw AppError.badRequest(
      'Your work profile cannot be removed, because it is what gives you access to your own records.',
    );
  }

  const removed = await db
    .delete(userCapabilities)
    .where(and(eq(userCapabilities.userId, userId), eq(userCapabilities.capability, capability)))
    .returning({ capability: userCapabilities.capability });

  if (removed.length === 0) {
    throw AppError.notFound('That capability is not active on your account.');
  }
}

/**
 * The dashboard's view: every capability, held or not.
 *
 * Always returns all four, so the page renders the same set of rows whatever the account
 * has. A list that only showed what you already had would be the wrong shape entirely —
 * the point of the page is to show what you could add and how.
 */
export async function describeCapabilities(userId: string): Promise<CapabilitiesResponse> {
  const rows = await db
    .select({
      capability: userCapabilities.capability,
      grantSource: userCapabilities.grantSource,
      grantedAt: userCapabilities.grantedAt,
    })
    .from(userCapabilities)
    .where(eq(userCapabilities.userId, userId));

  const held = new Map(rows.map((row) => [row.capability, row]));

  const capabilities: CapabilityStatus[] = USER_CAPABILITIES.map((capability) => {
    const row = held.get(capability);
    return {
      capability,
      held: Boolean(row),
      grantSource: row?.grantSource ?? null,
      grantedAt: row?.grantedAt ? row.grantedAt.toISOString() : null,
      selfService: SELF_SERVICE.has(capability),
      howToActivate: HOW_TO[capability],
    };
  });

  // The workspace the account opens on: the capability granted most recently. That is the
  // one the person most likely chose to be working in, and for a single-capability account
  // it is simply that capability.
  //
  // Null only when the account holds none — which is exactly when there is nowhere to
  // send them, and the web sends them to the capability page instead. Returning a
  // fabricated default here would be worse than null: the switcher would offer a
  // workspace the person cannot open.
  const newest = [...held.values()].sort(
    (a, b) => b.grantedAt.getTime() - a.grantedAt.getTime(),
  )[0];

  return { capabilities, activeWorkspace: newest?.capability ?? null };
}

/**
 * Whether this account administers the platform.
 *
 * Read from `app_metadata.role` in `auth.users` and from nowhere else. That column is
 * server-controlled: it is written by an administrator against the auth record and is not
 * reachable by anything a signup can do. It is deliberately **not** a capability, so
 * there is no row to insert, no request body that can name it, and no path by adding
 * something to the enum.
 *
 * `doc/13` E-024 is the record of what happens when this boundary is crossed: a
 * self-declared `admin` could approve employers and send unsolicited invitations to
 * workers, and the whole approval gate was bypassable by one unauthenticated request.
 */
export async function isAdministrator(userId: string): Promise<boolean> {
  // `auth.users` is not in the Drizzle schema — identity data is owned by Supabase Auth
  // (`doc/06` §2) — so this is raw SQL rather than a typed query. The cast is to the
  // row array the pg driver actually returns; Drizzle types `execute` as the wrapper
  // object, which is the same data.
  const rows = (await db.execute(sql`
    select (raw_app_meta_data ->> 'role') = 'admin' as is_admin
      from auth.users where id = ${userId}
  `)) as unknown as Array<{ is_admin: boolean }>;
  return rows[0]?.is_admin === true;
}

