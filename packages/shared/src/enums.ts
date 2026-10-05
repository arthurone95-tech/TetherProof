/**
 * Canonical role and status values for TetherProof.
 *
 * These are duplicated as PostgreSQL enum types in `apps/api/src/db/schema`.
 * Keep both sides in sync when adding a value.
 */

export const USER_ROLES = ['worker', 'employer', 'training_provider', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Roles an account may choose for itself when registering.
 *
 * `admin` is deliberately absent. The registration endpoint writes the role claim
 * server-side, so honouring a self-declared `admin` let anyone create an account
 * that satisfied `authorize('admin')`: they could then call the employer approval
 * endpoint and approve any employer account, which handed that employer the right
 * to send unsolicited invitations to workers. The whole approval gate was bypassable
 * by a single unauthenticated request.
 *
 * An admin is provisioned instead, by writing the claim directly against the auth
 * account (Supabase dashboard, or the service-role API). That requires an existing
 * credential with elevated access, which is the point.
 */
export const SELF_REGISTER_ROLES = ['worker', 'employer', 'training_provider'] as const;
export type SelfRegisterRole = (typeof SELF_REGISTER_ROLES)[number];

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

export const EMPLOYER_VERIFICATION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type EmployerVerificationStatus = (typeof EMPLOYER_VERIFICATION_STATUSES)[number];

/**
 * Whether an employer account may send an unsolicited invitation.
 *
 * Separate from `EMPLOYER_VERIFICATION_STATUSES` because the gate is about
 * outbound contact with someone who has not opted in, not about verifying an
 * organisation. An unapproved employer can still search, which is read-only and
 * harms nobody.
 */
export const OFFER_SENDING_ELIGIBILITY = ['eligible', 'blocked'] as const;
export type OfferSendingEligibility = (typeof OFFER_SENDING_ELIGIBILITY)[number];

/** The worker's decision on an invitation. */
export const OFFER_RESPONSES = ['accepted', 'declined'] as const;
export type OfferResponse = (typeof OFFER_RESPONSES)[number];
