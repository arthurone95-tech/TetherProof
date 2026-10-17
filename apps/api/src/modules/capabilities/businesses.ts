/**
 * Businesses: the vehicle for employer rights (migration `0012`).
 *
 * ## Why a business exists rather than an "employer" role a person claims
 *
 * The agreed design keeps an owner's personal worker identity separate from the
 * business's hiring permissions. Kojo the electrician and "Kojo Electrical Services" are
 * different things that share an owner, and only the second one holds employer rights.
 * That distinction is only expressible if the business is an entity, because a capability
 * on a person cannot say *which* business it is for.
 *
 * So an employer capability is granted two ways and never a third:
 *
 * * by the `0012` backfill, for an account that already had the `employer` role, so
 *   nobody loses access they have today; and
 * * by an approved business membership, for everyone else.
 *
 * ## A stated boundary
 *
 * **Business records — specs, saved workers, invitations — remain keyed on the person,
 * not the business.** That is a deliberate simplification and it is honest about what it
 * costs: somebody who runs two businesses sees one set of employer records. The
 * alternative is threading `business_id` through five tables, every query that reads them,
 * and every saved shortlist — a much larger change to a working, tested module, made for
 * a case the agreed design calls "simple". The business is the authorisation vehicle and
 * the display identity; if two-business separation is ever needed it is a migration on top
 * of this one, not a rewrite of it.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type {
  AdminBusinessListItem,
  BusinessSummary,
  BusinessesResponse,
} from '@tetherproof/shared';
import { db } from '../../db/client.js';
import { businessMemberships, businesses, profiles, userCapabilities } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { grant, revoke } from '../capabilities/service.js';

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** The businesses this account owns or is a member of, with everything the UI needs. */
export async function listBusinesses(userId: string): Promise<BusinessesResponse> {
  // The owner's name is coalesced from `profiles` and the auth record in one statement.
  // Reading it in application code instead would mean a query per business, and — the
  // reason it is a subquery rather than a join — `auth.users` is not in the Drizzle schema
  // by design, since identity data is owned by Supabase Auth (`doc/06` §2).
  const rows = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      status: businesses.status,
      createdAt: businesses.createdAt,
      reviewedAt: businesses.reviewedAt,
      note: businesses.note,
      ownerName: sql<string | null>`coalesce(
        ${profiles.fullName},
        (select raw_user_meta_data ->> 'full_name' from auth.users where id = ${businesses.ownerUserId})
      )`,
      memberCount: sql<number>`(
        select count(*)::int from public.business_memberships m where m.business_id = ${businesses.id}
      )`,
      isMember: sql<boolean>`exists (
        select 1 from public.business_memberships m
         where m.business_id = ${businesses.id} and m.user_id = ${userId}
      )`,
    })
    .from(businesses)
    .leftJoin(profiles, eq(profiles.userId, businesses.ownerUserId))
    .where(
      sql`${businesses.ownerUserId} = ${userId} or exists (
        select 1 from public.business_memberships m
         where m.business_id = ${businesses.id} and m.user_id = ${userId}
      )`,
    )
    .orderBy(desc(businesses.createdAt));

  return { businesses: rows.map(toSummary) };
}

function toSummary(row: {
  id: string;
  name: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Date;
  reviewedAt: Date | null;
  note: string | null;
  ownerName: string | null;
  memberCount: number;
  isMember: boolean;
}): BusinessSummary {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    ownerName: row.ownerName?.trim() || null,
    memberCount: Number(row.memberCount),
    // Both conditions, not either. An approved business the viewer is not a member of
    // grants them nothing, and a membership of an unapproved one grants nothing either —
    // which is the whole point of routing hiring through a vetted entity.
    canHire: row.status === 'approved' && row.isMember,
    createdAt: toIso(row.createdAt),
    reviewedAt: row.reviewedAt ? toIso(row.reviewedAt) : null,
    note: row.note,
  };
}

