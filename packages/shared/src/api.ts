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
