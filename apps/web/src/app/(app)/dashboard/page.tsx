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
 * The worker's landing page: how much of the record is confirmed, and the latest
 * work on it.
 *
 * The numbers come from the worker's own rows only — their logs and their
 * verifications — fetched with their own token on the server, so no session
 * material is rendered into the page and two workers can never see each other's
 * totals.
 *
 * The page leads with one plain sentence and one rule beneath it. "9 of 12 jobs
 * verified" is the thing a worker came to check and the thing an employer would
 * ask, so it is said in words rather than spread over four tiles; the rule shows
 * the same split at a glance, and what is still awaiting an answer sits under it.
 * Below that is the recent work itself, as a list: the record is the product.
 *
 * Nothing here repeats the chrome. The header already carries invitations and
 * notifications with their badges, and the Work tab is the way to log a job, so
 * the page has no second button for either.
 *
 * If the numbers cannot be fetched the page does not fall over: the way into
 * every screen still works, and the page says so in one line. That trades a
 * loading failure for a slightly emptier landing page, which is the right trade
 * for the place a worker arrives at most.
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

  if (!overview) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-600">
          Your numbers could not be loaded right now. The rest of the app still works.
        </p>
        <Link href="/logs" className="text-sm font-semibold text-brand-700 hover:text-brand-800">
          View all logs
        </Link>
      </div>
    );
  }

  const { totalLogs, verifiedLogs, awaitingVerificationLogs, recent } = overview;

  return (
    <div className="flex flex-col gap-10">
      {totalLogs > 0 ? (
        <ProofSummary
          total={totalLogs}
          verified={verifiedLogs}
          awaiting={awaitingVerificationLogs}
        />
      ) : null}

      <section aria-labelledby="recent-work-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="recent-work-heading" className="text-base font-semibold text-ink-900">
            Recent work
          </h2>
          <Link href="/logs" className="text-sm font-semibold text-brand-700 hover:text-brand-800">
            View all logs
          </Link>
        </div>

        {recent.length > 0 ? (
          <ul className="mt-1 divide-y divide-brand-100">
            {recent.map((item) => (
              <li key={item.id}>
                <ProofListItemView item={item} variant="row" />
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 max-w-md">
            <p className="text-base font-semibold text-ink-900">No work logged yet</p>
            <p className="mt-1 text-sm text-ink-600">
              Every job you finish can become proof an employer can check. Log your first one from
              the Work tab.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

interface ProofSummaryProps {
  total: number;
  verified: number;
  awaiting: number;
}

/**
 * The record's standing in one sentence and one rule.
 *
 * The rule is verified, then awaiting, then whatever remains (not confirmed, or
 * blocked), so the verified share is always the leading edge. It is an image to
 * assistive technology, with the same numbers as its label, because the sentence
 * above already says the headline and the legend below says the rest.
 */
function ProofSummary({ total, verified, awaiting }: ProofSummaryProps) {
  const verifiedShare = (verified / total) * 100;
  const awaitingShare = (awaiting / total) * 100;
  const noun = total === 1 ? 'job' : 'jobs';

  return (
    <section aria-label="Your record">
      <p className="text-2xl font-semibold tracking-tight text-ink-900 tabular-nums">
        {verified} of {total} {noun} verified
      </p>

      <div
        role="img"
        aria-label={`${verified} verified, ${awaiting} awaiting confirmation, out of ${total} logged`}
        className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-neutral-100"
      >
        <div className="h-full bg-brand-600" style={{ width: `${verifiedShare}%` }} />
        <div className="h-full bg-amber-300" style={{ width: `${awaitingShare}%` }} />
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-600">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-600" />
          {verified} verified
        </span>
        {awaiting > 0 ? (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-300" />
            {awaiting} awaiting confirmation
          </span>
        ) : null}
      </p>
    </section>
  );
}
