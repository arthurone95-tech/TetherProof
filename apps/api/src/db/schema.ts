import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
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
    verifierPhone: varchar('verifier_phone', { length: 32 }),
    /**
     * SHA-256 hash of the single-use verification token. The raw token is
     * returned once when the record is created and is never stored, so a
     * database disclosure cannot be replayed to confirm work.
     */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    response: verificationResponse('response').notNull().default('none'),
    verifierGps: varchar('verifier_gps', { length: 64 }),
    fraudScore: real('fraud_score'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex('verifications_token_hash_unique').on(table.tokenHash),
    index('verifications_work_proof_id_idx').on(table.workProofId),
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
