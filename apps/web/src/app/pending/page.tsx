import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { signOut } from '@/lib/actions';
import { currentProfile } from '@/lib/server/api';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { SubmitButton } from '@/components/ui/SubmitButton';

export const metadata: Metadata = {
  title: 'Not available yet — TetherProof',
};

/**
 * Where the training provider and admin roles land.
 *
 * Those modules are not built, so this says so rather than showing an empty screen
 * that looks broken. The Training Provider module is still on the plan; the admin
 * console is not, because approvals are currently recorded through the API.
 */
export default async function PendingPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');

  const isTrainingProvider = user.role === 'training_provider';

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Card>
        <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">TetherProof</p>
        <h1 className="mt-2 text-2xl font-bold text-ink-900">
          {isTrainingProvider ? 'Training provider tools are not ready yet' : 'Administration is not in this app'}
        </h1>
        <div className="mt-4 space-y-3 text-ink-600">
          {isTrainingProvider ? (
            <p>
              You are signed in as a training provider. Signing off practical milestones and seeing which
              skills the market needs are planned, but there is nothing working here yet, so this page is
              the honest answer rather than an empty dashboard.
            </p>
          ) : (
            <p>
              You are signed in as an administrator. Employer approvals are recorded through the API for
              now. There is no admin console in this app yet.
            </p>
          )}
        </div>

        <div className="mt-6 rounded-xl bg-brand-50 p-4">
          <Banner tone="info" title="What you can do now">
            {isTrainingProvider
              ? 'Workers can log completed work and build verified proof. That proof is what employers search on.'
              : 'Your account can use the same features as any other member: log work, and answer invitations.'}
          </Banner>
        </div>

        <div className="mt-6">
          <form action={signOut}>
            <SubmitButton variant="secondary" className="sm:w-auto">
              Sign out
            </SubmitButton>
          </form>
        </div>
      </Card>
    </main>
  );
}