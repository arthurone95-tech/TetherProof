import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['worker', 'employer', 'training_provider', 'admin']);

/**
 * The capabilities an account may hold, migration `0012`.
 *
 * Replaces the single `users.role` column. One person can be an electrician, a student at
 * an institute, and the owner of a business that hires, and that is three capabilities on
 * one identity rather than three accounts with three portfolios that could never be joined.
 *
 * `admin` is deliberately absent and cannot be added here. It is a platform role rather
 * than something a person does, it is read from the server-controlled `app_metadata.role`
 * claim, and it has never been self-assignable — that is the E-024 privilege-escalation
 * surface, and a table a signup could reach is exactly the wrong place to reintroduce it.
 */
export const userCapability = pgEnum('user_capability', [
  'worker',
  'employer',
  'training_provider',
  'trainee',
]);

/**
 * Why a capability was held.
 *
 * Recorded rather than inferred, so an access review can tell an inherited grant from a
 * deliberate one. `legacy` is the migration `0012` backfill: an account that already had a
 * role keeps exactly what it had, and saying so is more honest than implying somebody
 * granted it.
 */
export const capabilityGrantSource = pgEnum('capability_grant_source', [
  'self',
  'legacy',
  'enrolment',
  'business',
  'admin',
  'registration',
]);

export const businessStatus = pgEnum('business_status', ['pending', 'approved', 'rejected']);
export const businessMemberRole = pgEnum('business_member_role', ['owner', 'member']);
export const metadataStatus = pgEnum('metadata_status', ['pending', 'valid', 'flagged_ai_fake']);
export const verificationStatus = pgEnum('verification_status', [
  'pending',
  'verified',
  'rejected',
  // Migration 0008. Withheld pending human review. Distinct from `fraud_blocked`
  // because "something looked off" and "this was fraud" are different claims, and
  // conflating them is how an honest worker ends up permanently branded by a
  // heuristic. Neither state counts toward a verified badge.
  'flagged',
  'fraud_blocked',
]);
export const proofReviewStatus = pgEnum('proof_review_status', [
  'none',
  'appealed',
  'under_review',
  'upheld',
  'overturned',
]);
export const verificationResponse = pgEnum('verification_response', ['none', 'confirmed', 'rejected']);
export const offerStatus = pgEnum('offer_status', ['pending', 'accepted', 'declined']);
export const employerVerificationStatus = pgEnum('employer_verification_status', [
  'pending',
  'approved',
  'rejected',
]);
export const proximityStatus = pgEnum('proximity_status', ['within', 'outside', 'unavailable']);
export const invitationPreference = pgEnum('invitation_preference', ['all', 'approved_only']);
export const notificationKind = pgEnum('notification_kind', [
  'offer_received',
  'offer_accepted',
  'offer_declined',
  'verification_confirmed',
  'verification_rejected',
  // Migration 0011. A student can only answer a credential they know exists, and
  // this is the only route by which they learn one is waiting.
  'credential_issued',
  'link_expired',
  'link_expiring',
]);
export const connectionProvider = pgEnum('connection_provider', ['github']);
export const connectionStatus = pgEnum('connection_status', ['connected', 'revoked']);

/**
 * Where a micro-credential is in its two-party lifecycle.
 *
 * Issuing cannot produce a final credential. See `MICRO_CREDENTIAL_STATUSES` in
 * `packages/shared/src/enums.ts` for why the student is the second signature and
 * what would be lost if an institute could mint one on its own.
 */
export const microCredentialStatus = pgEnum('micro_credential_status', [
  'awaiting_student',
  'accepted',
  'declined',
]);

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * When a student joined an institute, and when an institute signed off on them.
 *
 * Separate names rather than reusing `createdAt` because the column on the row is
 * the fact being recorded — the moment a roster entry was made, the moment a
 * milestone was signed — and a reader of the schema should not have to check
 * whether `created_at` here means the insert time or something else.
 */
const enrolledAt = timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow();
const issuedAt = timestamp('issued_at', { withTimezone: true }).notNull().defaultNow();
const grantedAt = timestamp('granted_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    /**
     * Primary key mirrors `auth.users.id`. Credentials, email, and phone live
     * in Supabase Auth and are deliberately not duplicated here, so there is a
     * single source of truth for identity data.
     */
    id: uuid('id').primaryKey(),
    /**
     * The former `role` column is gone, and its absence is the point of migration
     * `0012`. One account may now hold several capabilities, so a single column could
     * only ever name one of them and would have been *wrong* for exactly the people
     * this change exists to serve. Reading capabilities is what `authorize` does.
     *
     * The PostgreSQL `user_role` enum type still exists — dropping an enum type is a
     * separate, riskier operation and it is referenced by the historical migrations
     * that produced today's data — but nothing writes to it or reads from it.
     */
    createdAt,
    updatedAt,
  },
);

