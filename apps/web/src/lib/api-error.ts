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
  /**
   * Field-level reasons the API gave, empty when it gave none.
   *
   * The API answers a validation refusal with a message that describes the request
   * rather than the mistake — `Request body failed validation.` — and puts the part
   * a person can act on in `details`, such as `Password must be at least 12
   * characters.` next to the field that failed. Dropping that, as this class used
   * to, turned every distinct mistake into the same unactionable sentence.
   */
  readonly issues: readonly ApiFieldIssue[];

  constructor(
    message: string,
    status: number,
    code: string,
    issues: readonly ApiFieldIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

/** One reason a particular field was refused. */
export interface ApiFieldIssue {
  /** Dotted path into the submitted body, such as `password`. */
  path: string;
  /** Written to be shown to the person who submitted the form. */
  message: string;
}

/**
 * Reads the API's `details` into field issues, ignoring anything malformed.
 *
 * `details` is typed `unknown` at the contract because several endpoints put other
 * shapes there, and it is read over the network, so every part is checked before
 * being trusted. An unexpected shape yields no issues rather than throwing — the
 * original error is still the one worth reporting, and a parser that throws while
 * handling a failure would replace a real message with `undefined`.
 */
export function readFieldIssues(details: unknown): ApiFieldIssue[] {
  if (!Array.isArray(details)) return [];

  const issues: ApiFieldIssue[] = [];
  for (const entry of details) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { path, message } = entry as { path?: unknown; message?: unknown };
    if (typeof path === 'string' && typeof message === 'string') {
      issues.push({ path, message });
    }
  }
  return issues;
}

/**
 * True when the failure is an authentication or authorization refusal.
 */
export function isAuthFailure(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
}

/**
 * True when the API refused the *credentials* — the password or the email did not
 * match — rather than refusing the request, the account or the session.
 *
 * The distinction decides where a form puts the message. Only this case is
 * something the person can fix by editing the password box, so only this case
 * points the error at it. Everything else — a 500, a 503, a service that could
 * not be reached — is shown at the top of the form instead, because putting
 * "we could not reach the server" under the password box tells the reader their
 * password is the problem, which is the one thing it is not.
 *
 * Narrower than `isAuthFailure`, which also covers a session that has expired on
 * an already-signed-in page.
 */
export function isCredentialRefusal(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401;
}

/**
 * The failure behind a form's "please try again" when nothing answered at all.
 *
 * Raised by both API clients when `fetch` itself rejects — nothing listening on
 * the configured address, DNS failure, connection dropped — rather than when the
 * API refused the request. Kept distinct from a refusal on purpose: a person who
 * mistyped a password and a person whose sign-in button did nothing are two
 * different problems, and only the second one should be told to wait a moment.
 * The API's own message (`Incorrect sign-in details.`) still reaches the form
 * whenever the API is the thing answering.
 *
 * The underlying cause is logged on the server, never shown: it would describe
 * infrastructure to a reader who can do nothing with it. Status 503 so it also
 * falls outside the 401/403 checks that mean "the session is bad" — an
 * unreachable API must not look like a rejected session.
 */
export function serviceUnreachable(): ApiRequestError {
  return new ApiRequestError(
    'We could not reach TetherProof just now. Please try again in a few moments.',
    503,
    'SERVICE_UNAVAILABLE',
  );
}
