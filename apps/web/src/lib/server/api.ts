import type { ProfileResponse } from '@tetherproof/shared';
import { ApiRequestError } from '../api-error';
import { readAccessToken } from './session';

/**
 * Server-side API access for signed-in pages and server actions.
 *
 * The base URL is the same public value the browser client uses. It is not a secret,
 * and the request that matters is the bearer token, which never leaves the server.
 *
 * Requests carry `cache: 'no-store'`. Every call here reads or writes per-account
 * data, and a cached response would be served to the wrong person: Next.js caches
 * fetches by URL, and two employers asking for `/employers/specs` would otherwise
 * be able to receive each other's answer.
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

/**
 * Calls the API with the caller's own credentials.
 *
 * One retry after an expired access token. The refresh happens in
 * `readAccessToken`, so the retry picks up a freshly written token.
 */
export async function apiServer<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return send<T>(path, options, true);
}

/**
 * Calls the API without a session.
 *
 * Used for the credential endpoints, which is the whole point at which there is no
 * session yet. Anything that needs one should use `apiServer`, which makes the
 * difference explicit at each call site.
 */
export async function apiPublic<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return send<T>(path, options, false);
}

async function send<T>(path: string, options: RequestOptions, authenticated: boolean): Promise<T> {
  const { body, ...rest } = options;
  const token = authenticated ? await readAccessToken() : null;

  if (authenticated && !token) {
    throw new ApiRequestError('Please sign in to continue.', 401, 'UNAUTHENTICATED');
  }

  const response = await fetch(`${API_BASE_URL}/api/v1${path}`, {
    ...rest,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const errorBody = payload as { error?: { message?: string; code?: string } } | null;
    throw new ApiRequestError(
      errorBody?.error?.message ?? 'Something went wrong. Please try again.',
      response.status,
      errorBody?.error?.code ?? 'INTERNAL_ERROR',
    );
  }

  return payload as T;
}

/**
 * Reads the signed-in account's profile, or null when there is no usable session.
 *
 * Typed as `ProfileResponse` rather than `AuthUser` because that is what
 * `GET /auth/me` returns. It carries no email address or phone number: a page that
 * needs one to greet somebody is better off asking the API for it deliberately than
 * having every page receive the account's contact details by default.
 */
export async function currentProfile(): Promise<ProfileResponse | null> {
  try {
    return await apiServer<ProfileResponse>('/auth/me');
  } catch (error) {
    // A missing session is the ordinary case for a signed-out visitor and is not a
    // failure worth reporting. Anything else is a genuine problem, so it is not
    // swallowed here.
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}