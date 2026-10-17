import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Award, Clock3, TrendingUp, Users, type LucideIcon } from 'lucide-react';
import type { TrainerOverviewResponse } from '@tetherproof/shared';
import { Banner } from '@/components/ui/Banner';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { apiServer, currentProfile } from '@/lib/server/api';
import { homeFor } from '@/lib/navigation';

export const metadata: Metadata = {
  title: 'Training dashboard — TetherProof',
};

type Tone = 'brand' | 'amber' | 'emerald' | 'neutral';

const TONES: Record<Tone, { box: string; chip: string }> = {
  brand: {
    box: 'border-brand-200 bg-brand-50/60 hover:border-brand-300',
    chip: 'bg-brand-100 text-brand-700',
  },
  amber: {
    box: 'border-amber-200 bg-amber-50/60 hover:border-amber-300',
    chip: 'bg-amber-100 text-amber-700',
  },
  emerald: {
    box: 'border-emerald-200 bg-emerald-50/60 hover:border-emerald-300',
    chip: 'bg-emerald-100 text-emerald-700',
  },
  neutral: {
    box: 'border-neutral-200 bg-neutral-50 hover:border-neutral-300',
    chip: 'bg-neutral-200 text-ink-700',
  },
};

/**
 * The institute's overview.
 *
 * One read answers every number here, so the tiles cannot disagree with each other
 * or with the pages they point at. The three questions an institute opens the app to
 * ask are who is on the books, what is waiting on a student, and what they have
 * already signed off — with the skills the market is short of underneath, because
 * that is what the whole screen is for.
 *
 * A failed read degrades to an explanation and the quick links, the same way the
 * employer dashboard does: the roster, the issuer, and the demand dashboard all
 * work regardless of whether this summary could be assembled.
 */
