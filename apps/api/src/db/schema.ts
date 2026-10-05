import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['worker', 'employer', 'training_provider', 'admin']);
export const metadataStatus = pgEnum('metadata_status', ['pending', 'valid', 'flagged_ai_fake']);
export const verificationStatus = pgEnum('verification_status', [
  'pending',
  'verified',
  'rejected',
  'fraud_blocked',
]);
export const verificationResponse = pgEnum('verification_response', ['none', 'confirmed', 'rejected']);
export const offerStatus = pgEnum('offer_status', ['pending', 'accepted', 'declined']);
export const employerVerificationStatus = pgEnum('employer_verification_status', [
  'pending',
  'approved',
  'rejected',
]);
export const proximityStatus = pgEnum('proximity_status', ['within', 'outside', 'unavailable']);

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

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
     * Authoritative application role. Mirrored into `app_metadata.role` so the
     * database and the token agree, and so the value cannot be edited by the
     * account holder.
     */
    role: userRole('role').notNull().default('worker'),
    createdAt,
    updatedAt,
  },
  (table) => [index('users_role_idx').on(table.role)],
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
  },
  (table) => [uniqueIndex('profiles_user_id_unique').on(table.userId)],
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
    /** Set when the owning worker deleted their account. See migration 0005. */
    anonymisedAt: timestamp('anonymised_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    index('work_proof_logs_worker_id_idx').on(table.workerId),
    index('work_proof_logs_verification_status_idx').on(table.verificationStatus),
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

export type UserRow = typeof users.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type CapabilityBlockRow = typeof capabilityBlocks.$inferSelect;
export type WorkProofLogRow = typeof workProofLogs.$inferSelect;
export type VerificationRow = typeof verifications.$inferSelect;
export type EmployerSpecRow = typeof employerSpecs.$inferSelect;
export type DirectOfferRow = typeof directOffers.$inferSelect;
export type EmployerApprovalRow = typeof employerApprovals.$inferSelect;
export type CandidateHandleRow = typeof candidateHandles.$inferSelect;