/**
 * What one account is authorised to do.
 *
 * The set that replaced `users.role`. A composite primary key makes holding two
 * capabilities two rows and holding the same one twice impossible by construction rather
 * than by a unique index somebody could forget to add.
 *
 * Cascades with the account: deleting removes the capabilities, and an anonymised record
 * is left with none, which is the same treatment `profiles` gets.
 */
export const userCapabilities = pgTable(
  'user_capabilities',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    capability: userCapability('capability').notNull(),
    grantSource: capabilityGrantSource('grant_source').notNull().default('self'),
    grantedAt,
    /**
     * The account that granted this, where there was one. Null for self-service and for
     * the `0012` backfill, which is the honest answer: nobody else was involved.
     */
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.capability] }),
    // Capability lookups are always "every holder of X", so the leading column is the
    // useful one.
    index('user_capabilities_capability_idx').on(table.capability),
  ],
);

/**
 * A business that hires through TetherProof.
 *
 * A real entity rather than a label on a person, because the agreed design keeps an
 * owner's personal worker identity separate from their business's employer permissions.
 * Kojo the electrician and "Kojo Electrical Services" are different things that happen to
 * share an owner, and only the second one carries hiring rights.
 *
 * `status` mirrors `employer_approvals` on purpose. An approval is a row with a reviewer,
 * a time and an optional note, not a boolean, because "approved: yes" becomes
 * indistinguishable from "approved by a colleague last quarter". Creating one is open to
 * any account so there is somebody to approve — the same reasoning that left employer
 * self-registration open, and why a pending business is a real state rather than a
 * broken one.
 */
export const businesses = pgTable(
  'businesses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 200 }).notNull(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: businessStatus('status').notNull().default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** Shown to the owner. Never a document reference or a contact detail. */
    note: varchar('note', { length: 200 }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('businesses_owner_idx').on(table.ownerUserId),
    index('businesses_status_idx').on(table.status, table.createdAt),
  ],
);

/**
 * Who may act for a business.
 *
 * A membership is what grants the `employer` capability, so this table is the answer to
 * "why may this person hire?" — and revoking a membership takes the capability away again,
 * which is why it is a row rather than a flag on the business.
 *
 * Cascades from both sides. A business that closes takes its members with it; a person
 * who deletes their account is removed from every business they belonged to.
 */
