import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BadgeCheck, ClipboardList, Hourglass, Mail, type LucideIcon } from 'lucide-react';
import type { WorkerOverviewResponse } from '@tetherproof/shared';
import { ProofListItemView } from '@/components/proofs/ProofListItemView';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
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
 * The four metrics are drawn as a tinted grid, one colour per kind of number:
 * neutral for the record itself, emerald for confirmed work, amber for what is
 * still awaiting an answer, and blue for invitations. The shape is the only
 * thing each card carries — the numbers themselves stay plain in the tint, so
 * a worker reads the state of their record at a glance.
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
        {
          label: 'Logged works',
          value: overview.totalLogs,
          tint: {
            card: 'border-neutral-200/70 bg-neutral-50',
            value: 'text-ink-900',
            chip: 'bg-white text-neutral-600',
          },
          icon: ClipboardList,
        },
        {
          label: 'Verified',
          value: overview.verifiedLogs,
          tint: {
            card: 'border-emerald-200/70 bg-emerald-50',
            value: 'text-emerald-700',
            chip: 'bg-white text-emerald-600',
          },
          icon: BadgeCheck,
        },
        {
          label: 'Awaiting confirmation',
          value: overview.awaitingVerificationLogs,
          tint: {
            card: 'border-amber-200/70 bg-amber-50',
            value: 'text-amber-700',
            chip: 'bg-white text-amber-600',
          },
          icon: Hourglass,
        },
        {
          label: 'Invitations',
          value: overview.pendingInvitations,
          tint: {
            card: 'border-blue-200/70 bg-blue-50',
            value: 'text-blue-700',
            chip: 'bg-white text-blue-600',
          },
          icon: Mail,
        },
      ]
    : null;

  return (
    <div className="flex flex-col gap-6">
      {/*
        No heading on the page: Home's header already says "TetherProof", and the
        metrics below open it. The way to log work is one tab away — the AppTabs
        row on a phone or the nav bar on a wide screen — so a second button up
        here would only repeat the navigation that is already visible.
      */}
      {metrics ? (
        <ul className="grid grid-cols-2 gap-3">
          {metrics.map((metric) => (
            <li key={`${metric.tint.card}-${metric.label}`}>
              <MetricCard metric={metric} />
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

interface MetricCardProps {
  metric: {
    label: string;
    value: number;
    tint: { card: string; value: string; chip: string };
    icon: LucideIcon;
  };
}

/** One number in the 2×2 grid: the tint carries the kind, the value stays plain. */
function MetricCard({ metric }: MetricCardProps) {
  const Icon = metric.icon;
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${metric.tint.card}`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-3xl font-bold tabular-nums ${metric.tint.value}`}>{metric.value}</p>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${metric.tint.chip}`}>
          <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-600">{metric.label}</p>
    </div>
  );
}