import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { homeFor } from '@/lib/navigation';
import { currentProfile } from '@/lib/server/api';

export const metadata: Metadata = {
  title: 'Not available yet — TetherProof',
};

/**
 * The fallback for a signed-in account with nowhere to go.
 *
 * Since migration `0012` this is close to unreachable, and that is the point. An account
 * with no capability lands on `/capabilities` instead, and an account with one lands on
 * that capability's workspace — so somebody only reaches this page if a capability exists
 * whose workspace somebody forgot to build, which is a gap in the code rather than a
 * state a person can be in.
 *
 * It still redirects anybody who does have somewhere to go, rather than describing a
 * module that may or may not exist. Sending a Kojo who holds worker, trainee and employer
 * here would be telling him that three things he can do are not ready, which is the
 * confusing version of this page.
 */
export default async function PendingPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');

  // Any account with somewhere to go goes there instead.
  redirect(homeFor(user));
}
