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

/**
 * The proficiency tiers a worker attaches to a skill.
 *
 * A level is the worker's own statement of experience on the record, shown to
 * employers through the same lens as everything else: it accompanies verified
 * counts and never substitutes for them. Level 1 is entry, 2 experienced, and 3
 * advanced; the choice is stored on the capability block, not on each proof.
 */
export const SKILL_LEVELS = [1, 2, 3] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

/**
 * Which employers may send a worker an invitation.
 *
 * `all` lets any employer whose account is approved to send invitations reach
 * the worker; `approved_only` narrows that to employers whose account has been
 * reviewed and approved, which is the setting the worker opt-in offers.
 */
export const INVITATION_PREFERENCES = ['all', 'approved_only'] as const;
export type InvitationPreference = (typeof INVITATION_PREFERENCES)[number];

/**
 * The kinds of events a member's notification feed can hold.
 *
 * `offer_received` belongs to the worker whose invitation arrived;
 * `offer_accepted` and `offer_declined` belong to the employer whose invitation
 * was answered. `link_expiring` is synthesized at read time from the worker's own
 * outstanding verification links rather than written as rows, because expiry is a
 * moving target; the rest are written when the event actually happens.
 */
export const NOTIFICATION_KINDS = [
  'offer_received',
  'offer_accepted',
  'offer_declined',
  'verification_confirmed',
  'verification_rejected',
  'link_expired',
  'link_expiring',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Telemetry sources a worker may connect, and the statuses a connection can be in. */
export const CONNECTION_PROVIDERS = ['github'] as const;
export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number];
export const CONNECTION_STATUSES = ['connected', 'revoked'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
