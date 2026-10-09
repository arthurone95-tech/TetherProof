import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from './errors.js';

/**
 * GitHub OAuth scaffold for the telemetry connector.
 *
 * This is deliberately the smallest thing that is still real: a start endpoint
 * hands out a scoped authorize URL, the callback exchanges the code for the
 * provider's user name, and a connection row is recorded. The OAuth access token
 * is used exactly once, at exchange, to read the user name — it is never stored
 * and never used again, because persisting credentials is a storage decision
 * with its own security review (see the connections module). Event ingestion
 * that turns commits into proofs belongs to a later phase and will need that
 * decision; this phase records the fact that a connection exists.
 *
 * Without a client id and secret the connector is unavailable and says so
 * plainly. A silent dead button would be worse than an honest one.
 */
export function githubConfigured(): boolean {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.WEB_BASE_URL);
}

export function githubAuthorizeUrl(state: string): string {
  if (!githubConfigured()) {
    throw AppError.serviceUnavailable(
      'GitHub connection is not configured on this deployment yet.',
    );
  }

  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    // `read:user` is the minimum scope that returns the profile: the user name
    // the connection card needs. No repo scopes, because nothing in this phase
    // reads or writes repositories.
    scope: 'read:user',
    state,
    redirect_uri: githubCallbackUrl(),
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/** The address GitHub must return the browser to, through the web origin. */
export function githubCallbackUrl(): string {
  return `${env.WEB_BASE_URL.replace(/\/$/, '')}/api/v1/workers/connections/github/callback`;
}

/**
 * Signs and binds an OAuth state to its caller.
 *
 * The state prevents both the classic login-CSRF and the worse failure this
 * flow specifically invites: a callback that trusted the `state` echo blindly
 * would let one worker attach a *different* worker's connection by replaying it.
 * So the state is not a random cookie — it is the caller's own id, the nonce,
 * and an issued-at stamp, bound by an HMAC. Only the API knows the secret (it is
 * derived from the verifier-phone salt, or a per-process value in development),
 * so only the API can mint a state that verifies.
 */
const STATE_TTL_SECONDS = 10 * 60;

function oauthStateSecret(): string {
  return env.VERIFIER_PHONE_SALT || 'dev-only-oauth-state-secret';
}

export function buildOAuthState(userId: string): string {
  const nonce = createHmac('sha256', oauthStateSecret())
    .update(`${userId}:${Date.now()}`)
    .digest('base64url')
    .slice(0, 16);
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${userId}.${nonce}.${issuedAt}`;
  const signature = signState(payload);
  return `${payload}.${signature}`;
}

export function verifyOAuthState(state: string): string | null {
  const parts = state.split('.');
  if (parts.length !== 4) return null;

  // The length check above guarantees the four segments exist; the assertions
  // keep `noUncheckedIndexedAccess` from widening them to `undefined`.
  const userId = parts[0]!;
  const nonce = parts[1]!;
  const issuedAt = parts[2]!;
  const signature = parts[3]!;
  const payload = `${userId}.${nonce}.${issuedAt}`;

  const expected = signState(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const ageSeconds = Math.floor(Date.now() / 1000) - Number(issuedAt);
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > STATE_TTL_SECONDS) {
    return null;
  }

  return userId;
}

function signState(payload: string): string {
  return createHmac('sha256', oauthStateSecret()).update(payload).digest('base64url');
}

export interface GitHubEndorsement {
  accessToken: string;
  username: string;
}

/**
 * Exchanges the one-time code for the connected user's profile name.
 *
 * The token is returned to the caller because it is needed to read the profile;
 * that is its only use, and the caller decides whether to keep it (this
 * scaffold does not).
 */
export async function exchangeGithubCode(code: string): Promise<GitHubEndorsement> {
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: githubCallbackUrl(),
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!tokenResponse.ok) {
    throw AppError.badRequest('GitHub did not accept that connection code. Try connecting again.');
  }
  const token = (await tokenResponse.json()) as { access_token?: string; error?: string };
  if (!token.access_token) {
    throw AppError.badRequest('GitHub did not accept that connection code. Try connecting again.');
  }

  const profileResponse = await fetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${token.access_token}`, accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!profileResponse.ok) {
    throw AppError.serviceUnavailable('GitHub accepted the code but could not identify the account.');
  }
  const profile = (await profileResponse.json()) as { login?: string };
  if (!profile.login) {
    throw AppError.serviceUnavailable('GitHub accepted the code but could not identify the account.');
  }

  return { accessToken: token.access_token, username: profile.login };
}