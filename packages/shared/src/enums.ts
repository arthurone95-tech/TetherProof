/**
 * Canonical role and status values for TetherProof.
 *
 * These are duplicated as PostgreSQL enum types in `apps/api/src/db/schema`.
 * Keep both sides in sync when adding a value.
 */

export const USER_ROLES = ['worker', 'employer', 'training_provider', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const METADATA_STATUSES = ['pending', 'valid', 'flagged_ai_fake'] as const;
export type MetadataStatus = (typeof METADATA_STATUSES)[number];

export const VERIFICATION_STATUSES = [
  'pending',
  'verified',
  'rejected',
  'fraud_blocked',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_RESPONSES = ['none', 'confirmed', 'rejected'] as const;
export type VerificationResponse = (typeof VERIFICATION_RESPONSES)[number];

export const OFFER_STATUSES = ['pending', 'accepted', 'declined'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];
