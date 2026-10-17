import { redirect } from 'next/navigation';
import type { UserCapability } from '@tetherproof/shared';
import { currentProfile } from './server/api';
import { homeFor } from './navigation';

/**
 * The signed-in account, or a redirect to sign in.
 *
 * Every page starts with this, and it is the only place that decides "is anybody signed
 * in" — so a page cannot accidentally treat a missing profile as a real one.
 */
export async function requireSession() {
  const profile = await currentProfile();
  if (!profile) redirect('/login');
  return profile;
}

/**
 * The signed-in account, sent home unless it holds one of the required capabilities.
 *
 * The client-side half of the server's `requireCapability`, and deliberately only that.
 * Hiding a page is not a permission — every route re-checks on the server with the
 * capability set the database agreed to — but bouncing somebody out of a page they cannot
 * use is better than rendering an empty one, and it is the difference between "you do not
 * have access to this" and a screen full of empty lists.
 *
 * `admin` is not a capability and is not accepted here. An administrator has their own
 * console; there is no reason for them to be inside somebody's personal workspace.
 */
export async function requireCapability(...required: UserCapability[]) {
  const profile = await requireSession();
  if (!required.some((capability) => profile.capabilities.includes(capability))) {
    redirect(homeFor(profile));
  }
  return profile;
}

/**
 * The signed-in account, sent home unless it is an administrator.
 */
export async function requireAdmin() {
  const profile = await requireSession();
  if (!profile.isAdmin) {
    redirect(homeFor(profile));
  }
  return profile;
}

/**
 * The signed-in account, sent home unless it holds every one of the required
 * capabilities.
 *
 * Use this where a person needs two things at once — a worker's own proof history needs
 * `worker`, and nothing else will do. `requireCapability` is "any of", which is right for
 * a router that accepts several alternatives and wrong for a page that genuinely needs all
 * of them.
 */
export async function requireAllCapabilities(...required: UserCapability[]) {
  const profile = await requireSession();
  if (!required.every((capability) => profile.capabilities.includes(capability))) {
    redirect(homeFor(profile));
  }
  return profile;
}
