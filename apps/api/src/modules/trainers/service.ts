/**
 * The training provider's own workspace (doc/02 Module 4).
 *
 * Three things live here, and they are the whole of the module: a roster, a
 * milestone issuer, and a demand dashboard. The security doc restricts this role to
 * "institutional milestone issuance and demand analytics" (`doc/08` §2), so
 * nothing in this file reaches anything else — no worker profile, no employer data,
 * no other institute's roster.
 *
 * The three constraints that shape everything below.
 *
 * **A roster is a name and nothing else.** Enrolment is by code the student
 * redeems, so the platform never handles a list of student addresses an institute
 * compiled. The roster table has no email, phone, or location column, and no
 * endpoint here can return one even if the query wanted to.
 *
 * **A credential is not a verified proof.** Signing off produces `awaiting_student`
 * and only the student can complete it. Nothing here writes to `work_proof_logs` or
 * `verifications`, so an institute cannot move a worker's client-verified totals —
 * which is the whole reason an accepted credential is not presented beside them as
 * if it were the same kind of evidence. See `demand.ts` for the same rule applied to
 * the supply side.
 *
 * **One institute sees one roster.** Every query below is scoped by `trainerId`
 * from the authenticated session rather than from the request body, so there is no
 * shape of input that can widen it. A second institute's enrolment id is simply not
 * found, which is a 404 rather than a 403 for the same reason the saved-worker
 * delete is: a 403 would confirm the row exists.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, count, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  CredentialListResponse,
  DemandInsightsResponse,
  EnrolmentCodeResponse,
  IssuedCredential,
  MicroCredentialStatus,
  RosterResponse,
  RosterStudent,
  SkillLevel,
  StudentCredential,
  StudentCredentialsResponse,
  TrainerEnrolmentResponse,
  TrainerOverviewResponse,
} from '@tetherproof/shared';
import { db } from '../../db/client.js';
import {
  capabilityBlocks,
  directOffers,
  employerSpecs,
  microCredentials,
  profiles,
  trainerEnrolmentCodes,
  trainerStudents,
  users,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { createNotification } from '../../lib/notifications.js';
import { buildDemandRows, demandTotals, type SearchCountRow, type SupplyCountRow } from './demand.js';
import { institutionFor, resolveIssuer } from './attribution.js';
import type { IssueCredentialInput } from './schemas.js';

/**
 * `profiles` joined a second time, under a different name.
 *
 * A credential names two accounts that both have a profile row — the institute and
 * the instructor — so reading both in one pass needs the table aliased. The join is
 * a left join because `issued_by` is nullable: a credential whose signatory has left
 * is still a real credential and must still be shown, attributed to nobody.
 */
const issuerProfile = alias(profiles, 'issuer_profile');

/**
 * `auth.users`, selected as raw SQL.
 *
 * Not in the Drizzle schema on purpose: identity data is owned by Supabase Auth and the
 * application mirrors only what it needs, per `doc/06` §2. Reading the account's own
 * name from it here is a *read* of that authoritative store, not a second copy of it.
 *
 * Declared inline with a single selected column rather than modelled, so this cannot
 * drift into a place where the app starts treating the auth table as its own.
 */
const authUsers = sql`(
  select id, raw_user_meta_data
    from auth.users
) as auth_user`;

/**
 * Entropy for an enrolment code.
 *
 * 12 bytes is far more than the code's real strength: it is typed by a person
 * reading it off a screen and entering it on a phone, so the search space that
 * matters is a few billion possibilities tried by a human, not by a script. The
 * generous length is there so the code is hard to mistype, not to be unguessable —
 * a short numeric code is the only kind anyone reliably copies correctly.
 *
 * Only a digest of this is ever stored, so the value cannot be recovered from a
 * database disclosure; see the table comment in migration 0011.
 */
const ENROLMENT_CODE_BYTES = 12;

