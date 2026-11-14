import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowRight,
  Building2,
  Clock3,
  Search,
  Send,
  ShieldCheck,
  ShieldX,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { EmployerOverviewResponse, EmployerVerificationStatus } from '@tetherproof/shared';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { apiServer, currentProfile } from '@/lib/server/api';
import { homeFor } from '@/lib/navigation';

export const metadata: Metadata = {
  title: 'Hiring — TetherProof',
};

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

type Tone = 'brand' | 'amber' | 'emerald' | 'red' | 'neutral';

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
  red: {
    box: 'border-red-200 bg-red-50/60 hover:border-red-300',
    chip: 'bg-red-100 text-red-700',
  },
  neutral: {
    box: 'border-neutral-200 bg-neutral-50 hover:border-neutral-300',
    chip: 'bg-neutral-200 text-ink-700',
  },
};

/**
 * The employer's overview.
 *
 * One read — `GET /employers/overview` — answers every number on the page, so the
 * tiles cannot disagree with each other or with the searches they point at. The
 * four tiles are the questions an employer opens the app to ask: are my searches
 * running, who is still to answer, who said yes, and is my organization cleared.
 * Match alerts then name the searches actually producing candidates rather than
 * leaving a total to be guessed at.
 *
 * A failed read degrades to an explanation and the quick links, not a broken
 * screen: the search and the organization page are reachable regardless.
 */