export const businessMemberships = pgTable(
  'business_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    memberRole: businessMemberRole('member_role').notNull().default('member'),
    createdAt,
  },
  (table) => [
    // One membership per person per business. Doubling it would double the employer
    // surface, the same reasoning as the unique index on `direct_offers`.
    uniqueIndex('business_memberships_unique').on(table.businessId, table.userId),
    index('business_memberships_user_idx').on(table.userId),
  ],
);

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fullName: varchar('full_name', { length: 160 }),
    locationCity: varchar('location_city', { length: 120 }),
    locationGps: varchar('location_gps', { length: 64 }),
    organizationName: varchar('organization_name', { length: 200 }),
    avatarUrl: varchar('avatar_url', { length: 512 }),
    /**
     * Whether the worker may appear in employer search results.
     *
     * Defaults to true so a freshly registered worker is reachable the moment
     * they have verified proof, which is the network's reason for existing.
     * Set to false, the worker is excluded at the aggregation layer, so a token
     * cannot be used to probe for them.
     */
    discoverable: boolean('discoverable').notNull().default(true),
    /**
     * Whether the worker is named, with an optional photo, on the customer
     * verification page reached by a confirmation link.
     *
     * Separate from `discoverable` because the two expose this worker to
     * different audiences: `discoverable` governs employer search, while this
     * governs whoever ends up holding a link — and a confirmation link is
     * forwardable by nature. A worker who is happy to be found by employers may
     * still not want their name attached to a link that travels.
     *
     * Defaults to true, so a worker who has done nothing but sign up is named on
     * the page for the person they actually worked for, which is the ordinary case.
     * Setting it false leaves the page anonymous without affecting search.
     */
    showNameOnVerificationLink: boolean('show_name_on_verification_link')
      .notNull()
      .default(true),
    /**
     * Whether the addresses this worker connected on Connect may be shown with
     * their profile where it is read, such as employer search.
     *
     * A link is added in order to be seen, so the default is true and the
     * ordinary worker changes nothing. It is a separate switch because it is a
     * separate disclosure: `discoverable` governs whether the worker appears at
     * all, `publicProfile` governs a page the worker shares by address, and
     * this governs what rides along with the card the worker does not hand out
     * themselves.
     *
     * Nothing consumes it yet — links are collected on Connect but not yet
     * stored — so it is the worker's recorded choice, honoured the moment a
     * surface does display links, rather than a default made for them later.
     */
    showLinksOnProfile: boolean('show_links_on_profile').notNull().default(true),
    /**
     * Whether the shareable capability profile page answers.
     *
     * The page is public and exists only because the worker turned it on, so the
     * default is false and the slug below stays null until then.
     */
    publicProfile: boolean('public_profile').notNull().default(false),
    /**
     * The unguessable address of the public capability profile.
     *
     * Generated once when the page is first enabled and never changed unless the
     * worker asks for a new one. Non-empty only while `publicProfile` is true:
     * turning the page off clears it, so a disabled page has no lingering URL
     * that 404s.
     */
    publicSlug: varchar('public_slug', { length: 32 }),
    /**
     * Which employers may send this worker an invitation.
     *
     * `approved_only` is the strong privacy position: contacts only ever come
     * from accounts a person has looked at. It is enforced at invitation
     * creation, not merely displayed.
     */
    invitationPreference: invitationPreference('invitation_preference').notNull().default('all'),
  },
  (table) => [
    uniqueIndex('profiles_user_id_unique').on(table.userId),
    uniqueIndex('profiles_public_slug_unique').on(table.publicSlug).where(sql`${table.publicSlug} is not null`),
  ],
);

/**
 * Addresses a worker attached to their account on Connect.
 *
 * Stored only — no credential, no API call, nothing read from the source. The
 * worker vouches for the address by pasting it, the same way they vouch for
 * anything else they write on their profile. One row per link, owned by the
 * worker, removable by them at any time.
 */
export const workerLinks = pgTable(
  'worker_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    url: varchar('url', { length: 300 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('worker_links_user_idx').on(table.userId)],
);
export const capabilityBlocks = pgTable(
  'capability_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Null only after the worker deleted their account.
     *
     * The row is retained rather than cascaded, so the skill tag and level keep
     * contributing to aggregate counts. Migration 0005 makes this nullable and
     * swaps the restrict for `ON DELETE set null`; before that, a worker who had
     * ever logged work could not be deleted at all (doc/13 E-025).
     */
    workerId: uuid('worker_id').references(() => users.id, { onDelete: 'set null' }),
    skillTag: varchar('skill_tag', { length: 160 }).notNull(),
    skillLevel: integer('skill_level').notNull().default(1),
    /**
     * Marks the detached state positively rather than inferring it from
     * `workerId` being null, which cannot distinguish a deletion from a bad
     * write.
     */
    anonymisedAt: timestamp('anonymised_at', { withTimezone: true }),
    // There is deliberately no cached proof count or last-verified timestamp
    // here. Both were dropped in migration 0004: nothing had ever written them,
    // so they always read zero, and an employer search ranking on a cached
    // number would be ranking on a lie. Counts aggregate from `work_proof_logs`
    // at read time, which cannot drift. See the reasoning in 0004.
  },
  (table) => [
    index('capability_blocks_worker_id_idx').on(table.workerId),
    index('capability_blocks_skill_tag_idx').on(table.skillTag),
    // Anonymised rows have a null worker_id, which PostgreSQL treats as distinct,
    // so several deleted workers can each retain a block for the same skill.
    // Collapsing them would destroy a count.
    uniqueIndex('capability_blocks_worker_skill_unique').on(table.workerId, table.skillTag),
  ],
);

