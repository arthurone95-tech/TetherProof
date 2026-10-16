import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentProfile } from '@/lib/server/api';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';

export const metadata: Metadata = {
  title: 'Not available yet — TetherProof',
};

/**
 * The fallback for a signed-in account whose role has no workspace.
 *
 * Every role now has one — worker, employer, training provider, administrator — so
 * reaching this page means something has gone wrong, and the page says that rather
 * than describing a module that may or may not exist.
 *
 * Guarded on role, because this page is also the fallback `/employer` and
 * `/trainer` use for an account that is not theirs. Without the guard a worker who
 * mistyped the address, or who was bounced here from the employer workspace, was
 * told they were signed in as an administrator — a claim about their own account
 * that is both wrong and, if it had been believed, alarming. Nobody reaches a page
 * describing a role they do not hold: the roles with a real home are sent back to it.
 */
export default async function PendingPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');

  if (user.role === 'worker') redirect('/dashboard');
  if (user.role === 'employer') redirect('/employer');
  if (user.role === 'training_provider') redirect('/trainer');
  if (user.role === 'admin') redirect('/admin');

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <Card>
        <h1 className="text-2xl font-bold text-ink-900">This workspace is not ready yet</h1>
        <div className="mt-4 space-y-3 text-ink-600">
          <p>This account does not have a workspace in this app yet.</p>
        </div>

        <div className="mt-6 rounded-xl bg-brand-50 p-4">
          <Banner tone="info" title="What you can do now">
            Your account can use the same features as any other member.
          </Banner>
        </div>
      </Card>
    </div>
  );
}
