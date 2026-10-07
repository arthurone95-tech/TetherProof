import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { WorkerOverviewResponse } from '@tetherproof/shared';
import { ProofListItemView } from '@/components/proofs/ProofListItemView';
import { apiServer, currentProfile } from '@/lib/server/api';

export const metadata: Metadata = {
  title: 'Dashboard — TetherProof',
};

/**
 * The worker's landing page: what is on the record and what is waiting.
 *
 * The numbers come from the worker's own rows only — their logs, their
 * verifications, their invitations — fetched with their own token on the
 * server, so no session material is rendered into the page and two workers can
 * never see each other's totals.
 *
 * If the numbers cannot be fetched the page does not fall over: the way into
 * every screen still works, and the recent list simply does not appear. That
 * trades a loading failure for a slightly emptier landing page, which is the
 * right trade for the place a worker arrives at most.
 */
export default async function WorkerDashboardPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  if (user.role !== 'worker') redirect(user.role === 'employer' ? '/employer' : '/pending');

  let overview: WorkerOverviewResponse | null = null;
  try {
    overview = await apiServer<WorkerOverviewResponse>('/workers/overview');
  } catch {
    overview = null;
  }

  const metrics = overview
    ? [
        { label: 'Logged works', value: overview.totalLogs },
        { label: 'Verified', value: overview.verifiedLogs },
        { label: 'Awaiting confirmation', value: overview.awaitingVerificationLogs },
        { label: 'Invitations', value: overview.pendingInvitations },
      ]
    : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink-900 sm:text-3xl">Your dashboard</h1>
          <p className="mt-2 max-w-2xl text-ink-600">
            See what is on your record, what is waiting on somebody else, and where to go next.
          </p>
        </div>
        <Link
          href="/workspace"
          className="inline-flex min-h-12 items-center rounded-xl bg-brand-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
        >
          Log a job
        </Link>
      </header>

      {metrics ? (
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {metrics.map((metric) => (
            <li
              key={metric.label}
              className="rounded-2xl border border-brand-100 bg-white p-4 shadow-sm"
            >
              <p className="text-3xl font-bold text-ink-900 tabular-nums">{metric.value}</p>
              <p className="mt-1 text-sm text-ink-600">{metric.label}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-600">
          Your numbers could not be loaded right now. The rest of the page still works.
        </p>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink-900">Recent work</h2>
          <Link href="/logs" className="text-sm font-semibold text-brand-700 hover:text-brand-800">
            View all logs
          </Link>
        </div>

        {overview && overview.recent.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {overview.recent.map((item) => (
              <li key={item.id}>
                <ProofListItemView item={item} />
              </li>
            ))}
          </ul>
        ) : null}

        {overview && overview.recent.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-brand-200 bg-white p-8 text-center">
            <p className="text-lg font-semibold text-ink-900">No work logged yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-600">
              Every job you finish can become proof an employer can check. Log the first one to
              start your record.
            </p>
            <Link
              href="/workspace"
              className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            >
              Log your first job
            </Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}