export const workProofLogs = pgTable(
  'work_proof_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Null only after the worker deleted their account; see `capabilityBlocks`.
     *
     * Anonymised rows are retained, not deleted, and `capabilityBlockId` still
     * points at the anonymised block. Severing that too would strip the skill tag
     * and drop the record out of every aggregate, quietly decrementing counts
     * that other people's trust scores depend on.
     */
    workerId: uuid('worker_id').references(() => users.id, { onDelete: 'set null' }),
    capabilityBlockId: uuid('capability_block_id').references(() => capabilityBlocks.id, {
      onDelete: 'set null',
    }),
    description: text('description').notNull(),
    mediaUrl: varchar('media_url', { length: 512 }),
    metadataStatus: metadataStatus('metadata_status').notNull().default('pending'),
    /**
     * Provenance findings, derived from metadata the scrubber destroyed.
     *
     * Booleans only. There is no column anywhere for a camera make, a model, a
     * serial number, or a capture time, which is what allows a fraud signal to
     * exist without weakening the retention promise in doc/08.
     */
    mediaSignalEvaluated: boolean('media_signal_evaluated').notNull().default(false),
    mediaHasCameraSignature: boolean('media_has_camera_signature'),
    mediaTimestampPlausible: boolean('media_timestamp_plausible'),
    mediaEncoderKnown: boolean('media_encoder_known'),
    submissionGps: varchar('submission_gps', { length: 64 }),
    verificationStatus: verificationStatus('verification_status').notNull().default('pending'),
    /**
     * Speech-to-text of a voice recording, when a transcription provider is
     * configured and the recording could be transcribed.
     *
     * Null means no provider ran or it failed — the recording itself remains the
     * record. The transcript is worker-authored content rendered as text only,
     * never as markup.
     */
    transcript: text('transcript'),
    /** Set when the owning worker deleted their account. See migration 0005. */
    anonymisedAt: timestamp('anonymised_at', { withTimezone: true }),
    /**
     * When the platform withheld this record, and why — migration 0008.
     *
     * Written for both `flagged` and `fraud_blocked`. A worker who cannot see that
     * their record stopped counting has no way to respond to it, which is the same
     * as an undisclosed penalty.
     */
    flaggedAt: timestamp('flagged_at', { withTimezone: true }),
    /**
     * A plain sentence naming what raised the record, safe to show the worker.
     *
     * Never a score, a threshold, or an anti-fraud signal: those describe the
     * detector rather than helping the worker answer it.
     */
    flagReason: varchar('flag_reason', { length: 400 }),
    /** The appeal lifecycle. See migration 0008. */
    reviewStatus: proofReviewStatus('review_status').notNull().default('none'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** Which admin decided, so a decision is attributable rather than anonymous. */
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    /** When an overturned block returned the record to `verified`. */
    restoredAt: timestamp('restored_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    index('work_proof_logs_worker_id_idx').on(table.workerId),
    index('work_proof_logs_verification_status_idx').on(table.verificationStatus),
    index('work_proof_logs_review_status_idx')
      .on(table.reviewStatus)
      .where(sql`${table.reviewStatus} <> 'none'`),
  ],
);

/**
 * Stored proof objects still awaiting removal after their account was deleted.
 *
 * Storage refuses deletion from SQL — verified, not assumed: `delete from
 * storage.objects` raises 42501 from `storage.protect_delete()` even as the table
 * owner, and only the Storage API removes an object. So a database trigger cannot
 * finish an account deletion, and an object left behind keeps the deleted
 * worker's user id in its path prefix.
 *
 * This records those paths so they can be removed rather than forgotten. An
 * untracked object is indistinguishable from one that was never created.
 *
 * A row is only ever written at deletion time, when the user id in the prefix has
 * just been deleted from `auth.users` and therefore identifies nobody.
 */
export const orphanedProofMedia = pgTable(
  'orphaned_proof_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bucket: text('bucket').notNull(),
    path: text('path').notNull(),
    /** The proof the object belonged to. Retained for audit. */
    workProofId: uuid('work_proof_id').references(() => workProofLogs.id, { onDelete: 'set null' }),
    createdAt,
  },
  (table) => [
    uniqueIndex('orphaned_proof_media_path_unique').on(table.bucket, table.path),
    index('orphaned_proof_media_work_proof_idx')
      .on(table.workProofId)
      .where(sql`${table.workProofId} is not null`),
  ],
);

