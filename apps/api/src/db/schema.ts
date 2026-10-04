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
    workerId: uuid('worker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    skillTag: varchar('skill_tag', { length: 160 }).notNull(),
    skillLevel: integer('skill_level').notNull().default(1),
    proofCount: integer('proof_count').notNull().default(0),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  },
  (table) => [
    index('capability_blocks_worker_id_idx').on(table.workerId),
    index('capability_blocks_skill_tag_idx').on(table.skillTag),
    uniqueIndex('capability_blocks_worker_skill_unique').on(table.workerId, table.skillTag),
  ],
);

export const workProofLogs = pgTable(
  'work_proof_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
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
    createdAt,
  },
  (table) => [
    index('work_proof_logs_worker_id_idx').on(table.workerId),
    index('work_proof_logs_verification_status_idx').on(table.verificationStatus),
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
    createdAt,
  },
  (table) => [
    index('direct_offers_employer_id_idx').on(table.employerId),
    index('direct_offers_worker_id_idx').on(table.workerId),
    uniqueIndex('direct_offers_employer_worker_unique').on(table.employerId, table.workerId),
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
}));

export type UserRow = typeof users.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type CapabilityBlockRow = typeof capabilityBlocks.$inferSelect;
export type WorkProofLogRow = typeof workProofLogs.$inferSelect;
export type VerificationRow = typeof verifications.$inferSelect;
export type EmployerSpecRow = typeof employerSpecs.$inferSelect;
export type DirectOfferRow = typeof directOffers.$inferSelect;
