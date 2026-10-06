import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { homeFor } from '@/lib/navigation';
import { currentProfile } from '@/lib/server/api';
import { LoginView } from './LoginView';

export const metadata: Metadata = {
  title: 'Sign in — TetherProof',
};

/**
 * The sign-in page.
 *
 * Redirects away when a session is already present, so a signed-in employer who
 * follows a stale bookmarked link does not have to sign in twice. The check reads
 * the httpOnly cookie, which means no token is rendered into the page.
 */
export default async function LoginPage() {
  const user = await currentProfile();

  if (user) {
    redirect(homeFor(user.role));
  }

  return <LoginView />;
}