export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workProofId: uuid('work_proof_id')
      .notNull()
      .references(() => workProofLogs.id, { onDelete: 'restrict' }),
    /**
     * Salted SHA-256 of the verifier's phone number, used only to recognise that
     * the same party confirmed several proofs. The number itself is never
     * stored; it would be the one piece of client PII this table would hold, and
     * the collusion filter does not need it.
     *
     * Null means the worker supplied no number, so network diversity could not
     * be assessed for this endorsement.
     */
    verifierPhoneHash: varchar('verifier_phone_hash', { length: 64 }),
    /**
     * SHA-256 hash of the single-use verification token. The raw token is
     * returned once when the record is created and is never stored, so a
     * database disclosure cannot be replayed to confirm work.
     */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    response: verificationResponse('response').notNull().default('none'),
    verifierGps: varchar('verifier_gps', { length: 64 }),
    /** Great-circle distance between the submission point and the client's tap. */
    proximityKm: real('proximity_km'),
    /**
     * `unavailable` is an absence of evidence, not a pass. Kept distinct from
     * `within` so a client who declined geolocation is never conflated with one
     * who was standing at the job site.
     */
    proximityStatus: proximityStatus('proximity_status'),
    /** 0..1 where 1 is fully supported. Null for a rejection, which is not scored. */
    fraudScore: real('fraud_score'),
    /** Per-signal breakdown behind fraudScore, so a blocked proof is explainable. */
    fraudScoreDetail: jsonb('fraud_score_detail'),
    /** Whether the link was accepted by a messaging provider, and why not if not. */
    dispatchStatus: varchar('dispatch_status', { length: 32 }),
    dispatchDetail: varchar('dispatch_detail', { length: 200 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex('verifications_token_hash_unique').on(table.tokenHash),
    index('verifications_work_proof_id_idx').on(table.workProofId),
    index('verifications_verifier_phone_hash_idx')
      .on(table.verifierPhoneHash)
      .where(sql`${table.verifierPhoneHash} is not null`),
  ],
);

export const employerSpecs = pgTable(
  'employer_specs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employerId: uuid('employer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    requiredSkill: varchar('required_skill', { length: 160 }).notNull(),
    minProofThreshold: integer('min_proof_threshold').notNull().default(1),
    maxDistanceKm: integer('max_distance_km').notNull().default(25),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
  },
  (table) => [
    index('employer_specs_employer_id_idx').on(table.employerId),
    index('employer_specs_active_skill_idx').on(table.isActive, table.requiredSkill),
  ],
);

export const directOffers = pgTable(
  'direct_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employerId: uuid('employer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: offerStatus('status').notNull().default('pending'),
    /**
     * Free text from the employer, shown to the worker when they decide.
     *
     * Bounded at 500 characters and always rendered as text, never as markup. It
     * is the only employer-authored content a worker ever sees, so it is the
     * obvious place for injected script or an attempt at social engineering.
     */
    note: varchar('note', { length: 500 }),
    /** The spec this invitation came from, for the employer's own audit trail. */
    specId: uuid('spec_id').references(() => employerSpecs.id, { onDelete: 'set null' }),
    /** When the worker accepted or declined. Null while pending. */
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('direct_offers_employer_id_idx').on(table.employerId),
    index('direct_offers_worker_id_idx').on(table.workerId),
    uniqueIndex('direct_offers_employer_worker_unique').on(table.employerId, table.workerId),
  ],
);

/**
 * Approval state for an employer account.
 *
 * A row is created only when a decision is actually needed. Its absence means
 * pending, which behaves identically to an explicit `pending` row, so a freshly
 * registered employer needs no setup step before they can search.
 */
