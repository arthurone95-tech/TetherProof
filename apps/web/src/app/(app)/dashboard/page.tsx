import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReceivedOffersResponse } from '@tetherproof/shared';
import { apiServer, currentProfile } from '@/lib/server/api';
import { Card } from '@/components/ui/Card';
import { ROLE_LABEL } from '@/lib/navigation';
import { LogWorkForm } from './LogWorkForm';

export const metadata: Metadata = {
  title: 'Workspace — TetherProof',
};

/**
 * The worker's home: the place a completed job is turned into proof.
 *
 * A server component throughout. Everything it shows is fetched with the caller's
 * own token on the server, so no session material is rendered into the page and
 * two workers can never see each other's invitations, not even in a cached
 * response.
 *
 * The page leads with the log form rather than with a summary, because logging is
 * the one thing a worker came here to do. The cards below it are real numbers
 * from the API — an invitation count and the state of the account — rather than
 * invented totals: there is no endpoint that lists a worker's own proofs, so
 * showing a count of them here would be a number nobody could account for.
 */
export default async function WorkerDashboardPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  if (user.role !== 'worker') redirect(user.role === 'employer' ? '/employer' : '/pending');

  const inbox = await apiServer<ReceivedOffersResponse>('/invites/offers');

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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Waiting for you">
          {inbox.pendingCount > 0 ? (
            <>
              <p className="text-ink-600">
                {inbox.pendingCount} employer invitation{inbox.pendingCount === 1 ? '' : 's'}{' '}
                {inbox.pendingCount === 1 ? 'is' : 'are'} waiting for your answer.
              </p>
              <Link
                href="/invites"
                className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-brand-600 px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50"
              >
                Open your invitations
              </Link>
            </>
          ) : (
            <p className="rounded-xl bg-brand-50 p-4 text-sm text-ink-600">
              Nothing is waiting for you. Employers can only reach you once you have verified proof
              of work, so keep logging completed jobs.
              <Link
                href="/invites"
                className="mt-3 block font-semibold text-brand-700 hover:text-brand-800"
              >
                Open your invitations
              </Link>
            </p>
          )}
        </Card>

        <Card title="Your account">
          <dl className="space-y-3 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-600">Signed in as</dt>
              <dd className="text-right font-medium text-ink-900">
                {user.fullName ?? ROLE_LABEL[user.role]}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-600">Location</dt>
              <dd className="text-right font-medium text-ink-900">
                {user.locationGps ? 'Set' : 'Not shared'}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-ink-600">
            {user.locationGps
              ? 'Employers searching by distance measure from it.'
              : 'Without it you are not filtered out by distance, and nothing is measured from your position.'}
          </p>
          <Link
            href="/profile"
            className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-brand-600 px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            Edit your profile
          </Link>
        </Card>
      </div>
    </div>
  );
}
