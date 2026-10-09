import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { WorkerOverviewResponse } from '@tetherproof/shared';
import { ProofListItemView } from '@/components/proofs/ProofListItemView';
import { apiServer, currentProfile } from '@/lib/server/api';

export const metadata: Metadata = {
  title: 'Dashboard — TetherProof',
};

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
      <div className="mx-2 my-6 rounded-2xl border border-brand-200 bg-white p-6 shadow-sm flex flex-col gap-3">
        <p className="text-sm text-ink-700">
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
    <div className="flex flex-col gap-5 pb-12 pt-1 w-full px-2 sm:px-4">
      
      {/* Top Identity & Status Bar */}
      <div className="flex items-center justify-between px-1">
        <div>
          <h1 className="text-sm font-bold text-ink-900 leading-tight">Secure Professional Ledger</h1>
        </div>
        <div className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800 border border-brand-200">
          Online
        </div>
      </div>

      {totalLogs > 0 ? (
        <CleanRecordCard 
          total={totalLogs} 
          verified={verifiedLogs} 
          awaiting={awaitingVerificationLogs} 
        />
      ) : null}

      {/* Recent Works Section */}
      <section aria-labelledby="recent-work-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3 px-1">
          <h2 id="recent-work-heading" className="text-xs font-bold uppercase tracking-wider text-ink-500">
            Recent works
          </h2>
          <Link href="/logs" className="text-xs font-bold text-brand-700 hover:text-brand-800 transition-colors">
            View all →
          </Link>
        </div>

        {recent.length > 0 ? (
          <div className="flex flex-col gap-2">
            {recent.map((item) => (
              <div 
                key={item.id} 
                className="rounded-xl border border-brand-100 bg-white p-3 shadow-sm transition-all hover:border-brand-300"
              >
                <ProofListItemView item={item} variant="row" />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/20 p-6 text-center">
            <p className="text-sm font-semibold text-ink-900">No work logged yet</p>
            <p className="mt-1 text-xs text-ink-600">
              Every job you finish can become proof an employer can check. Log your first one from the Work tab.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

interface CleanRecordCardProps {
  total: number;
  verified: number;
  awaiting: number;
}

function CleanRecordCard({ total, verified, awaiting }: CleanRecordCardProps) {
  const noun = total === 1 ? 'job' : 'jobs';

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm border border-brand-200 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-brand-800 uppercase tracking-wider">Record Standing</span>
        <span className="rounded-lg bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-900 border border-brand-100">
          {total} total {noun}
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-extrabold tracking-tight text-ink-900 tabular-nums">{verified}</span>
        <span className="text-base font-medium text-ink-600">verified out of {total}</span>
      </div>

      {awaiting > 0 ? (
        <div className="pt-2.5 border-t border-neutral-100 flex items-center justify-between text-xs text-ink-600">
          <span>Awaiting review</span>
          <span className="font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
            {awaiting} pending
          </span>
        </div>
      ) : (
        <div className="pt-2.5 border-t border-neutral-100 text-xs text-brand-700 font-medium">
          ✓ All logged work is fully verified.
        </div>
      )}
    </div>
  );
}