export const employerApprovals = pgTable(
  'employer_approvals',
  {
    employerId: uuid('employer_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: employerVerificationStatus('status').notNull().default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    /** Short reviewer note. Never holds a document reference or contact detail. */
    note: varchar('note', { length: 200 }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [index('employer_approvals_status_idx').on(table.status)],
);

/**
 * Employer-scoped opaque handles, so a masked candidate card can still be acted on.
 *
 * `direct_offers.worker_id` is a real foreign key, so an employer must be able to
 * name a specific candidate, but Feature 4.2 promises not to reveal who that
 * candidate is. A handle is a random token that only the server resolves, and
 * only for the employer it was issued to. The value is random rather than derived
 * from the worker id on purpose: a derived value would be stable across employers
 * and therefore correlatable by anyone comparing two result sets.
 *
 * Handles expire. They are a temporary capability to address one card, not a
 * durable pseudonymous identifier, and a permanent one would quietly become the
 * tracking id that masking was meant to prevent.
 */
export const candidateHandles = pgTable(
  'candidate_handles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employerId: uuid('employer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    handle: varchar('handle', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex('candidate_handles_employer_worker_unique').on(table.employerId, table.workerId),
    uniqueIndex('candidate_handles_handle_unique').on(table.handle),
    index('candidate_handles_employer_idx').on(table.employerId),
    index('candidate_handles_expires_at_idx').on(table.expiresAt),
  ],
);

/**
 * A worker an employer has chosen to keep.
 *
 * The one place in the product where a durable row records that a particular
 * employer was interested in a particular worker. Search is deliberately
 * stateless so that no such record accumulates, and this accepts that in a
 * narrow and deliberate form: the row belongs to the employer who wrote it, is
 * never surfaced to the worker, and is never returned to anyone else.
 *
 * `workerId` is the identifier search refuses to emit, and that stays true — the
 * API resolves a candidate handle to a worker when saving and hands back a
 * freshly issued handle when reading, so the id stays server-side.
 */
export const employerSavedWorkers = pgTable(
  'employer_saved_workers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employerId: uuid('employer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    skillTag: varchar('skill_tag', { length: 160 }).notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex('employer_saved_workers_unique').on(table.employerId, table.workerId, table.skillTag),
    index('employer_saved_workers_employer_idx').on(table.employerId, table.createdAt),
    index('employer_saved_workers_worker_idx').on(table.workerId),
  ],
);

/**
 * One event in a member's notification feed.
 *
 * Kinds cover both sides of the loop: a worker sees an invitation arrive
 * (`offer_received`) and a verification come back, and an employer sees their
 * invitation answered (`offer_accepted`, `offer_declined`). `link_expiring` is
 * deliberately never written; it is synthesized at read time from the worker's own
 * outstanding links (see the notifications module), so a page can never hold a
 * stale expiry row. `link_expired` is written when a resend retires an already-
 * expired link, which is a real event with a real consequence.
 *
 * The body is plain text rendered as text only. It is the only other party's
 * content on this row is the offer note, which is already bounded and
 * text-rendered on the invitations page.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: notificationKind('kind').notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    body: varchar('body', { length: 280 }).notNull(),
    /** Destination in the app the notification points at; null when it goes nowhere. */
    link: varchar('link', { length: 512 }),
    /** When the member saw the feed. Null while unread. */
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    index('notifications_user_id_idx').on(table.userId),
    index('notifications_user_unread_idx')
      .on(table.userId, table.readAt)
      .where(sql`${table.readAt} is null`),
  ],
);

/**
 * A telemetry source a worker connected so their work can be captured from it.
 *
 * The scaffold keeps the connection row and the fact of the connection. A later
 * phase will add the event ingestion that turns commits or merges into proofs;
 * the row already carries the provider's username and a last-synced stamp so the
 * sync state has somewhere to live when that lands. Tokens are deliberately not
 * stored here yet: holding an OAuth token is a storage decision with its own
 * security review, and the scaffold records the connection, not the credential.
 */
export const telemetryConnections = pgTable(
  'telemetry_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: connectionProvider('provider').notNull(),
    /** The provider-side username, shown to the worker to recognise the account. */
    externalUsername: varchar('external_username', { length: 120 }),
    status: connectionStatus('status').notNull().default('connected'),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('telemetry_connections_user_provider_unique').on(table.userId, table.provider),
    index('telemetry_connections_provider_idx').on(table.provider),
  ],
);

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles, { fields: [users.id], references: [profiles.userId] }),
  capabilityBlocks: many(capabilityBlocks),
  workProofLogs: many(workProofLogs),
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, { fields: [profiles.userId], references: [users.id] }),
}));

export const capabilityBlocksRelations = relations(capabilityBlocks, ({ one, many }) => ({
  worker: one(users, { fields: [capabilityBlocks.workerId], references: [users.id] }),
  workProofLogs: many(workProofLogs),
}));

export const workProofLogsRelations = relations(workProofLogs, ({ one, many }) => ({
  worker: one(users, { fields: [workProofLogs.workerId], references: [users.id] }),
  capabilityBlock: one(capabilityBlocks, {
    fields: [workProofLogs.capabilityBlockId],
    references: [capabilityBlocks.id],
  }),
  verifications: many(verifications),
}));

export const verificationsRelations = relations(verifications, ({ one }) => ({
  workProof: one(workProofLogs, { fields: [verifications.workProofId], references: [workProofLogs.id] }),
}));

