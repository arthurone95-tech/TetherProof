import type {
  ConnectionProvider,
  ConnectionStatus,
  EmployerVerificationStatus,
  InvitationPreference,
  NotificationKind,
  ProofReviewStatus,
  SkillLevel,
  UserRole,
  VerificationStatus,
} from './enums.js';

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
 * There is no worker id, email, phone, or coordinate in this shape.
 * `candidateHandle` is the only way to act on the card, and the server resolves
 * it solely for the employer that search was run for. A name and an optional
 * photo are present because the worker is `discoverable`; contact details are
 * still withheld until an invitation is accepted.
 */
export interface CandidateCard {
  /** Opaque, employer-scoped, expiring. Not derivable from the worker. */
  candidateHandle: string;
  skillTag: string;
  /**
   * The worker's name, or null when they have not set one.
   *
   * Present only because the worker is `discoverable`: that flag is the worker's
   * own statement that they may be found by an employer, and it is enforced at the
   * aggregation layer rather than here, so a card that exists at all is a card
   * whose owner agreed to be found. Nothing else identifying rides along — no id,
   * no email, no phone, no coordinates.
   */
  displayName: string | null;
  /** A photo the worker chose to upload. Null is ordinary and needs no substitute upload. */
  avatarUrl: string | null;
  /**
   * The saved-worker row for this card, or null when the employer has not saved
   * them.
   *
   * Present so a star on a search result shows what is actually stored rather
   * than resetting on every reload. It is an opaque row id used only to unsave,
   * and reveals nothing the card does not already carry.
   */
  savedId: string | null;
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

/**
 * A worker an employer has saved.
 *
 * The same shape as a search card plus `savedId` and `savedAt`, because this list
 * is the employer's own record of their own intentions rather than a live
 * ranking. `savedId` is an opaque row id used to unsave; it is not a worker id
 * and reveals nothing about the worker.
 *
 * A worker who has since become undiscoverable, deleted their account, or no
 * longer has verified proof for the skill simply does not appear here, so the
 * list cannot be used to keep reaching someone who has opted out.
 */
export interface SavedWorker extends CandidateCard {
  savedId: string;
  savedAt: string;
}

export interface SavedWorkersResponse {
  workers: SavedWorker[];
}

export interface SentOffersResponse {
  offers: SentOffer[];
}

export interface ReceivedOffersResponse {
  offers: ReceivedOffer[];
  pendingCount: number;
}

/**
 * One accepted candidate, with the contact their acceptance earned the employer
 * the right to see.
 *
 * Before acceptance the employer knows only a masked card. After it, the worker
 * has chosen to be contacted, so the name, email, and phone are exactly what the
 * reply was for. The contact fields come from Supabase Auth rather than
 * `profiles`, and are null when the provider does not hold one — an absence, not
 * a hidden value.
 */
export interface AcceptedCandidate {
  offerId: string;
  workerId: string;
  fullName: string | null;
  avatarUrl: string | null;
  /** From Supabase Auth; null when the account has no email or it could not be read. */
  email: string | null;
  /** From Supabase Auth; null when the worker never registered a number. */
  phone: string | null;
  /** The employer's own message on the invitation, kept for context. */
  note: string | null;
  acceptedAt: string | null;
}

export interface AcceptedCandidatesResponse {
  candidates: AcceptedCandidate[];
}

/** One saved search and how many candidates currently match it. */
export interface SpecMatchCount {
  specId: string;
  requiredSkill: string;
  isActive: boolean;
  /** Candidates passing the spec's proof threshold and distance, maskable only. */
  matchCount: number;
}

/**
 * The employer dashboard's headline numbers, from `GET /employers/overview`.
 *
 * Every count is derived from the caller's own rows. `matches` carries one entry
 * per saved search so the dashboard can point at the searches producing matches
 * rather than only reporting a total, and `totalMatches` is the sum across them.
 */
export interface EmployerOverviewResponse {
  /** The employer's own approval status, for the dashboard's status tile. */
  status: EmployerVerificationStatus;
  note: string | null;
  reviewedAt: string | null;
  sending: OfferSendingStatus;
  activeSearches: number;
  pausedSearches: number;
  /** Invitations sent, still unanswered. */
  pendingInvites: number;
  acceptedCandidates: number;
  declinedInvites: number;
  /** Candidates currently matching at least one active saved search. */
  totalMatches: number;
  matches: SpecMatchCount[];
}

/** One employer account in the admin approval console, from `GET /admin/employers`. */
export interface AdminEmployerListItem {
  employerId: string;
  organizationName: string | null;
  /** The name on the account holder's own profile, for recognising the applicant. */
  contactName: string | null;
  status: EmployerVerificationStatus;
  note: string | null;
  reviewedAt: string | null;
  registeredAt: string;
}

export interface AdminEmployersResponse {
  employers: AdminEmployerListItem[];
}

/**
 * One withheld work record, as a reviewer sees it.
 *
 * Everything here is already on the record or derivable from it. There is no
 * worker identity, no name, no email, and no contact handle: a reviewer is
 * deciding whether an automated integrity decision was fair, and that question is
 * answerable from the evidence and the signals alone.
 */
export interface AdminProofReviewItem {
  proofId: string;
  skillTag: string | null;
  description: string;
  /** The plain sentence the worker was shown. */
  flagReason: string | null;
  flaggedAt: string | null;
  reviewStatus: ProofReviewStatus;
  /** `flagged` until a reviewer upholds it; `fraud_blocked` once they have. */
  verificationStatus: 'flagged' | 'fraud_blocked';
  /** The engine's number, for the reviewer. Never sent to the worker. */
  fraudScore: number | null;
  /** What the client actually did. A rejection is never reviewable. */
  clientResponse: 'confirmed' | 'rejected' | null;
}

/**
 * The two decisions a reviewer may take on a withheld record.
 *
 * `upheld` is the only path to `fraud_blocked` anywhere in the system, and
 * `overturned` is the only path back to `verified`. Both are terminal.
 */
export const PROOF_REVIEW_OUTCOMES = ['upheld', 'overturned'] as const;
export type ProofReviewOutcome = (typeof PROOF_REVIEW_OUTCOMES)[number];

export interface AdminProofReviewResponse {
  items: AdminProofReviewItem[];
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
  /**
   * Privacy and sharing state for the caller's own account.
   *
   * `discoverable` controls whether the worker appears in employer search.
   * `showNameOnVerificationLink` controls whether the worker is named on the
   * customer page reached by a confirmation link — a different audience, because
   * such a link is forwardable, so one flag cannot honestly cover both.
   * `publicProfile` controls whether `/public/profiles/:slug` answers;
   * `publicSlug` is the unguessable address of that page, generated once and
   * non-empty only while the page is enabled. `invitationPreference` says which
   * employers may send invitations. Non-workers hold the role defaults: an
   * employer is not searchable or shareable through these fields, so they read
   * as the worker defaults and are ignored.
   */
  discoverable: boolean;
  showNameOnVerificationLink: boolean;
  publicProfile: boolean;
  publicSlug: string | null;
  invitationPreference: InvitationPreference;
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

// ---------------------------------------------------------------------------
// Worker proof logbook
// ---------------------------------------------------------------------------

/** The kind of media attached to a proof, for choosing how to render it. */
export type ProofMediaKind = 'image' | 'audio';

/**
 * One row of a worker's own logbook, as listed by `GET /workers/proofs` and
 * previewed on the dashboard overview.
 *
 * `mediaUrl` is a short-lived signed URL minted at read time for the caller
 * only. It is never persisted (a leaked database row cannot be turned into a
 * media link) and it expires after five minutes, so a page that stays open is
 * expected to refetch. Audio proofs get a URL too so the list can offer
 * playback; the client renders a placeholder square for the thumbnail either
 * way.
 */
export interface ProofListItem {
  id: string;
  skillTag: string;
  /** The worker's own proficiency tier for this skill, 1 (entry) to 3 (advanced). */
  skillLevel: SkillLevel;
  description: string;
  createdAt: string;
  verificationStatus: VerificationStatus;
  submissionGps: string | null;
  mediaKind: ProofMediaKind;
  mediaUrl: string;
}

export interface ProofsResponse {
  proofs: ProofListItem[];
}

/**
 * A single log entry's detail, for the logbook detail screen.
 *
 * `editable` is the freeze rule: a log can be edited only while its
 * verification is still pending AND no confirmation link is live for it. Once a
 * link is out — or the proof has been verified, rejected, or blocked — the
 * record is frozen, so an edited record can never be confirmed by a link that was
 * already handed out. A link that has simply run out stops the freeze again, so a
 * worker who spotted a mistake after the seven days can still correct it.
 *
 * The field is named for the link rather than for a delivery, because the
 * work-logging form does not collect a client's number any more: what matters is
 * whether someone can still answer, not whether a messaging provider accepted it.
 */
export interface ProofDetail extends ProofListItem {
  /** Whether the worker may change this entry right now. */
  editable: boolean;
  /** Whether a confirmation link is live and could still be answered. */
  verificationOutstanding: boolean;
  /**
   * Whether a link was issued for this entry and ran out without an answer.
   *
   * Distinct from `verificationOutstanding` because the two call for different
   * words: one is a request still open, the other is one that has lapsed and can
   * be replaced. A log that was never issued a link is neither.
   */
  verificationLinkExpired: boolean;
  /** When the outstanding single-use link stops working. Null once used/expired/concluded. */
  verificationExpiresAt: string | null;
  /**
   * When the platform withheld this record, or null if it never was.
   *
   * Set for both `flagged` and `fraud_blocked`. A worker who cannot see that a
   * record stopped counting has no way to respond to it, which is how a penalty
   * becomes indefensible.
   */
  flaggedAt: string | null;
  /**
   * A plain-language sentence naming what raised the record, safe to show the
   * worker. Never a score, a threshold, or an anti-fraud signal: those describe
   * the detector rather than helping the worker answer it.
   */
  flagReason: string | null;
  /** Where an appeal has got to. `none` means nothing has been challenged. */
  reviewStatus: ProofReviewStatus;
  reviewedAt: string | null;
  /** When an overturned block returned this record to `verified`. */
  restoredAt: string | null;
  /**
   * The words the API transcribed from a voice recording, when one was captured
   * and a transcription provider was configured. Null for photo proofs, for
   * recordings captured before transcription existed, and when no provider is
   * configured — the recording itself is always the record.
   */
  transcript: string | null;
}

export interface ProofDetailResponse {
  proof: ProofDetail;
}

/** What an existing log may change. All fields optional; at least one required. */
export interface UpdateProofInput {
  description?: string;
  skillTag?: string;
  /** The proficiency tier to attach to the skill the log belongs under. */
  skillLevel?: SkillLevel;
  /** Null explicitly clears the stored location; omitting it leaves it as is. */
  submissionGps?: string | null;
}

/**
 * The worker's standing in one skill of their own profile.
 *
 * The same aggregation the public capability profile shows, without the
 * `displayName` a public page needs. Everything is derived from the worker's own
 * verified records; nothing here is editable by choice.
 */
export interface SkillSummary {
  skillTag: string;
  skillLevel: SkillLevel;
  /** All logged work under this skill, whatever its verdict. */
  totalLogs: number;
  /** Proofs confirmed by a client and not blocked by the anti-fraud engine. */
  verifiedProofs: number;
  /** When any proof under this skill was last verified. Null if none have been. */
  lastVerifiedAt: string | null;
}

/** The caller's own capability profile, from `GET /workers/capabilities`. */
export interface WorkerCapabilityProfileResponse {
  skills: SkillSummary[];
  verifiedTotal: number;
}

/**
 * One skill on a worker's public capability profile page.
 *
 * A deliberately reduced `SkillSummary`: no descriptions, no media, no location,
 * no contact. Only the aggregate counts a stranger is entitled to see.
 */
export interface PublicSkillSummary {
  skillTag: string;
  skillLevel: SkillLevel;
  verifiedProofs: number;
  lastVerifiedAt: string | null;
}

/**
 * The public, read-only capability profile behind a worker's shareable link.
 *
 * `displayName` is the worker's stored name or null when they have not set one.
 * `skills` are ordered by verified count and carry only aggregates.
 */
export interface PublicCapabilityProfileResponse {
  displayName: string | null;
  skills: PublicSkillSummary[];
  verifiedTotal: number;
}

/** One row of a worker's notification feed. */
export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** A destination the notification points at; null when there is nowhere to go. */
  link: string | null;
  /** When the member saw it. Null while unread. */
  readAt: string | null;
  createdAt: string;
}

/**
 * The worker's notification feed from `GET /notifications`.
 *
 * `expiring` lists the worker's own outstanding confirmation links that run out
 * within the next few days, synthesized at read time so a link that crosses the
 * boundary while the page is open is never missed and never stale.
 */
export interface NotificationsResponse {
  notifications: NotificationItem[];
  unreadCount: number;
  expiring: ProofExpiryNotice[];
}

/** One of the worker's confirmation links that is about to run out. */
export interface ProofExpiryNotice {
  proofId: string;
  skillTag: string;
  expiresAt: string;
}

/** One telemetry connection on a worker's account, from `GET /workers/connections`. */
export interface ConnectionInfo {
  provider: ConnectionProvider;
  externalUsername: string | null;
  status: ConnectionStatus;
  connectedAt: string;
  lastSyncedAt: string | null;
}

export interface ConnectionsResponse {
  connections: ConnectionInfo[];
}

/**
 * The fresh confirmation link produced by `POST /workers/proofs/:id/verification/resend`.
 *
 * Same shape as the first submission's link result: the token is returned exactly
 * once and only its digest is stored, and the caller builds the shareable URL.
 */
export interface VerificationResendResponse {
  verificationToken: string;
  verificationExpiresAt: string;
  verificationLinkSent: boolean;
}

export interface ProofUpdateResponse {
  proof: ProofDetail;
}

/**
 * The numbers a worker's dashboard leads with, from `GET /workers/overview`.
 *
 * Counts are derived from the caller's own rows only. `recent` is the latest
 * few entries with thumbnails, so the landing page shows the record rather
 * than only a row of numbers.
 */
export interface WorkerOverviewResponse {
  totalLogs: number;
  verifiedLogs: number;
  awaitingVerificationLogs: number;
  pendingInvitations: number;
  recent: ProofListItem[];
}