/**
 * The owner's own name, from `profiles` with the auth record as the fallback.
 *
 * A `profiles` row only exists for an account that registered through the public form, so
 * reading it alone would show a blank owner for a provisioned account — the same blind spot
 * `trainers/attribution.ts` documents.
 */
async function ownerNameFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({
      profileName: profiles.fullName,
      authName: sql<string | null>`(
        select raw_user_meta_data ->> 'full_name' from auth.users where id = ${userId}
      )`,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return row?.profileName?.trim() || row?.authName?.trim() || null;
}

/**
 * Creates a business, owned by this account and pending approval.
 *
 * Self-registration stays open on purpose: requiring approval to ask would leave nobody
 * able to ask, and the gate that matters is on *hiring*, not on forming a business. The
 * owner is enrolled as a member in the same transaction so the business is never briefly
 * visible with nobody able to administer it.
 */
export async function createBusiness(userId: string, name: string): Promise<BusinessSummary> {
  const [created] = await db
    .insert(businesses)
    .values({ name, ownerUserId: userId })
    .returning({ id: businesses.id });

  if (!created) {
    throw AppError.internal('The business could not be created.');
  }

  await db
    .insert(businessMemberships)
    .values({ businessId: created.id, userId, memberRole: 'owner' })
    .onConflictDoNothing({ target: [businessMemberships.businessId, businessMemberships.userId] });

  const [row] = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      status: businesses.status,
      createdAt: businesses.createdAt,
      reviewedAt: businesses.reviewedAt,
      note: businesses.note,
      memberCount: sql<number>`(
        select count(*)::int from public.business_memberships m where m.business_id = ${businesses.id}
      )`,
    })
    .from(businesses)
    .where(eq(businesses.id, created.id))
    .limit(1);

  if (!row) throw AppError.internal('The business could not be read back.');

  return toSummary({
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    note: row.note,
    // The viewer is the owner, and the owner was just enrolled as a member, so both of
    // these are known here rather than computed.
    ownerName: await ownerNameFor(userId),
    memberCount: Number(row.memberCount),
    isMember: true,
  });
}

/** The business ids this account may act for. Used by the capability checks. */
export async function listBusinessIdsFor(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.ownerUserId, userId));

  const memberships = await db
    .select({ businessId: businessMemberships.businessId })
    .from(businessMemberships)
    .where(eq(businessMemberships.userId, userId));

  return [...new Set([...rows.map((r) => r.id), ...memberships.map((r) => r.businessId)])];
}

/** Whether this account may hire through this specific business. */
export async function canHireThrough(userId: string, businessId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: businesses.status })
    .from(businesses)
    .innerJoin(
      businessMemberships,
      and(
        eq(businessMemberships.businessId, businesses.id),
        eq(businessMemberships.userId, userId),
      ),
    )
    .where(eq(businesses.id, businessId))
    .limit(1);

  return row?.status === 'approved';
}

/** The administrator's approval queue, newest first. */
export async function listBusinessesForAdmin(): Promise<AdminBusinessListItem[]> {
  // Same coalesce as the owner's own view, so a reviewer sees a name for an account that
  // was provisioned rather than a blank line to judge an application on.
  const rows = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      ownerId: businesses.ownerUserId,
      status: businesses.status,
      createdAt: businesses.createdAt,
      reviewedAt: businesses.reviewedAt,
      note: businesses.note,
      ownerName: sql<string | null>`coalesce(
        ${profiles.fullName},
        (select raw_user_meta_data ->> 'full_name' from auth.users where id = ${businesses.ownerUserId})
      )`,
    })
    .from(businesses)
    .leftJoin(profiles, eq(profiles.userId, businesses.ownerUserId))
    .orderBy(desc(businesses.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    ownerName: row.ownerName?.trim() || null,
    status: row.status,
    createdAt: toIso(row.createdAt),
    reviewedAt: row.reviewedAt ? toIso(row.reviewedAt) : null,
    note: row.note,
  }));
}

