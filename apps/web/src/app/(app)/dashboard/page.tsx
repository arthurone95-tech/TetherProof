import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentProfile } from '@/lib/server/api';
import { Card } from '@/components/ui/Card';
import { LogWorkForm } from './LogWorkForm';

export const metadata: Metadata = {
  title: 'Workspace — TetherProof',
};

/**
 * The worker's home: the place a completed job is turned into proof.
 *
 * A server component throughout. Everything it shows is fetched with the caller's
 * own token on the server, so no session material is rendered into the page and
 * two workers can never see each other's data, not even in a cached response.
 *
 * The page is deliberately one job's worth of form and nothing else. Invitations
 * and account details have their own screens in the navigation, and duplicating
 * either here would give the workspace two sources of truth for them. The
 * workspace is the place a finished job becomes proof, so that is all it shows —
 * and keeping the page to the form also keeps it free of any other fetch that
 * could fail around a submission.
 */
export default async function WorkerDashboardPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  if (user.role !== 'worker') redirect(user.role === 'employer' ? '/employer' : '/pending');

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-ink-900 sm:text-3xl">Your workspace</h1>
        <p className="mt-2 max-w-2xl text-ink-600">
          Log a job you have finished with a photo or a recording of it. What you add becomes proof
          an employer can check, so describe what happened rather than what was planned.
        </p>
      </header>

      <Card title="Log completed work">
        <LogWorkForm />
      </Card>
    </div>
  );
}