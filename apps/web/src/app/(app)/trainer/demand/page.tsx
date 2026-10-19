import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Building2, CircleX, Search, Send, TrendingUp, Users } from 'lucide-react';
import type { DemandInsightsResponse } from '@tetherproof/shared';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { apiServer, currentProfile } from '@/lib/server/api';
import { homeFor } from '@/lib/navigation';

export const metadata: Metadata = {
  title: 'Market demand — TetherProof',
};

/**
 * The market demand dashboard: `doc/02` §5.2.
 *
 * Built entirely from what the platform already holds. Demand is the set of employer
 * searches currently running, supply is the set of worker capability blocks, and the
 * gap between them is what a curriculum should be aimed at. There is no external
 * labour-market feed behind any number here, and the page says so, because a
 * training director deciding what to teach next deserves to know how thin the
 * evidence is.
 *
 * The two honest limitations are stated on the page rather than hidden in the
 * schema.
 *
 * A skill nobody searched for is not a skill nobody needs — it is a skill nobody has
 * written down, and the ordering is by gap precisely so those do not crowd out the
 * real signal.
 *
 * Rejection figures are network totals rather than a per-skill column, because
 * `direct_offers` records which spec an invitation came from and no skill at all. A
 * per-skill rejection count would silently describe only the invitations an
 * employer happened to save a spec for, and would read as a complete picture of why
 * candidates are turned down when it is not one.
 */
/**
 * How many rows the page shows.
 *
 * Applied server-side, in the query, rather than by slicing in the browser: with a few hundred
 * skills the difference is real, and fetching all of them to display fifteen would make the page
 * slower exactly when there is most to see.
 */
const DEMAND_LIMIT = 15;

export default async function TrainerDemandPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  if (!user.capabilities.includes('training_provider')) redirect(homeFor(user));

  const insights = await apiServer<DemandInsightsResponse>(
    `/trainers/demand?limit=${DEMAND_LIMIT}`,
  );
  const { totals, skills } = insights;

  const rejectedShare =
    totals.invitationsSent > 0 ? Math.round((totals.invitationsDeclined / totals.invitationsSent) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Network totals" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Active searches" value={totals.activeSearches} icon={Search} />
        <Stat label="Workers offering" value={totals.availableWorkers} icon={Users} />
        <Stat label="Invitations sent" value={totals.invitationsSent} icon={Send} />
        <Stat label="Declined" value={totals.invitationsDeclined} hint={`${rejectedShare}% of invitations`} icon={CircleX} />
      </section>

      <Card title="Where demand outruns supply">
        <p className="text-sm text-ink-600">
          Ranked by the gap between what employers search for and who offers it.
        </p>

        {/*
          The aggregate and the visible rows are different numbers, and a page that shows
          both without saying so invites the wrong conclusion — "only four skills have
          demand" when there are several hundred. The totals above count everything; this
          list is capped server-side, so it says how it is capped.
        */}
        {skills.length > 0 && skills.length >= DEMAND_LIMIT ? (
          <p className="mt-1 text-xs text-ink-600">
            Showing the {DEMAND_LIMIT} biggest gaps of {totals.institutions}{' '}
            {totals.institutions === 1 ? 'institute' : 'institutes'} currently searching.
          </p>
        ) : null}

        {skills.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-brand-200 bg-brand-50/20 p-6 text-center">
            <p className="text-sm font-semibold text-ink-900">No demand signal yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-ink-600">
              This reads the searches employers run on TetherProof.
            </p>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {skills.map((skill) => (
              <li
                key={skill.skillTag}
                className="rounded-xl border border-brand-100 bg-white p-3 shadow-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-ink-900">{skill.skillTag}</p>
                  <span
                    className={`text-xs font-bold tabular-nums ${
                      skill.gapScore > 0 ? 'text-amber-700' : 'text-ink-500'
                    }`}
                  >
                    {skill.gapScore > 0 ? `${skill.gapScore} short` : 'well supplied'}
                  </span>
                </div>

                {/*
                  The bar is the gap as a share of total demand, so its length means
                  something without needing an axis. Decorative: the figures beside it
                  carry the same information as text, which is what a screen reader
                  gets and what a reader who cannot judge a length uses instead.
                */}
                <div
                  aria-hidden="true"
                  className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-100"
                >
                  <div
                    className={`h-full rounded-full ${skill.gapScore > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{
                      width: `${Math.min(100, totals.activeSearches > 0 ? (skill.activeSearches / totals.activeSearches) * 100 : 0)}%`,
                    }}
                  />
                </div>

                <p className="mt-2 text-xs text-ink-600">
                  {skill.activeSearches}{' '}
                  {skill.activeSearches === 1 ? 'employer is' : 'employers are'} searching ·{' '}
                  {skill.availableWorkers}{' '}
                  {skill.availableWorkers === 1 ? 'worker offers' : 'workers offer'} it
                  {skill.activeSearches > 0 && skill.availableWorkers > 0
                    ? ` · ${skill.demandPerWorker} searches per worker`
                    : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Banner tone="info" title="How to read this">
        This is what employers on TetherProof are searching for right now, not an official
        labour-market statistic. A skill with no searches has not been shown to be unwanted — only
        that nobody has written it down.
      </Banner>

      <Card title="What is counted">
        <ul className="flex flex-col gap-3 text-sm text-ink-600">
          <li className="flex items-start gap-2">
            <Building2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={ICON_STROKE_WIDTH} />
            <span>
              <strong className="text-ink-900">Demand</strong> is employer searches that are
              currently running. Paused searches are excluded: a filter nobody is running is not a
              vacancy.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Users aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={ICON_STROKE_WIDTH} />
            <span>
              <strong className="text-ink-900">Supply</strong> is workers holding a capability
              block for the skill. It counts what people offer, not what has been verified, because
              the question a curriculum faces is how many people are competing for the work.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <TrendingUp aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={ICON_STROKE_WIDTH} />
            <span>
              <strong className="text-ink-900">Micro-credentials are not counted as supply.</strong>{' '}
              Otherwise an institute&apos;s own graduates would inflate the shortage figure it uses
              to justify its own curriculum.
            </span>
          </li>
        </ul>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: typeof Search;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-brand-100 bg-white p-4 shadow-sm">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
      </span>
      <p className="text-2xl font-extrabold tabular-nums text-ink-900">{value}</p>
      <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500">{label}</p>
      {hint ? <p className="text-xs text-ink-600">{hint}</p> : null}
    </div>
  );
}
