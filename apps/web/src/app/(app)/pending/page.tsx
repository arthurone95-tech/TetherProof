import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentProfile } from '@/lib/server/api';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';

export const metadata: Metadata = {
  title: 'Not available yet — TetherProof',
};

/**
 * Where the training provider role lands.
 *
 * Its module is not built, so this says so rather than showing an empty screen
 * that looks broken. The admin console now exists, and a worker and employer both
 * have a real home.
 *
 * Guarded on role, because this page is also the fallback `/employer` uses for a
 * non-employer. Without the guard a worker who mistyped the address, or who was
 * bounced here from the employer workspace, was told they were signed in as an
 * administrator — a claim about their own account that is both wrong and, if it
 * had been believed, alarming. Nobody reaches a page describing a role they do
 * not hold: the three roles with a real home are sent back to it.
 */
export default async function PendingPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');

  if (user.role === 'worker') redirect('/dashboard');
  if (user.role === 'employer') redirect('/employer');
  if (user.role === 'admin') redirect('/admin');

  const isTrainingProvider = user.role === 'training_provider';

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <Card>
        <h1 className="text-2xl font-bold text-ink-900">
          {isTrainingProvider ? 'Training provider tools are not ready yet' : 'This workspace is not ready yet'}
        </h1>
        <div className="mt-4 space-y-3 text-ink-600">
          {isTrainingProvider ? (
            <p>
              You are signed in as a training provider. Signing off practical milestones and seeing which
              skills the market needs are planned, but there is nothing working here yet, so this page is
              the honest answer rather than an empty dashboard.
            </p>
          ) : (
            <p>This account does not have a workspace in this app yet.</p>
          )}
        </div>

        <div className="mt-6 rounded-xl bg-brand-50 p-4">
          <Banner tone="info" title="What you can do now">
            {isTrainingProvider
              ? 'Workers can log completed work and build verified proof. That proof is what employers search on.'
              : 'Your account can use the same features as any other member.'}
          </Banner>
        </div>
      </Card>
    </div>
  );
}