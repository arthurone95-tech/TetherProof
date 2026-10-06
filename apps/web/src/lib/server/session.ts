import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { AuthSession } from '@tetherproof/shared';

/**
 * The signed-in session, held in an httpOnly cookie.
 *
 * The token is never sent to the browser. Everything that needs a session runs on
 * the server: server components read it here, and server actions call the API with
 * it. The browser only ever sees rendered HTML and the results of its own actions,
 * so an injected script cannot read the credential, which is the one thing a token
 * in `localStorage` cannot offer.
 *
 * `httpOnly` and `sameSite: 'lax'` are both load-bearing. `lax` keeps the cookie
 * off cross-site form posts, so another site cannot drive a state-changing action
 * as the signed-in user. `secure` is on in production only, because a plain-HTTP
 * local development server would otherwise refuse to store the cookie at all.
 */
const SESSION_COOKIE = 'tp_session';

/** Refresh a little before expiry so a request cannot race the clock. */
const EXPIRY_MARGIN_SECONDS = 60;

const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  /** Absolute expiry as a Unix timestamp in milliseconds. */
  expiresAt: number;
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StoredSession>;
  return (
    typeof candidate.accessToken === 'string' &&
    typeof candidate.refreshToken === 'string' &&
    typeof candidate.expiresAt === 'number'
  );
}

/**
 * Stores the session cookie.
 *
 * Returns false when the cookie could not be written, which happens whenever the
 * caller is a Server Component rather than a Server Action or Route Handler: Next
 * only permits `cookies().set()` in those two contexts. That is not a reason to fail
 * the request. A refreshed token is still good for the current render, so the caller
 * can carry on and the next write, from an action, will persist it. Failing loudly
 * here would take down a page that could otherwise render perfectly.
 */
export async function writeSession(session: AuthSession): Promise<boolean> {
  const stored: StoredSession = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    // `expiresIn` is measured from now. Treat a missing or nonsensical value as
    // already expired rather than as valid, so a malformed response cannot produce
    // a cookie the browser will keep sending after the token is worthless.
    expiresAt: Date.now() + Math.max(0, session.expiresIn - EXPIRY_MARGIN_SECONDS) * 1000,
  };

  try {
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, JSON.stringify(stored), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: MAX_AGE_SECONDS,
    });
    return true;
  } catch {
    return false;
  }
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

/**
 * Returns a usable access token, refreshing it first if it has expired.
 *
 * Returns null when there is no session at all, or when the refresh fails, which
 * covers a revoked account and a rotated-away refresh token. A failed refresh means
 * the session cannot be recovered, so the caller must treat it as signed out rather
 * than loop.
 *
 * Uses a plain Supabase client on the public anon key, never the service-role key.
 * Refreshing a session needs no elevated privilege, and reaching for a privileged
 * credential here would put it in the web process for no reason.
 *
 * Best-effort with respect to persisting the renewed token. This runs during renders,
 * where Next forbids writing cookies, so the fresh token is used for the request in
 * hand and the renewal is written by the next action. Renewing once per render after
 * an hour of use is a small cost; making a render fail over it would be a large one.
 */
export async function readAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    // A cookie we cannot read is not a session. Nothing to migrate or warn about.
    return null;
  }
  if (!isStoredSession(stored)) return null;

  if (stored.expiresAt > Date.now()) return stored.accessToken;

  const refreshed = await refreshSession(stored.refreshToken);
  if (!refreshed) return null;
  await writeSession(refreshed);
  return refreshed.accessToken;
}

/**
 * Exchanges a refresh token for a fresh session, or returns null when Supabase
 * refuses it.
 *
 * Exported for the confirmation-link callback, which receives a refresh token
 * inside the link and must have Supabase validate it before the application
 * treats anybody as signed in. The validation is the point: a token the client
 * merely asserts is worthless, and GoTrue's answer is what makes it real.
 *
 * A refusal here is an ordinary outcome — an expired, rotated, or replayed token
 * — not a fault, so the caller reports it as something the person can act on
 * rather than as an error.
 */
export async function refreshSession(refreshToken: string): Promise<AuthSession | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });

  const session = data?.session;
  if (error || !session) return null;

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in ?? 3600,
  };
}