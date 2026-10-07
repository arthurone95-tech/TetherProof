import type { EmployerVerificationStatus, UserRole } from './enums.js';

/**
 * Error codes returned by the TetherProof API.
 *
 * Clients may branch on `code`; `message` is intended for display and must
 * never contain stack traces, SQL, or third-party service details.
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  VERIFICATION_TOKEN_INVALID: 'VERIFICATION_TOKEN_INVALID',
  VERIFICATION_TOKEN_EXPIRED: 'VERIFICATION_TOKEN_EXPIRED',
  VERIFICATION_TOKEN_CONSUMED: 'VERIFICATION_TOKEN_CONSUMED',
  /** A one-time sign-in code was absent, malformed, wrong, or already used. */
  AUTH_CODE_INVALID: 'AUTH_CODE_INVALID',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** A dependency the API depends on did not answer; the API itself is up. */
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    status: number;
    details?: unknown;
  };
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  product: string;
  database: 'up' | 'down';
  timestamp: string;
}

/** Public shape of the signed-in account. Never carries secrets. */
export interface AuthUser {
  id: string;
  role: UserRole;
  email: string | null;
  phone: string | null;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Returned by registration and by `POST /auth/confirm/request`.
 *
 * `delivered` is false when the messaging provider rejected the send. The
 * account still exists and the caller can retry, so a provider outage never
 * fails registration and never blocks a real member from signing up.
 */
export interface ConfirmationChallenge {
  /** Channel the code was sent to, derived from what the account holds. */
  channel: 'email' | 'phone';
  /** Masked destination such as `a***@example.com`. Never the full value. */
  destination: string;
  /** True when the provider accepted the message on this request. */
  delivered: boolean;
}

// ---------------------------------------------------------------------------
// Employer discovery and matching (Phase 4)
// ---------------------------------------------------------------------------

/** A hiring filter as the employer sees it. Nothing worker-specific. */
export interface CapabilitySpec {
  id: string;
  requiredSkill: string;
  minProofThreshold: number;
  maxDistanceKm: number;
  isActive: boolean;
  createdAt: string;
}

/**
 * One candidate card, as a masked result.
 *
 * There is no worker id, name, email, phone, avatar, or coordinate in this shape.
 * `candidateHandle` is the only way to act on the card, and the server resolves
 * it solely for the employer that search was run for.
 */
export interface CandidateCard {
  /** Opaque, employer-scoped, expiring. Not derivable from the worker. */
  candidateHandle: string;
  skillTag: string;
  /** Count of proofs for this skill confirmed by a client. Never includes blocked ones. */
  verifiedProofs: number;
  /**
   * Mean fraud score of the verifications backing those proofs, where 1 is fully
   * supported. Null when nothing has been scored, which is not the same as zero.
   */
  trustScore: number | null;
  lastVerifiedAt: string | null;
  /**
   * Straight-line distance from the spec's reference point in kilometres, or null
   * when the worker has not shared a location. Null is not disqualifying: a
   * missing location is an absence of evidence, and excluding those workers would
   * hide most of a network that has not opted into geolocation.
   */
  distanceKm: number | null;
}

/** The sender's view of an invitation. Safe to show before the worker answers. */
export interface SentOffer {
  id: string;
  workerId: string;
  specId: string | null;
  note: string | null;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  respondedAt: string | null;
}

/**
 * The recipient's view of an invitation.
 *
 * The employer is reduced to `employerOrganization` plus an approval marker. A
 * worker cannot meaningfully decide whether to talk to someone without knowing
 * who is offering, but nothing else about the account is disclosed: not the
 * contact details, not the account id, not its spec history.
 *
 * `candidateRevealed` is true only once accepted, which is the condition under
 * which the employer is entitled to see who they are talking to.
 */
export interface ReceivedOffer {
  id: string;
  employerOrganization: string | null;
  employerApproved: boolean;
  note: string | null;
  status: 'pending' | 'accepted' | 'declined';
  candidateRevealed: boolean;
  createdAt: string;
  respondedAt: string | null;
}

/** Whether this employer may send invitations right now, and why not if not. */
export interface OfferSendingStatus {
  eligibility: 'eligible' | 'blocked';
  /** Only present when `eligibility` is `blocked`. Safe to show to the employer. */
  reason?: string;
}

/**
 * The employer's own approval state, from `GET /employers/approval`.
 *
 * `record` is always present, synthesised as pending when no decision has been
 * recorded, so a caller never has to distinguish "not reviewed yet" from "reviewed
 * and pending" and cannot mistake a missing row for an approval.
 *
 * It deliberately carries no reviewer identity. The employer needs to know a decision
 * was made and what it was; who made it is not theirs to see.
 */
export interface EmployerApprovalResponse {
  status: EmployerVerificationStatus;
  record: {
    status: EmployerVerificationStatus;
    note: string | null;
    reviewedAt: string | null;
  };
  sending: OfferSendingStatus;
}

export interface SpecsResponse {
  specs: CapabilitySpec[];
}

export interface SearchResponse {
  candidates: CandidateCard[];
}

export interface SentOffersResponse {
  offers: SentOffer[];
}

export interface ReceivedOffersResponse {
  offers: ReceivedOffer[];
  pendingCount: number;
}

/**
 * Result of registering, confirming, or signing in.
 *
 * `session` is null only while the account is unconfirmed; E-007 removed the
 * need for an administrator to confirm accounts by hand.
 */
/**
 * The signed-in account's own application profile, as returned by `GET /auth/me`.
 *
 * Always the caller's own row. `locationGps` is their own stored location in
 * `latitude,longitude` form and is returned so an interface can prefill the field
 * they set it with; the search API is what turns it into a distance, and it never
 * returns coordinates belonging to anyone else.
 */
export interface ProfileResponse {
  id: string;
  role: UserRole;
  fullName: string | null;
  /**
   * Always null.
   *
   * `profiles.location_city` has no writer anywhere in the codebase, so it reads
   * null for every account. It is left in the response rather than removed because
   * dropping it is a breaking contract change, but it must not be rendered as if it
   * held a place: giving a user a city name requires reverse geocoding, which is an
   * open decision, and inventing one from a coordinate would be a guess presented as
   * fact. Logged as E-024.
   */
  locationCity: string | null;
  /** The caller's own stored location. Null when they have not shared one. */
  locationGps: string | null;
  organizationName: string | null;
  avatarUrl: string | null;
}

/**
 * What a completed account deletion actually achieved.
 *
 * Reports counts rather than a bare success, because "deleted" would otherwise
 * assert two things: that the account is gone, and that nothing identifying
 * remains. The second is not something the database can guarantee on its own —
 * stored objects can only be removed through the Storage API — so it is measured
 * and returned instead of assumed.
 *
 * `mediaPending` above zero means some files are still in the bucket and have been
 * left in an auditable queue rather than forgotten. It is not a partial success to
 * be retried blindly; it is a backlog to drain.
 */
export interface AccountDeletionResult {
  /** Stored objects confirmed removed from the bucket. */
  mediaRemoved: number;
  /** Objects still awaiting removal, recorded for follow-up. */
  mediaPending: number;
}

export interface AuthResponse {
  user: AuthUser;
  session: AuthSession | null;
  /** Present when the account still needs to prove ownership of its channel. */
  confirmation: ConfirmationChallenge | null;
}
