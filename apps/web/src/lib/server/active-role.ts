import { cookies } from 'next/headers';
import type { UserCapability } from '@tetherproof/shared';
// Relative, not the @/ alias: this file is imported by a unit test, and the alias is not
// resolved for every path in the vitest config. Two spellings of one module is worse.
import { WORKSPACES } from '../navigation';

/**
 * Which role the person is currently working in.
 *
 * ## The problem this solves
 *
 * Until this existed, the active role was worked out from the URL alone. That is correct
 * while you are *inside* a workspace and useless everywhere else: `/profile`, `/settings`,
 * `/roles` and `/notifications` belong to no workspace, so nothing could be marked active
 * and the header either showed the wrong role or gave up. It also meant the choice could
 * not survive a refresh, because the URL was the only record of it.
 *
 * ## What is stored, and what is not
 *
 * A cookie, not a column. Which role somebody is looking at is a **preference about this
 * session**, not a fact about the account: two people sharing a browser should not fight
 * over it, and signing out should clear it. It is `httpOnly`, so a script cannot write it
 * to escalate anything.
 *
 * ## The cookie is never trusted
 *
 * It is re-validated against the capability set on every read, which is read fresh from the
 * database. A cookie naming `employer` for an account that no longer holds it is discarded
 * and a role the account *does* hold is used instead. So a hand-edited or stale cookie can
 * at worst change which of your own workspaces opens first — it cannot grant a capability,
 * and it cannot reach another account's data. Authorisation is unchanged either way: this
 * only decides what to *draw*.
 */
const ROLE_COOKIE = 'tp_role';

const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Every capability, in the order an account with several should be offered them. */
const ORDER: UserCapability[] = ['worker', 'employer', 'training_provider', 'trainee'];

export function isUserCapability(value: unknown): value is UserCapability {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(WORKSPACES, value);
}

/** The role the cookie names, if it names one. Not yet checked against the account. */
export async function readStoredRole(): Promise<UserCapability | null> {
  const raw = (await cookies()).get(ROLE_COOKIE)?.value;
  return isUserCapability(raw) ? raw : null;
}

/** Records the role the person chose. Called from the role selector. */
export async function writeStoredRole(role: UserCapability): Promise<void> {
  (await cookies()).set(ROLE_COOKIE, role, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Forgets it, so signing out does not leave the next person in someone's workspace. */
export async function clearStoredRole(): Promise<void> {
  (await cookies()).set(ROLE_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

/**
 * Which workspace an address belongs to, if any.
 *
 * Longest prefix wins, so `/employer/search` reads as Hiring rather than nothing. Returns
 * `null` for a page that is not a workspace home — `/profile`, `/settings`, `/notifications`
 * and the setup pages — which is exactly what makes "no role active here" expressible
 * instead of being papered over with a guess.
 */
export function workspaceForPath(pathname: string): UserCapability | null {
  let best: { id: UserCapability; length: number } | null = null;

  for (const id of ORDER) {
    const href = WORKSPACES[id].href;
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      // `training_provider` is `/trainer` and `trainee` is `/credentials`; the prefix test
      // above is what keeps `/credentials/anything` from reading as something else.
      if (!best || href.length > best.length) best = { id, length: href.length };
    }
  }

  return best?.id ?? null;
}

/**
 * The role to treat as active, resolved once on the server.
 *
 * The order is deliberate and it is the whole design:
 *
 * 1. **The address wins when it names a workspace.** Tapping a link, following a
 *    notification or pasting a URL must land you where it says, and must not be overruled
 *    by a remembered preference.
 * 2. **Otherwise the remembered role**, so a refresh on `/settings`, or signing back in,
 *    still opens you where you left off.
 * 3. **Otherwise the first capability held**, which is a sensible opening position for an
 *    account that has never chosen.
 *
 * At every step the candidate must be one the account actually holds, so an unreachable or
 * revoked role silently falls through to one that works rather than producing a broken
 * header.
 */
export function resolveActiveRole(input: {
  pathname: string;
  capabilities: readonly UserCapability[];
  stored: UserCapability | null;
}): UserCapability | null {
  const { pathname, capabilities, stored } = input;
  if (capabilities.length === 0) return null;

  const fromPath = workspaceForPath(pathname);
  if (fromPath && capabilities.includes(fromPath)) return fromPath;

  if (stored && capabilities.includes(stored)) return stored;

  const firstHeld = ORDER.find((id) => capabilities.includes(id));
  return firstHeld ?? null;
}