export default async function TrainerDashboardPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  if (!user.capabilities.includes('training_provider')) redirect(homeFor(user));

  let overview: TrainerOverviewResponse | null = null;
  try {
    overview = await apiServer<TrainerOverviewResponse>('/trainers/overview');
  } catch {
    overview = null;
  }

  const greeting = user.organizationName?.trim() || user.fullName?.trim() || 'your institute';

  if (!overview) {
    return (
      <div className="flex flex-col gap-6">
        <PageIntro greeting={greeting} />
        <Banner tone="warning" title="Dashboard unavailable">
          We could not load your dashboard just now. Your roster, the milestone issuer, and market
          demand all still work. Refresh in a moment to try again.
        </Banner>
        <QuickActions />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageIntro greeting={greeting} />

      {overview.studentCount === 0 ? (
        <Banner tone="info" title="No students enrolled yet">
          Share your enrolment code from the roster page. Students join by redeeming it, and they
          will appear here ready for a milestone.
        </Banner>
      ) : null}

      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 sm:gap-4">
        <MetricCard
          href="/trainer/roster"
          label="Enrolled students"
          value={String(overview.studentCount)}
          hint={overview.studentCount === 0 ? 'Share your enrolment code' : 'On your roster'}
          tone="brand"
          icon={Users}
        />
        <MetricCard
          href="/trainer/credentials"
          label="Awaiting a student"
          value={String(overview.awaitingCredentials)}
          hint={
            overview.awaitingCredentials === 0
              ? 'Nothing outstanding'
              : 'Recorded, not yet accepted'
          }
          tone="amber"
          icon={Clock3}
        />
        <MetricCard
          href="/trainer/credentials"
          label="Accepted credentials"
          value={String(overview.acceptedCredentials)}
          hint={overview.acceptedCredentials > 0 ? 'Held on their record' : 'Appear as students accept'}
          tone="emerald"
          icon={Award}
        />
        <MetricCard
          href="/trainer/demand"
          label="Top demand skill"
          value={overview.topDemandSkills[0]?.skillTag ?? '—'}
          hint={
            overview.topDemandSkills[0]
              ? `${overview.topDemandSkills[0].gapScore} more searched than available`
              : 'No employer searches yet'
          }
          tone="neutral"
          icon={TrendingUp}
        />
      </section>

      <section aria-labelledby="gap-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3 px-1">
          <h2 id="gap-heading" className="text-xs font-bold uppercase tracking-wider text-ink-500">
            Shortest skills
          </h2>
          <Link
            href="/trainer/demand"
            className="text-xs font-bold text-brand-700 transition-colors hover:text-brand-800"
          >
            Market demand →
          </Link>
        </div>

        {overview.topDemandSkills.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {overview.topDemandSkills.slice(0, 5).map((skill) => (
              <li key={skill.skillTag}>
                <Link
                  href="/trainer/demand"
                  className="flex items-center justify-between gap-3 rounded-xl border border-brand-100 bg-white p-3 shadow-sm transition-colors hover:border-brand-300"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink-900">
                      {skill.skillTag}
                    </span>
                    <span className="block text-xs text-ink-600">
                      {skill.activeSearches} searches · {skill.availableWorkers} offering
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-brand-700">
                    View
                    <ArrowRight aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/20 p-6 text-center">
            <p className="text-sm font-semibold text-ink-900">No employer searches yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-ink-600">
              Demand is read from the searches employers run on this network. As soon as one is
              saved, the skills it names appear here.
            </p>
          </div>
        )}
      </section>

      <QuickActions />
    </div>
  );
}

function PageIntro({ greeting }: { greeting: string }) {
  return (
    <header className="flex flex-col gap-1">
      <p className="text-sm font-semibold text-brand-700">Welcome back, {greeting}</p>
      <h1 className="text-2xl font-bold text-ink-900">Training dashboard</h1>
      <p className="text-sm text-ink-600">
        Your students, the milestones you have signed off, and the skills the market is short of.
      </p>
    </header>
  );
}

interface MetricCardProps {
  href: string;
  label: string;
  value: string;
  hint: string;
  tone: Tone;
  icon: LucideIcon;
}

function MetricCard({ href, label, value, hint, tone, icon: Icon }: MetricCardProps) {
  return (
    <Link
      href={href}
      className={`group flex flex-col gap-3 rounded-2xl border p-4 shadow-sm transition-colors ${TONES[tone].box}`}
    >
      <div className="flex items-center justify-between">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${TONES[tone].chip}`}>
          <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
        </span>
        <ArrowRight
          aria-hidden="true"
          className="h-4 w-4 text-ink-400 transition-transform group-hover:translate-x-0.5"
          strokeWidth={ICON_STROKE_WIDTH}
        />
      </div>
      <div className="min-w-0">
        <p className="truncate text-2xl font-extrabold tabular-nums text-ink-900">{value}</p>
        <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-ink-500">{label}</p>
      </div>
      <p className="text-xs leading-relaxed text-ink-600">{hint}</p>
    </Link>
  );
}

function QuickActions() {
  const actions: ReadonlyArray<{ href: string; label: string; hint: string; icon: LucideIcon }> = [
    { href: '/trainer/roster', label: 'Student roster', hint: 'Enrolments and who is on the books', icon: Users },
    { href: '/trainer/credentials', label: 'Milestone issuer', hint: 'Sign off on a practical', icon: Award },
    { href: '/trainer/demand', label: 'Market demand', hint: 'What the network is short of', icon: TrendingUp },
  ];

  return (
    <section aria-label="Quick actions" className="grid gap-3 sm:grid-cols-3">
      {actions.map(({ href, label, hint, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="group flex items-center gap-3 rounded-2xl border border-brand-100 bg-white p-4 shadow-sm transition-colors hover:border-brand-300"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink-900">{label}</span>
            <span className="block text-xs text-ink-600">{hint}</span>
          </span>
          <ArrowRight
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-ink-400"
            strokeWidth={ICON_STROKE_WIDTH}
          />
        </Link>
      ))}
    </section>
  );
}
