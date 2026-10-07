import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentProfile } from '@/lib/server/api';
import { Card } from '@/components/ui/Card';
import { LogWorkForm } from './LogWorkForm';

export const metadata: Metadata = {
  title: 'Workspace — TetherProof',
};

/**
 * The worker's log form, on its own tab.
 *
 * With the dashboard now showing the overview and the logbook listing past
 * work, the form is the one task this page exists for: turning a finished job
 * into proof. Keeping it alone — no metrics, no recent list, no invites —
 * means nothing on the screen can compete with the job at hand, and a failure
 * anywhere else on the page cannot take a submission down with it.
 */
export default async function WorkspacePage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  if (user.role !== 'worker') redirect(user.role === 'employer' ? '/employer' : '/pending');

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-ink-900 sm:text-3xl">Log work</h1>
        <p className="mt-2 max-w-2xl text-ink-600">
          Turn a finished job into proof with a photo or a recording. What you add becomes a log
          an employer can check, so describe what happened rather than what was planned.
        </p>
      </header>

      <Card title="Log completed work">
        <LogWorkForm />
      </Card>
    </div>
  );
}