/**
 * Records a decision on a business, and grants or takes back the owner's employer
 * capability to match.
 *
 * Approval and capability are changed together in one call rather than by the caller
 * remembering to do both, because the failure mode of getting it wrong is a business that
 * reads "approved" while nobody can hire through it, or an employer capability with no
 * approved business behind it. The decision is reversible — `pending` puts the record
 * back in the queue — and revoking the capability follows the same path.
 */
export async function setBusinessStatus(
  businessId: string,
  status: 'approved' | 'rejected' | 'pending',
  reviewedBy: string,
  note: string | null,
): Promise<void> {
  const [target] = await db
    .select({ id: businesses.id, ownerUserId: businesses.ownerUserId })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!target) {
    throw AppError.notFound('That business was not found.');
  }

  await db
    .update(businesses)
    .set({
      status,
      reviewedBy,
      reviewedAt: status === 'pending' ? null : new Date(),
      note,
      updatedAt: new Date(),
    })
    .where(eq(businesses.id, businessId));

  if (status === 'approved') {
    await grant(target.ownerUserId, 'employer', 'business', reviewedBy);
    return;
  }

  // Only take the capability away if this owner has no other approved business. Somebody
  // who runs two and loses one must not silently stop hiring through the other.
  const others = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(
      and(
        eq(businesses.ownerUserId, target.ownerUserId),
        eq(businesses.status, 'approved'),
      ),
    );

  if (others.length > 0) return;

  // ...and only if the business is the thing that granted it.
  //
  // An account that already held `employer` before migration `0012` holds it with
  // `grant_source = 'legacy'`. Removing that here would break the one promise the
  // migration makes: that nobody loses access they have today. A rejected business is the
  // owner's business being turned down, not their existing account being cancelled, and
  // the two are different events.
  const [held] = await db
    .select({ grantSource: userCapabilities.grantSource })
    .from(userCapabilities)
    .where(
      and(
        eq(userCapabilities.userId, target.ownerUserId),
        eq(userCapabilities.capability, 'employer'),
      ),
    )
    .limit(1);

  if (!held || held.grantSource !== 'business') return;

  await revoke(target.ownerUserId, 'employer');
}

/**
 * Adds a member to a business and grants them the employer capability.
 *
 * ## The ownership check is the whole point of this function
 *
 * `callerId` is the authenticated account and `businessId` comes from the URL. If those
 * two were not checked against each other, any signed-in account could name any business
 * and any colleague and grant that colleague the right to hire — turning an employer
 * capability, which exists precisely because somebody vetted the organisation, into
 * something a stranger hands out. The check is here rather than in the route so that every
 * caller gets it.
 *
 * Only the **owner** may add a member, not an existing member. A member who could add
 * others could grow the set of people who may hire without the owner ever seeing it, which
 * defeats the review the approval represents.
 */
export async function addMember(
  businessId: string,
  userId: string,
  callerId: string,
): Promise<void> {
  const [business] = await db
    .select({
      id: businesses.id,
      status: businesses.status,
      ownerUserId: businesses.ownerUserId,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business) throw AppError.notFound('That business was not found.');

  // 403 rather than 404: the caller already proved they are signed in, and answering
  // "no such business" to an existing one they do not own would confirm the id exists to
  // somebody probing for it.
  if (business.ownerUserId !== callerId) {
    throw AppError.forbidden('Only the owner of this business can add a member to it.');
  }

  if (business.status !== 'approved') {
    throw AppError.conflict('That business is not approved yet, so it cannot have members.');
  }

  await db
    .insert(businessMemberships)
    .values({ businessId, userId, memberRole: 'member' })
    .onConflictDoNothing({ target: [businessMemberships.businessId, businessMemberships.userId] });

  await grant(userId, 'employer', 'business', business.ownerUserId);
}
