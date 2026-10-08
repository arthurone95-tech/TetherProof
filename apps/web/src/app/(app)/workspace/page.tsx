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
      {/* The header carries the section's name; the form's own card titles it. */}
      <Card title="Log completed work">
        <LogWorkForm />
      </Card>
    </div>
  );
}