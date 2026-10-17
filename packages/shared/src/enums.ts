/**
 * Canonical role and status values for TetherProof.
 *
 * These are duplicated as PostgreSQL enum types in `apps/api/src/db/schema`.
 * Keep both sides in sync when adding a value.
 */

export const USER_ROLES = ['worker', 'employer', 'training_provider', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * What an account is authorised to do. Migration `0012`.
 *
 * This is the set that replaced a single `role` column. Kojo the electrician, a student
 * at an institute, and the owner of a business that hires is one person holding three of
 * these — not three accounts, and certainly not three portfolios that could never be
 * joined into one.
 *
 * `admin` is deliberately absent and cannot be added here. It is a platform role rather
 * than something a person does, it is read from the server-controlled `app_metadata.role`
 * claim, and it has never been self-assignable: the registration endpoint writing that
 * claim server-side while honouring a self-declared `admin` let anyone create an account
 * satisfying `authorize('admin')`, approve any employer, and hand that employer the right
 * to message workers. See `doc/13` E-024.
 */
export const USER_CAPABILITIES = ['worker', 'employer', 'training_provider', 'trainee'] as const;
export type UserCapability = (typeof USER_CAPABILITIES)[number];

/**
 * Roles an account may choose for itself when registering.
 *
 * **Empty by design.** Registration no longer asks a new account to pick a job title: it
 * creates one personal identity, and the person activates the capabilities they want from
 * their dashboard afterwards. A signup that asked for a role is the same first-fork problem
 * this change exists to remove, because whichever role was picked first would be the one
 * the account had and the rest would need a second account.
 *
 * Kept as an exported name rather than deleted because the historical migrations
 * (`0001`, `0002`) reference it and a future reader will look for it.
 *
 * `admin` was never in it, and now nothing self-declares anything at all.
 */
export const SELF_REGISTER_ROLES = [] as readonly [];
export type SelfRegisterRole = UserCapability;

export const METADATA_STATUSES = ['pending', 'valid', 'flagged_ai_fake'] as const;
export type MetadataStatus = (typeof METADATA_STATUSES)[number];

/**
 * The states a work record can be in.
 *
 * `flagged` is deliberately distinct from `fraud_blocked`. "Something about this
 * did not add up" and "this was fraud" are different claims with very different
 * consequences for the worker named on the record, and collapsing them is how a
 * heuristic becomes an accusation. Both withhold the record from counting as
 * proof; only one of them is a judgement about the person, and that judgement is
 * only ever made by a human.
 */
export const VERIFICATION_STATUSES = [
  'pending',
  'verified',
  'rejected',
  'flagged',
  'fraud_blocked',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * The appeal lifecycle for a withheld record.
 *
 * `upheld` and `overturned` are terminal and are both recorded rather than
 * inferred, because "an admin agreed with this" and "nobody has looked at this
 * yet" must never be indistinguishable on a worker's record.
 */
export const PROOF_REVIEW_STATUSES = [
  'none',
  'appealed',
  'under_review',
  'upheld',
  'overturned',
] as const;
export type ProofReviewStatus = (typeof PROOF_REVIEW_STATUSES)[number];

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
 * The lifecycle of an instructor-issued micro-credential.
 *
 * A credential is *dual-backed* (`doc/02` §5.1): the institute signs off, and the
 * student accepts it onto their own record. Both halves are required, which is why
 * there is no state meaning "issued and final" — signing off only produces
 * `awaiting_student`, and only the student can move it out of that state.
 *
 * This is the same shape as every other proof on the platform, where a worker's own
 * claim is never sufficient on its own. It is also what stops an institute from
 * manufacturing capability: a bootcamp that could write straight to a student's
 * graph would make its own graduates the most credentialed people on the network,
 * and the value of the credential would be exactly what the endorsement is worth.
 *
 * ## What `accepted` does and does not mean
 *
 * It means the student agreed to hold this credential. It does **not** mean the
 * skill was independently verified, and the vocabulary is chosen so it cannot be
 * read that way: there is deliberately no `verified` value, and the student's
 * client-verified proof total is computed from `work_proof_logs` and is never
 * touched by a credential.
 *
 * The distinction is the whole point. A bootcamp that issued to a hundred students
 * would otherwise appear to have produced a hundred people whose skills were
 * proven by real customers, when none of them may have worked for one. An
 * institutional endorsement and a customer confirmation are different kinds of
 * evidence and must never be summed together — see `DemandSkillRow` for the same
 * rule applied to the demand side.
 *
 * `declined` is stored rather than deleted so that "the student refused this" is
 * never indistinguishable from "this was never offered", and so an institute cannot
 * quietly re-approach somebody by issuing a slightly different milestone.
 */
export const MICRO_CREDENTIAL_STATUSES = ['awaiting_student', 'accepted', 'declined'] as const;
export type MicroCredentialStatus = (typeof MICRO_CREDENTIAL_STATUSES)[number];

/**
 * The two answers a student may give to an issued credential.
 *
 * Named for what they are: a decision about whether to hold the credential. Not
 * `confirm`/`verify`, which would read as the student vouching for the skill
 * itself — a claim they are in no position to make and that nobody asked them for.
 */
export const CREDENTIAL_RESPONSES = ['accepted', 'declined'] as const;
export type CredentialResponse = (typeof CREDENTIAL_RESPONSES)[number];

/**
 * The kinds of events a member's notification feed can hold.
 *
 * `offer_received` belongs to the worker whose invitation arrived;
 * `offer_accepted` and `offer_declined` belong to the employer whose invitation
 * was answered. `credential_issued` belongs to the student an institute has signed
 * off on, and is the only route by which they learn it is waiting for their answer.
 * `link_expiring` is synthesized at read time from the worker's own
 * outstanding verification links rather than written as rows, because expiry is a
 * moving target; the rest are written when the event actually happens.
 */
export const NOTIFICATION_KINDS = [
  'offer_received',
  'offer_accepted',
  'offer_declined',
  'verification_confirmed',
  'verification_rejected',
  'credential_issued',
  'link_expired',
  'link_expiring',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Telemetry sources a worker may connect, and the statuses a connection can be in. */
export const CONNECTION_PROVIDERS = ['github'] as const;
export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number];
export const CONNECTION_STATUSES = ['connected', 'revoked'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