export const employerSpecsRelations = relations(employerSpecs, ({ one }) => ({
  employer: one(users, { fields: [employerSpecs.employerId], references: [users.id] }),
}));

export const directOffersRelations = relations(directOffers, ({ one }) => ({
  employer: one(users, { fields: [directOffers.employerId], references: [users.id] }),
  worker: one(users, { fields: [directOffers.workerId], references: [users.id] }),
  spec: one(employerSpecs, { fields: [directOffers.specId], references: [employerSpecs.id] }),
}));

export const employerApprovalsRelations = relations(employerApprovals, ({ one }) => ({
  employer: one(users, { fields: [employerApprovals.employerId], references: [users.id] }),
}));

export const candidateHandlesRelations = relations(candidateHandles, ({ one }) => ({
  employer: one(users, { fields: [candidateHandles.employerId], references: [users.id] }),
  worker: one(users, { fields: [candidateHandles.workerId], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const telemetryConnectionsRelations = relations(telemetryConnections, ({ one }) => ({
  user: one(users, { fields: [telemetryConnections.userId], references: [users.id] }),
}));

// The training-provider relations sit with their tables further down this file, not
// with the others here: a `relations()` call evaluates its table reference
// immediately, and a `const` table declared below it is still in its temporal dead
// zone. Moving the tables up instead would have meant relocating a block of
// documented schema away from the other people-table definitions it mirrors.

// ---------------------------------------------------------------------------
// Training providers (doc/02 Module 4)
// ---------------------------------------------------------------------------

/**
 * A student enrolled with one training provider.
 *
 * Enrolment is a link, not a relationship the platform manages on an institute's
 * behalf: a student redeems a code the institute published, so being on a roster is
 * something they did rather than something that happened to them.
 *
 * Deliberately holds no email, phone, or location. An institute needs a name to
 * put on a milestone and nothing more, and a roster is the kind of table that
 * quietly becomes a contact list. Everything else about a student is reachable
 * only through their own account.
 *
 * Cascades from either side. If a student leaves the course they disappear from
 * the roster, and if the institute closes its account its roster goes with it.
 */
export const trainerStudents = pgTable(
  'trainer_students',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The institute. */
    trainerId: uuid('trainer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The enrolled student. Always a worker; enrolment of any other role is refused. */
    studentId: uuid('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    enrolledAt,
  },
  (table) => [
    // One enrolment per institute per student, so redeeming a code twice is a no-op
    // rather than a duplicated row in the roster and a duplicated pending decision.
    uniqueIndex('trainer_students_trainer_student_unique').on(table.trainerId, table.studentId),
    index('trainer_students_trainer_id_idx').on(table.trainerId),
    index('trainer_students_student_id_idx').on(table.studentId),
  ],
);

/**
 * A micro-credential an institute has signed off, awaiting or holding the
 * student's confirmation.
 *
 * This is the first record on the platform pairing one named institution with one
 * named person's capability, and it is scoped as narrowly as the saved-worker table
 * was: only the issuing institute sees it in full, the student sees their own, and
 * it is never shown to another institute or to any employer.
 *
 * Two decisions worth stating.
 *
 * `student_id` is nullable and `ON DELETE set null`, matching `capability_blocks`
 * and `work_proof_logs` rather than cascading. A student who has earned a credential
 * must still be able to delete their account — the two `ON DELETE restrict` keys
 * that once made that impossible are the defect recorded as `doc/13` E-025, and
 * adding a third would repeat it. The row is retained and stamped, so the skill and
 * the institute survive to keep contributing to aggregate counts while the person
 * does not.
 *
 * `issued_by` is `set null` rather than cascading: a credential is the institute's
 * record, so one instructor leaving must not erase what the institute signed.
 *
 * It is also the one name on this schema that is read back and shown, unlike every
 * other. An endorsement with nobody's name on it is exactly the kind of claim this
 * platform exists to make attributable, so the issuer is part of the evidence rather
 * than a detail withheld from it — the student is told which institute and which
 * member of staff signed a record about them, and nobody else is told anything.
 *
 * Deliberately **not** counted anywhere a client-verified proof is counted.
 * `verifiedProofs`, `verifiedTotal`, and every employer-search aggregate derive from
 * `work_proof_logs` and a confirmation row, and none of them reads this table. A
 * credential says an institution stands behind a skill; a proof says a customer
 * watched the work happen. Summing them would let a bootcamp that issued to a
 * hundred students look like a hundred people whose work was verified by real
 * employers.
 */
export const microCredentials = pgTable(
  'micro_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null only once the student deleted their account; see above. */
    studentId: uuid('student_id').references(() => users.id, { onDelete: 'set null' }),
    /** The issuing institute. Cascades: its credentials are its own records. */
    trainerId: uuid('trainer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The instructor who signed off. Retained, never exposed. */
    issuedBy: uuid('issued_by').references(() => users.id, { onDelete: 'set null' }),
    /**
     * The capability block on the student's graph this credential sits on.
     *
     * Set null with the block rather than cascading the credential away, for the
     * same reason the worker's proofs survive their block: severing it would strip
     * the skill and drop the record out of every aggregate. The skill tag is
     * duplicated on this row precisely so that survives independently.
     */
    capabilityBlockId: uuid('capability_block_id').references(() => capabilityBlocks.id, {
      onDelete: 'set null',
    }),
    skillTag: varchar('skill_tag', { length: 160 }).notNull(),
    skillLevel: integer('skill_level').notNull().default(1),
    /** The practical the student sat. Free text: curricula are not standardisable. */
    milestoneTitle: varchar('milestone_title', { length: 200 }).notNull(),
    /** The instructor's own words. Rendered as text, never as markup. */
    note: text('note'),
    status: microCredentialStatus('status').notNull().default('awaiting_student'),
    issuedAt,
    /** When the student answered. Null while pending. */
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    /** Set when the owning student deleted their account. */
    anonymisedAt: timestamp('anonymised_at', { withTimezone: true }),
  },
  (table) => [
    index('micro_credentials_trainer_id_idx').on(table.trainerId),
    index('micro_credentials_student_id_idx').on(table.studentId),
    // The institute's list is read newest first, and the student's own page reads
    // both buckets; both queries filter on one of these two columns.
    index('micro_credentials_trainer_issued_idx').on(table.trainerId, table.issuedAt),
    index('micro_credentials_student_status_idx').on(table.studentId, table.status),
  ],
);

/**
 * The one live enrolment code for a training provider.
 *
 * Only a SHA-256 digest is stored, and the raw code is returned exactly once, when
 * it is created. This is the same treatment a confirmation link gets, and for the
 * same reason: the value is a capability, and a stored capability is one a database
 * disclosure can hand to an attacker.
 *
 * The code is short-lived by design — the institute rotates it, and rotating
 * invalidates the previous one without touching anybody already enrolled, because
 * enrolment is a row rather than a property of the code. That is what lets the
 * digest be stored at all: there is no reason for the value to outlive the moment
 * it was shared.
 */
export const trainerEnrolmentCodes = pgTable(
  'trainer_enrolment_codes',
  {
    trainerId: uuid('trainer_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    createdAt,
  },
  (table) => [index('trainer_enrolment_codes_hash_idx').on(table.codeHash)],
);

export const trainerStudentsRelations = relations(trainerStudents, ({ one }) => ({
  trainer: one(users, { fields: [trainerStudents.trainerId], references: [users.id] }),
  student: one(users, { fields: [trainerStudents.studentId], references: [users.id] }),
}));

export const microCredentialsRelations = relations(microCredentials, ({ one }) => ({
  trainer: one(users, { fields: [microCredentials.trainerId], references: [users.id] }),
  student: one(users, { fields: [microCredentials.studentId], references: [users.id] }),
  capabilityBlock: one(capabilityBlocks, {
    fields: [microCredentials.capabilityBlockId],
    references: [capabilityBlocks.id],
  }),
}));

export type UserRow = typeof users.$inferSelect;
export type TrainerStudentRow = typeof trainerStudents.$inferSelect;
export type MicroCredentialRow = typeof microCredentials.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type CapabilityBlockRow = typeof capabilityBlocks.$inferSelect;
export type WorkProofLogRow = typeof workProofLogs.$inferSelect;
export type VerificationRow = typeof verifications.$inferSelect;
export type EmployerSpecRow = typeof employerSpecs.$inferSelect;
export type DirectOfferRow = typeof directOffers.$inferSelect;
export type EmployerApprovalRow = typeof employerApprovals.$inferSelect;
export type CandidateHandleRow = typeof candidateHandles.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type TelemetryConnectionRow = typeof telemetryConnections.$inferSelect;
