import type { UserRole } from './enums.js';

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

/**
 * Result of registering, confirming, or signing in.
 *
 * `session` is null only while the account is unconfirmed; E-007 removed the
 * need for an administrator to confirm accounts by hand.
 */
export interface AuthResponse {
  user: AuthUser;
  session: AuthSession | null;
  /** Present when the account still needs to prove ownership of its channel. */
  confirmation: ConfirmationChallenge | null;
}
