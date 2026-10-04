import type { ErrorCode } from '@tetherproof/shared';
import { ERROR_CODES } from '@tetherproof/shared';

/**
 * Application error carrying a safe, client-facing message.
 *
 * Anything thrown that is not an AppError is treated as an unexpected fault
 * and reported to the client as a generic INTERNAL_ERROR so that stack traces
 * and database details never reach the network.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(options: {
    code: ErrorCode;
    message: string;
    status: number;
    details?: unknown;
    expose?: boolean;
  }) {
    super(options.message);
    this.name = 'AppError';
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
    this.expose = options.expose ?? options.status < 500;
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message,
      status: 400,
      details,
    });
  }

  static unauthorized(message = 'Authentication is required.'): AppError {
    return new AppError({ code: ERROR_CODES.UNAUTHORIZED, message, status: 401 });
  }

  static forbidden(message = 'You do not have permission to perform this action.'): AppError {
    return new AppError({ code: ERROR_CODES.FORBIDDEN, message, status: 403 });
  }

  static notFound(message = 'The requested resource was not found.'): AppError {
    return new AppError({ code: ERROR_CODES.NOT_FOUND, message, status: 404 });
  }

  static conflict(message: string): AppError {
    return new AppError({ code: ERROR_CODES.CONFLICT, message, status: 409 });
  }

  static internal(message = 'An unexpected error occurred. Please try again.'): AppError {
    return new AppError({ code: ERROR_CODES.INTERNAL_ERROR, message, status: 500, expose: true });
  }

  /**
   * Builds an error with a specific contract code and status.
   *
   * Used where the meaning matters to a client branching on `code`, such as a
   * rejected one-time sign-in code, which is neither a schema problem nor an
   * authentication failure of an existing session.
   */
  static coded(code: ErrorCode, message: string, status: number): AppError {
    return new AppError({ code, message, status });
  }
}