export default async function EmployerDashboardPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  if (!user.capabilities.includes('employer')) redirect(homeFor(user));

  let overview: EmployerOverviewResponse | null = null;
  try {
    overview = await apiServer<EmployerOverviewResponse>('/employers/overview');
  } catch {
    overview = null;
  }

  const greeting = user.organizationName?.trim() || user.fullName?.trim() || 'your team';

  if (!overview) {
    return (
      <div className="flex flex-col gap-6">
        <PageIntro greeting={greeting} />
        <Banner tone="warning" title="Dashboard unavailable">
          We could not load your dashboard just now. Candidate search and your organization profile
          still work. Refresh in a moment to try again.
        </Banner>
        <QuickActions />
      </div>
    );
  }

  const approval = approvalPresentation(overview.status, overview.note, overview.reviewedAt);
  const activeMatches = overview.matches
    .filter((match) => match.isActive && match.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount);

  const responseTotal = overview.acceptedCandidates + overview.declinedInvites;

  return (
    <div className="flex flex-col gap-6">
      <PageIntro greeting={greeting} />

      <ApprovalNotice overview={overview} />

      {overview.activeSearches === 0 ? (
        <Card title="Get started">
          <ol className="flex flex-col gap-2 text-sm text-ink-700">
            <li>1. Name your business and submit it for review.</li>
            <li>2. Wait for approval — hiring unlocks then.</li>
            <li>3. Create your first search.</li>
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/employer/organization"
              className="inline-flex min-h-10 items-center rounded-xl border border-brand-600 px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50"
            >
              Name the business
            </Link>
            <Link
              href="/employer/search"
              className="inline-flex min-h-10 items-center rounded-xl border border-brand-600 px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50"
            >
              Create a search
            </Link>
          </div>
        </Card>
      ) : null}

      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 sm:gap-4">
        <MetricCard
          href="/employer/search"
          label="Active searches"
          value={String(overview.activeSearches)}
          hint={
            overview.activeSearches === 0 && overview.pausedSearches === 0
              ? 'Create your first search'
              : overview.pausedSearches > 0
                ? `${overview.pausedSearches} paused`
                : 'All running'
          }
          tone="brand"
          icon={Search}
        />
        <MetricCard
          href="/employer/candidates"
          label="Pending invites"
          value={String(overview.pendingInvites)}
          hint={
            responseTotal === 0
              ? 'No responses yet'
              : `${overview.acceptedCandidates} accepted · ${overview.declinedInvites} declined`
          }
          tone="amber"
          icon={Send}
        />
        <MetricCard
          href="/employer/candidates"
          label="Accepted candidates"
          value={String(overview.acceptedCandidates)}
          hint={overview.acceptedCandidates > 0 ? 'Contact details unlocked' : 'Acceptances appear here'}
          tone="emerald"
          icon={UserCheck}
        />
        <MetricCard
          href="/employer/organization"
          label="Organization status"
          value={approval.label}
          hint={approval.hint}
          tone={approval.tone}
          icon={approval.icon}
        />
      </section>

      <section aria-labelledby="match-alerts-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3 px-1">
          <h2
            id="match-alerts-heading"
            className="text-xs font-bold uppercase tracking-wider text-ink-500"
          >
            Match alerts
          </h2>
          <Link
            href="/employer/search"
            className="text-xs font-bold text-brand-700 transition-colors hover:text-brand-800"
          >
            Candidate search →
          </Link>
        </div>

        {activeMatches.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {activeMatches.map((match) => (
              <li key={match.specId}>
                <Link
                  href={`/employer/search?skill=${encodeURIComponent(match.requiredSkill)}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-brand-100 bg-white p-3 shadow-sm transition-colors hover:border-brand-300"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                      <Search aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink-900">
                        {match.requiredSkill}
                      </span>
                      <span className="block text-xs text-ink-600">
                        {match.matchCount} {match.matchCount === 1 ? 'candidate' : 'candidates'} match
                        this search
                      </span>
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
            <p className="text-sm font-semibold text-ink-900">No matching candidates yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-ink-600">
              Save a search and matching candidates will be flagged here, so the next invitation is
              never a surprise.
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
      <h1 className="text-2xl font-bold text-ink-900">Hiring</h1>
      <p className="text-sm text-ink-600">
        Your searches, the invitations you have sent, and the people who answered, in one place.
      </p>
    </header>
  );
}

function ApprovalNotice({ overview }: { overview: EmployerOverviewResponse }) {
  if (overview.status === 'approved') {
    return (
      <Banner tone="success" title="Organization verified">
        Your organization is approved. Invitations you send reach candidates with your name attached.
      </Banner>
    );
  }

  if (overview.status === 'rejected') {
    return (
      <Banner tone="problem" title="Organization not approved">
        {overview.note?.trim() ||
          'An administrator has not approved this organization. You can keep preparing searches, but invitations stay on hold.'}
      </Banner>
    );
  }

  return (
    <Banner tone="warning" title="Approval pending">
      {overview.sending.reason?.trim() ||
        'An administrator is reviewing your organization. Search and saved searches work now; sending invitations unlocks on approval.'}
    </Banner>
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
        <p className="text-2xl font-extrabold tabular-nums text-ink-900">{value}</p>
        <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-ink-500">{label}</p>
      </div>
      <p className="text-xs leading-relaxed text-ink-600">{hint}</p>
    </Link>
  );
}

function QuickActions() {
  const actions: ReadonlyArray<{ href: string; label: string; hint: string; icon: LucideIcon }> = [
    { href: '/employer/search', label: 'Search candidates', hint: 'Find people by proven skill', icon: Search },
    { href: '/employer/candidates', label: 'Accepted candidates', hint: 'Reach the people who said yes', icon: Users },
    { href: '/employer/organization', label: 'Organization profile', hint: 'What approval is based on', icon: Building2 },
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

function approvalPresentation(
  status: EmployerVerificationStatus,
  note: string | null,
  reviewedAt: string | null,
): { label: string; hint: string; tone: Tone; icon: LucideIcon } {
  if (status === 'approved') {
    return {
      label: 'Approved',
      hint: reviewedAt ? `Verified ${DATE_FORMATTER.format(new Date(reviewedAt))}` : 'Verified for candidates',
      tone: 'emerald',
      icon: ShieldCheck,
    };
  }

  if (status === 'rejected') {
    return {
      label: 'Rejected',
      hint: note?.trim() || 'See the review note on your organization page',
      tone: 'red',
      icon: ShieldX,
    };
  }

  return {
    label: 'In review',
    hint: 'We are checking your organization details',
    tone: 'amber',
    icon: Clock3,
  };
}