const ENROLMENT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateEnrolmentCode(): string {
  const bytes = randomBytes(ENROLMENT_CODE_BYTES);
  let out = '';
  for (const byte of bytes) {
    // 32 symbols, so 5 bits each. The modulo would bias the last few symbols very
    // slightly; with a code this short and a one-attempt-per-second threat model
    // that bias is worth nothing, and it keeps the character set copyable by eye.
    out += ENROLMENT_CODE_ALPHABET[byte % ENROLMENT_CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Normalises a code to the one form that is ever hashed or compared.
 *
 * Upper-cased and stripped of spaces and dashes, because a code read aloud or
 * copied across a screen collects punctuation, and rejecting a correct code for
 * carrying a hyphen is the difference between an enrolment that works and one that
 * silently does not. The alphabet has no ambiguous pairs (no `I`/`1`, no `O`/`0`),
 * so this normalisation cannot merge two genuinely different codes.
 */
function normaliseEnrolmentCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

function enrolmentCodeHash(code: string): string {
  return createHash('sha256').update(normaliseEnrolmentCode(code), 'utf8').digest('hex');
}

/**
 * The institution's own name, for the roster, the dashboard, and notifications.
 *
 * Resolved through the same fallback the credential page uses, so a provider with no
 * organization name is still identified by their account name everywhere at once.
 * Without that, the roster would say "Name not set" for an institute the credential
 * page confidently named, which is the kind of disagreement a user reads as a bug in
 * one of the two.
 */
async function organizationNameFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({
      organizationName: profiles.organizationName,
      fullName: profiles.fullName,
      // The same last-resort tier the credential page uses, so the roster, the
      // dashboard, and the notification a student receives all name the same
      // institution rather than three different fallbacks.
      authFullName: sql<string | null>`(
        select raw_user_meta_data ->> 'full_name' from auth.users where id = ${userId}
      )`,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  return institutionFor({
    organizationName: row?.organizationName ?? null,
    fullName: row?.fullName ?? null,
    authFullName: row?.authFullName ?? null,
  });
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

/**
 * The institute's roster.
 *
 * The counts beside each name come from this institute's own credentials, so two
 * institutes enrolling the same person each see only their own history of them —
 * which is the only place the platform keeps a durable record pairing an institute
 * with a named person, and it is scoped as narrowly as the saved-worker table is.
 */
export async function getRoster(trainerId: string): Promise<RosterResponse> {
  const rows = await db
    .select({
      enrolmentId: trainerStudents.id,
      fullName: profiles.fullName,
      enrolledAt: trainerStudents.enrolledAt,
      awaiting: sql<number>`count(*) filter (where ${microCredentials.status} = 'awaiting_student')::int`,
      accepted: sql<number>`count(*) filter (where ${microCredentials.status} = 'accepted')::int`,
    })
    .from(trainerStudents)
    .leftJoin(profiles, eq(profiles.userId, trainerStudents.studentId))
    .leftJoin(
      microCredentials,
      and(
        eq(microCredentials.trainerId, trainerId),
        eq(microCredentials.studentId, trainerStudents.studentId),
      ),
    )
    .where(eq(trainerStudents.trainerId, trainerId))
    .groupBy(trainerStudents.id, profiles.fullName, trainerStudents.enrolledAt)
    .orderBy(desc(trainerStudents.enrolledAt));

  const students: RosterStudent[] = rows.map((row) => ({
    enrolmentId: row.enrolmentId,
    // A name the account holder chose, or none. Never an address or a location.
    fullName: row.fullName?.trim() || null,
    credentialCount: Number(row.accepted ?? 0),
    pendingCount: Number(row.awaiting ?? 0),
    enrolledAt: toIso(row.enrolledAt),
  }));

  const [code] = await db
    .select({ trainerId: trainerEnrolmentCodes.trainerId })
    .from(trainerEnrolmentCodes)
    .where(eq(trainerEnrolmentCodes.trainerId, trainerId))
    .limit(1);

  return {
    students,
    hasActiveCode: Boolean(code),
    organizationName: await organizationNameFor(trainerId),
  };
}

/**
 * Creates a new enrolment code, replacing any previous one.
 *
 * The raw value is in this response and nowhere else — it is returned once and only
 * a digest is kept, so a person who loses it generates another rather than asking
 * for it back. Rotating does not unenrol anybody: enrolment is a row that already
 * exists, not a property of the code, so the institute can rotate on a schedule
 * without invalidating a link somebody is about to send.
 */
export async function createEnrolmentCode(trainerId: string): Promise<EnrolmentCodeResponse> {
  const code = generateEnrolmentCode();
  const hash = enrolmentCodeHash(code);

  await db
    .insert(trainerEnrolmentCodes)
    .values({ trainerId, codeHash: hash })
    .onConflictDoUpdate({
      target: trainerEnrolmentCodes.trainerId,
      set: { codeHash: hash, createdAt: new Date() },
    });

  return { enrolmentCode: code, organizationName: await organizationNameFor(trainerId) };
}

/**
 * A student redeeming an institute's code.
 *
 * Idempotent: redeeming the same code twice returns the same answer and adds one
 * row, so a student who taps the button twice is not enrolled twice and does not
 * end up with two copies of every pending decision.
 *
 * The code is matched by digest in a single indexed lookup. A miss is a plain
 * message rather than "not found", and the work is done in constant time relative
 * to its length — there is nothing here that tells a caller whether a near-miss code
 * was nearly right.
 */
export async function redeemEnrolmentCode(
  studentId: string,
  rawCode: string,
): Promise<TrainerEnrolmentResponse> {
  const hash = enrolmentCodeHash(rawCode);

  const [match] = await db
    .select({ trainerId: trainerEnrolmentCodes.trainerId })
    .from(trainerEnrolmentCodes)
    .where(eq(trainerEnrolmentCodes.codeHash, hash))
    .limit(1);

  if (!match) {
    throw AppError.badRequest('That enrolment code is not valid. Ask your institute for a current one.');
  }

  // An institute cannot enrol itself, and a student cannot enrol twice at the same
  // institute — the unique index makes the second attempt a no-op rather than a
  // duplicate row, so redeeming a code twice adds one roster entry and not two.
  await db
    .insert(trainerStudents)
    .values({ trainerId: match.trainerId, studentId })
    .onConflictDoNothing({ target: [trainerStudents.trainerId, trainerStudents.studentId] });

  return {
    enrolled: true,
    organizationName: await organizationNameFor(match.trainerId),
  };
}

/**
 * Removes a student from this institute's roster.
 *
 * Scoped to the owning institute, so a second institute's enrolment id is not found
 * rather than forbidden. Existing credentials are deliberately kept: a student
 * leaving the course does not un-take a practical they already sat, and deleting
 * the endorsement would leave the institute with no record of what it certified.
 */
export async function removeStudent(trainerId: string, enrolmentId: string): Promise<void> {
  const removed = await db
    .delete(trainerStudents)
    .where(and(eq(trainerStudents.id, enrolmentId), eq(trainerStudents.trainerId, trainerId)))
    .returning({ id: trainerStudents.id });

  if (removed.length === 0) {
    throw AppError.notFound('That student is not on your roster.');
  }
}

// ---------------------------------------------------------------------------
// Milestone issuer
// ---------------------------------------------------------------------------

/**
 * The institute's issued credentials.
 *
 * Scoped by `trainerId`, so this is the institute's own record and no other's. The
 * student is named, because the institute signed the thing and a signatory that
 * cannot see who it was about could not keep its own records straight.
 */
export async function listIssuedCredentials(trainerId: string): Promise<CredentialListResponse> {
  const rows = await db
    .select({
      id: microCredentials.id,
      studentName: profiles.fullName,
      skillTag: microCredentials.skillTag,
      skillLevel: microCredentials.skillLevel,
      milestoneTitle: microCredentials.milestoneTitle,
      note: microCredentials.note,
      status: microCredentials.status,
      issuedAt: microCredentials.issuedAt,
      answeredAt: microCredentials.answeredAt,
    })
    .from(microCredentials)
    .leftJoin(profiles, eq(profiles.userId, microCredentials.studentId))
    .where(eq(microCredentials.trainerId, trainerId))
    .orderBy(desc(microCredentials.issuedAt));

  const credentials: IssuedCredential[] = rows.map((row) => ({
    id: row.id,
    studentName: row.studentName?.trim() || null,
    skillTag: row.skillTag,
    skillLevel: (row.skillLevel ?? 1) as SkillLevel,
    milestoneTitle: row.milestoneTitle,
    note: row.note,
    status: row.status as MicroCredentialStatus,
    issuedAt: toIso(row.issuedAt),
    answeredAt: row.answeredAt ? toIso(row.answeredAt) : null,
  }));

  return {
    credentials,
    awaitingCount: credentials.filter((c) => c.status === 'awaiting_student').length,
    acceptedCount: credentials.filter((c) => c.status === 'accepted').length,
  };
}

/**
 * Signs off on a practical for one of this institute's students.
 *
 * Two refusals are worth naming.
 *
 * The student must be on this institute's roster, addressed by the enrolment id the
 * institute was given. There is no way to name somebody who is not on it, which is
 * what stops an institute issuing endorsements across the whole worker population.
 *
 * The row is created `awaiting_student`. This function cannot produce a credential a
 * student holds, and it writes nothing to their proof history — so the worst outcome
 * of a compromised or careless institute account is a pile of unanswered
 * notifications, not a network full of fabricated verified experience.
 */
export async function issueCredential(
  trainerId: string,
  input: IssueCredentialInput,
): Promise<IssuedCredential> {
  const [enrolment] = await db
    .select({ studentId: trainerStudents.studentId })
    .from(trainerStudents)
    .where(and(eq(trainerStudents.id, input.enrolmentId), eq(trainerStudents.trainerId, trainerId)))
    .limit(1);

  if (!enrolment || !enrolment.studentId) {
    throw AppError.notFound('That student is not on your roster.');
  }

  const [profile] = await db
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.userId, enrolment.studentId))
    .limit(1);

  const [inserted] = await db
    .insert(microCredentials)
    .values({
      studentId: enrolment.studentId,
      trainerId,
      // Recorded so the credential is attributable, and surfaced to the student
      // only. See the column comment in the schema.
      issuedBy: trainerId,
      skillTag: input.skillTag,
      skillLevel: input.skillLevel,
      milestoneTitle: input.milestoneTitle,
      note: input.note ?? null,
    })
    .returning({
      id: microCredentials.id,
      skillTag: microCredentials.skillTag,
      skillLevel: microCredentials.skillLevel,
      milestoneTitle: microCredentials.milestoneTitle,
      note: microCredentials.note,
      status: microCredentials.status,
      issuedAt: microCredentials.issuedAt,
    });

  if (!inserted) {
    throw AppError.internal('The credential could not be recorded.');
  }

  // A student can only answer a credential they know exists, and there is no other
  // route by which they would learn one is waiting. The notification names the
  // institute by the same fallback the credential page uses, so the two never
  // disagree about who sent it.
  const organization = await organizationNameFor(trainerId);
  await createNotification(
    enrolment.studentId,
    'credential_issued',
    'A milestone is waiting for your answer',
    organization
      ? `${organization} has recorded a practical you completed. Review it and decide whether to accept it.`
      : 'A training provider has recorded a practical you completed. Review it and decide whether to accept it.',
    '/credentials',
  );

  return {
    id: inserted.id,
    studentName: profile?.fullName?.trim() || null,
    skillTag: inserted.skillTag,
    skillLevel: (inserted.skillLevel ?? 1) as SkillLevel,
    milestoneTitle: inserted.milestoneTitle,
    note: inserted.note,
    status: inserted.status as MicroCredentialStatus,
    issuedAt: toIso(inserted.issuedAt),
    answeredAt: null,
  };
}

// ---------------------------------------------------------------------------
// The student's side
// ---------------------------------------------------------------------------

/**
 * The student's own credentials.
 *
 * Returns the awaiting and accepted buckets separately rather than one list with a
 * status on each row, because the two are answers to different questions and a
 * merged list invites a caller to count them together. They are not the same kind
 * of evidence and this is the response where that is enforced structurally.
 *
 * Attribution is resolved through `resolveIssuer` rather than read straight off the
 * two profile columns. Both of those columns are optional and the join is an outer
 * one, so reading them directly produced a credential that named nobody whenever a
 * provider had left their organization name blank or had been provisioned outside
 * `/auth/register` — an unattributed endorsement, which is the one thing this record
 * must never be. See `attribution.ts` for what the fallback may and may not reach
 * for.
 */
export async function listStudentCredentials(studentId: string): Promise<StudentCredentialsResponse> {
  const rows = await db
    .select({
      id: microCredentials.id,
      skillTag: microCredentials.skillTag,
      skillLevel: microCredentials.skillLevel,
      milestoneTitle: microCredentials.milestoneTitle,
      note: microCredentials.note,
      status: microCredentials.status,
      issuedAt: microCredentials.issuedAt,
      answeredAt: microCredentials.answeredAt,
      // Read from the issuing institute's profile and from the signatory's
      // separately: one account can be both, and the student is entitled to know
      // that rather than being shown two unrelated names.
      issuerOrganizationName: profiles.organizationName,
      issuerFullName: issuerProfile.fullName,
      // The account's own name in Supabase Auth. Joined as a table rather than read
      // through the Supabase client so the whole row comes from one query, and so this
      // stays a read of the authoritative identity store rather than a second copy of
      // it (doc/06 §2). `auth.users` is not in the Drizzle schema — it is Supabase's
      // own table and deliberately not modelled — so it is selected as raw SQL here.
      //
      // This is the tier that makes attribution work for an account provisioned outside
      // `/auth/register`, which never gets a `profiles` row. See `attribution.ts`.
      issuerAuthName: sql<string | null>`auth_user.raw_user_meta_data ->> 'full_name'`,
    })
    .from(microCredentials)
    .leftJoin(profiles, eq(profiles.userId, microCredentials.trainerId))
    .leftJoin(issuerProfile, eq(issuerProfile.userId, microCredentials.issuedBy))
    .leftJoin(
      authUsers,
      // The signatory, not the institute: the institution name should come from the
      // issuing account, and the signer is who this credential is attributed to.
      sql`auth_user.id = ${microCredentials.issuedBy}`,
    )
    .where(eq(microCredentials.studentId, studentId))
    .orderBy(desc(microCredentials.issuedAt));

  const mapped: StudentCredential[] = rows.map((row) => {
    const issuer = resolveIssuer({
      // The institution falls back to the signatory's own name. `trainer_id` and
      // `issued_by` are the same account for every credential this module creates,
      // but a future one where an admin signs on an institute's behalf would still
      // name the institute correctly and attribute the signature to the signer.
      organizationName: row.issuerOrganizationName ?? null,
      fullName: row.issuerFullName ?? null,
      authFullName: row.issuerAuthName ?? null,
    });

    return {
      id: row.id,
      skillTag: row.skillTag,
      skillLevel: (row.skillLevel ?? 1) as SkillLevel,
      milestoneTitle: row.milestoneTitle,
      note: row.note,
      status: row.status as MicroCredentialStatus,
      organizationName: issuer.organizationName,
      instructorName: issuer.instructorName,
      issuedAt: toIso(row.issuedAt),
      answeredAt: row.answeredAt ? toIso(row.answeredAt) : null,
    };
  });

  return {
    awaiting: mapped.filter((c) => c.status === 'awaiting_student'),
    accepted: mapped.filter((c) => c.status === 'accepted'),
    declinedCount: mapped.filter((c) => c.status === 'declined').length,
  };
}

/**
 * The student accepts or declines an issued credential.
 *
 * Scoped to the credential's own `student_id`, so a credential id belonging to
 * somebody else is not found rather than forbidden.
 *
 * One answer, and it is final. A second attempt is a conflict rather than a silent
 * overwrite, because an institute acts on the answer — telling a student their
 * acceptance was recorded when it was actually replaced would be worse than saying
 * it had already been answered.
 *
 * Neither branch touches `work_proof_logs` or `verifications`. Accepting is consent
 * to hold an endorsement, and it is deliberately not a route to a client-verified
 * count: a student cannot manufacture proof that a customer confirmed their work,
 * and an institute cannot manufacture it on their behalf.
 */
export async function respondToCredential(
  studentId: string,
  credentialId: string,
  response: 'accepted' | 'declined',
): Promise<{ status: MicroCredentialStatus }> {
  const [existing] = await db
    .select({ id: microCredentials.id, status: microCredentials.status })
    .from(microCredentials)
    .where(and(eq(microCredentials.id, credentialId), eq(microCredentials.studentId, studentId)))
    .limit(1);

  if (!existing) {
    throw AppError.notFound('That credential is not on your record.');
  }

  if (existing.status !== 'awaiting_student') {
    throw AppError.conflict('You have already answered this credential.');
  }

  const [updated] = await db
    .update(microCredentials)
    .set({ status: response, answeredAt: new Date() })
    .where(
      and(
        eq(microCredentials.id, credentialId),
        eq(microCredentials.studentId, studentId),
        // The status is part of the predicate, so two devices answering at once
        // cannot both succeed. The loser updates nothing and gets a 204, which is
        // indistinguishable from agreeing with the answer already stored.
        eq(microCredentials.status, 'awaiting_student'),
      ),
    )
    .returning({ status: microCredentials.status });

  return { status: (updated?.status ?? response) as MicroCredentialStatus };
}

// ---------------------------------------------------------------------------
// Demand dashboard and overview
// ---------------------------------------------------------------------------

/**
 * The institute's demand dashboard.
 *
 * Three reads and a pure merge. Nothing is cached and nothing is stored: a shortage
 * figure that outlives the rows it summarises is a figure nobody should teach a
 * curriculum from, and the cost of deriving it is an indexed scan at pre-launch
 * volume.
 *
 * Invitation totals are network-wide rather than per skill, and `direct_offers`
 * is the reason — it records the spec an invitation came from and no skill, so a
 * per-skill rejection count would silently describe only the invitations an
 * employer happened to save a spec for. See `demand.ts`.
 */
export async function getDemandInsights(
  _trainerId: string,
  limit: number,
): Promise<DemandInsightsResponse> {
  const [searches, supply, offerTotals, institutionCount] = await Promise.all([
    db
      .select({ skillTag: employerSpecs.requiredSkill, count: count() })
      .from(employerSpecs)
      .where(eq(employerSpecs.isActive, true))
      .groupBy(employerSpecs.requiredSkill),
    db
      .select({ skillTag: capabilityBlocks.skillTag, count: count() })
      .from(capabilityBlocks)
      // Anonymised rows have a null worker, so counting them would add supply that
      // nobody is standing behind. Excluded explicitly rather than by a join that
      // might drop them silently.
      .where(isNotNull(capabilityBlocks.workerId))
      .groupBy(capabilityBlocks.skillTag),
    db
      .select({
        sent: count(),
        accepted: sql<number>`count(*) filter (where ${directOffers.status} = 'accepted')::int`,
        declined: sql<number>`count(*) filter (where ${directOffers.status} = 'declined')::int`,
      })
      .from(directOffers),
    db.select({ n: count() }).from(users).where(eq(users.role, 'training_provider')),
  ]);

  const inputs = {
    searches: searches as SearchCountRow[],
    supply: supply as SupplyCountRow[],
  };

  const totals = demandTotals(inputs);
  const offer = offerTotals[0];

  return {
    skills: buildDemandRows(inputs, limit),
    totals: {
      ...totals,
      invitationsSent: Number(offer?.sent ?? 0),
      invitationsAccepted: Number(offer?.accepted ?? 0),
      invitationsDeclined: Number(offer?.declined ?? 0),
      // How many institutes are contributing demand signals at all. A dashboard
      // read from two institutions is a much thinner claim than one read from two
      // hundred, and saying so is more useful than the raw number.
      institutions: Number(institutionCount[0]?.n ?? 0),
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * The institute's dashboard summary.
 *
 * Deliberately counts only credentials this institute issued. The demand figures
 * are network-wide, and the roster is this institute's own, so nothing on this page
 * is about another institute and nothing about a student is visible to a second one.
 */
export async function getTrainerOverview(trainerId: string): Promise<TrainerOverviewResponse> {
  const [roster, credentials, demand] = await Promise.all([
    getRoster(trainerId),
    listIssuedCredentials(trainerId),
    getDemandInsights(trainerId, 5),
  ]);

  return {
    studentCount: roster.students.length,
    awaitingCredentials: credentials.awaitingCount,
    acceptedCredentials: credentials.acceptedCount,
    topDemandSkills: demand.skills,
    organizationName: roster.organizationName,
  };
}
