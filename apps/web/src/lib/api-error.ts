/**
 * An error the API returned, carrying its status and machine-readable code.
 *
 * Lives on its own so both the browser client (`lib/api.ts`) and the server-side
 * client (`lib/server/api.ts`) can raise and catch the same type. The message is
 * the API's own, which is written to be safe to display: the API does not forward
 * provider or database messages to callers.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

/** True when the failure is an authentication or authorization refusal. */
export function isAuthFailure(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
}