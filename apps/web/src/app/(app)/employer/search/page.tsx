import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { redirect } from 'next/navigation';
import type {
  CandidateCard,
  CapabilitySpec,
  EmployerApprovalResponse,
  SearchResponse,
  SpecsResponse,
} from '@tetherproof/shared';
import { ApiRequestError } from '@/lib/api-error';
import { changeSpec } from '@/lib/actions';
import { apiServer, currentProfile } from '@/lib/server/api';
import { Banner } from '@/components/ui/Banner';
import { Avatar } from '@/components/ui/Avatar';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { BookmarkButton } from './BookmarkButton';
import { SearchForm } from './SearchForm';
import { CreateSpecForm } from '../CreateSpecForm';
import { OfferForm } from '../OfferForm';

export const metadata: Metadata = {
  title: 'Find candidates — TetherProof',
};

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

interface SearchParams {
  skill?: string;
  minProofs?: string;
  radiusKm?: string;
  error?: string;
}

/**
 * The employer's search desk: find candidates by proven skill, and keep the
 * searches that should keep looking.
 *
 * Search is a plain GET form rather than client-side fetching. That makes a
 * result a shareable, reloadable address, which is what someone comparing
 * candidates actually wants, and it works before any JavaScript arrives. A query
 * the API refuses is reported in place rather than taking the page down.
 *
 * Saved searches are one tap from the search bar, in a sheet, rather than a
 * section at the bottom that a long result list would bury.
 *
 * The approval state is read alongside the saved searches so the screen can say
 * why an invitation cannot be sent before the employer fills the form in. Both
 * reads degrade on their own: the real gate is enforced when an invitation is
 * sent, so a failed read here must not be the reason the desk will not open.
 */
export default async function EmployerSearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await currentProfile();
  if (!user) redirect('/login');
  if (user.role === 'worker') redirect('/dashboard');
  if (user.role !== 'employer') redirect('/pending');

  const params = await searchParams;
  const skill = params.skill?.trim() ?? '';

  const [approval, specsResponse] = await Promise.all([
    apiServer<EmployerApprovalResponse>('/employers/approval').catch(() => null),
    apiServer<SpecsResponse>('/employers/specs').catch(() => null),
  ]);

  const sendingBlocked =
    approval?.sending.eligibility === 'blocked' ? approval.sending.reason : undefined;
  const specs = specsResponse?.specs ?? null;

  let candidates: CandidateCard[] | null = null;
  let searchError: string | null = null;
  if (skill) {
    try {
      candidates = (await searchCandidates(skill, params, user.locationGps)).candidates;
    } catch (error) {
      searchError =
        error instanceof ApiRequestError
          ? error.message
          : 'That search could not be run. Please try again.';
    }
  }

  // The saved searches live in a sheet opened from the search bar, not at the
  // foot of the page where a long result list would bury them.
  const savedSearches = (
    <>
      {specs === null ? (
        <EmptyState>
          Your saved searches could not be loaded just now. Reload the page to try again.
        </EmptyState>
      ) : specs.length === 0 ? (
        <EmptyState>
          No saved search yet. A saved search keeps looking while you are away, so the dashboard can
          tell you when someone new matches it.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {specs.map((spec) => (
            <SpecRow key={spec.id} spec={spec} />
          ))}
        </ul>
      )}
      <CreateSpecForm />
    </>
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {params.error ? <Banner tone="problem">{params.error}</Banner> : null}

      <SearchForm
        defaultSkill={skill}
        defaultMinProofs={params.minProofs ?? '1'}
        defaultRadiusKm={params.radiusKm ?? '25'}
        locationSet={Boolean(user.locationGps)}
        savedCount={specs?.length ?? 0}
        savedSearches={savedSearches}
      />

      {searchError ? (
        <Banner tone="problem" title="That search did not run">
          {searchError}
        </Banner>
      ) : null}

      {candidates ? (
        <SearchResults candidates={candidates} sendingBlocked={sendingBlocked} />
      ) : !searchError ? (
        <p className="text-sm text-ink-600">
          Search by a skill to see workers with verified proof of it.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Runs the search and hands the refusal back to the page.
 *
 * The endpoint matches the skill against verified proof, so an empty result is a
 * statement about the data and not about the account: `minProofs` is the floor
 * and only a saved location turns the radius on.
 */
async function searchCandidates(
  skill: string,
  params: SearchParams,
  referenceGps: string | null,
): Promise<SearchResponse> {
  const query = new URLSearchParams({
    requiredSkill: skill,
    minProofThreshold: positiveOr(params.minProofs, 1),
    maxDistanceKm: positiveOr(params.radiusKm, 25),
  });
  if (referenceGps) query.set('referenceGps', referenceGps);
  return apiServer<SearchResponse>(`/employers/search?${query.toString()}`);
}

function positiveOr(value: string | undefined, fallback: number): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return String(fallback);
  return String(Math.floor(parsed));
}

function SearchResults({
  candidates,
  sendingBlocked,
}: {
  candidates: CandidateCard[];
  sendingBlocked?: string;
}) {
  if (candidates.length === 0) {
    return (
      <section aria-labelledby="results-heading" className="flex flex-col gap-3">
        <h2 id="results-heading" className="text-base font-semibold text-ink-900">
          Search results
        </h2>
        <div className="rounded-xl bg-brand-50 p-4 text-sm text-ink-600">
          <p className="font-medium text-ink-900">No candidates matched this search</p>
          <p className="mt-1">
            Workers appear if they have verified proof in the skill, allow discovery, and meet your distance filter.
          </p>
          <p className="mt-1">
            To find more, broaden the skill, lower the proof threshold, or widen the distance.Your approval status only affects invitations.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="results-heading" className="flex flex-col gap-3">
      <h2 id="results-heading" className="text-base font-semibold text-ink-900">
        {candidates.length === 1 ? '1 candidate' : `${candidates.length} candidates`}
      </h2>
      <ul className="divide-y divide-brand-100 overflow-hidden rounded-2xl border border-brand-100 bg-white">
        {candidates.map((candidate) => (
          <CandidateRow
            key={candidate.candidateHandle}
            candidate={candidate}
            sendingBlocked={sendingBlocked}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * One candidate as a row: what an employer scans for first, with the rest a tap away.
 *
 * Collapsed, the row says the skill, how many verified proofs back it, and the
 * trust score. Opening it shows distance, when the work was last verified, and
 * the invitation form. A native `<details>` carries the open/close, so it needs
 * no client state, works before JavaScript arrives, and is announced properly by
 * assistive technology.
 *
 * The bookmark star is a sibling of the summary, not a child of it: a button
 * inside a summary would also toggle the row, and the star must only bookmark.
 * It is positioned over the summary's reserved right edge, level with the first
 * line of text.
 */
function CandidateRow({
  candidate,
  sendingBlocked,
}: {
  candidate: CandidateCard;
  sendingBlocked?: string;
}) {
  const scored = candidate.trustScore !== null && candidate.trustScore !== 0;
  const proofs = candidate.verifiedProofs;

  return (
    <li className="relative">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 py-3.5 pr-12 pl-4 transition-colors hover:bg-brand-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 [&::-webkit-details-marker]:hidden">
          {/*
            The face, or the initial, or a plain person glyph when the worker has
            neither. An employer choosing between candidates who look identical on
            paper needs to be able to tell them apart, and a worker is never asked
            to upload a photo to appear here — `Avatar` falls back twice over, so an
            absent photo is an ordinary state rather than a hole in the row.
          */}
          <Avatar name={candidate.displayName} src={candidate.avatarUrl} size="md" />
          <div className="min-w-0 flex-1">
            {candidate.displayName ? (
              <p className="truncate text-base font-semibold text-ink-900">
                {candidate.displayName}
              </p>
            ) : null}
            <p className={`truncate text-ink-600 ${candidate.displayName ? 'mt-0.5 text-sm' : 'text-base font-semibold text-ink-900'}`}>
              {candidate.skillTag}
            </p>
            <p className="mt-0.5 text-sm text-ink-600">
              {proofs} verified proof{proofs === 1 ? '' : 's'}
            </p>
          </div>
          <div className="shrink-0 text-right">
            {scored ? (
              <>
                <p className="text-base leading-none font-semibold text-brand-700 tabular-nums">
                  {formatTrust(candidate.trustScore)}
                </p>
                <p className="mt-1 text-xs text-ink-600">Trust</p>
              </>
            ) : (
              <p className="text-xs text-ink-600">Not scored yet</p>
            )}
          </div>
          <ChevronDown
            aria-hidden="true"
            className="h-5 w-5 shrink-0 text-ink-500 transition-transform group-open:rotate-180"
            strokeWidth={ICON_STROKE_WIDTH}
          />
        </summary>

        <div className="px-4 pb-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-brand-100 pt-4 text-sm">
            <Detail label="Distance" value={formatDistance(candidate.distanceKm)} />
            <Detail label="Last verified" value={formatDate(candidate.lastVerifiedAt)} />
          </dl>
          <div className="mt-4">
            <OfferForm
              candidateHandle={candidate.candidateHandle}
              skillTag={candidate.skillTag}
              disabledReason={sendingBlocked}
            />
          </div>
        </div>
      </details>

      <div className="absolute top-[1.1rem] right-1.5">
        <BookmarkButton label={candidate.skillTag} />
      </div>
    </li>
  );
}

/** One label above its value, in the expanded part of a candidate row. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-600">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink-900">{value}</dd>
    </div>
  );
}

function SpecRow({ spec }: { spec: CapabilitySpec }) {
  return (
    <li className="rounded-xl border border-brand-100 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-ink-900">{spec.requiredSkill}</p>
        {spec.isActive ? (
          <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
            Active
          </span>
        ) : (
          <span className="rounded-full bg-ink-600/10 px-3 py-1 text-xs font-medium text-ink-600">
            Paused
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-ink-600">
        At least {spec.minProofThreshold} verified proof{spec.minProofThreshold === 1 ? '' : 's'},
        within {spec.maxDistanceKm} km.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={{
            pathname: '/employer/search',
            query: {
              skill: spec.requiredSkill,
              minProofs: String(spec.minProofThreshold),
              radiusKm: String(spec.maxDistanceKm),
            },
          }}
          className="inline-flex min-h-11 items-center rounded-xl border border-brand-600 px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50"
        >
          Run this search
        </Link>
        <form action={changeSpec}>
          <input type="hidden" name="specId" value={spec.id} />
          <input type="hidden" name="intent" value={spec.isActive ? 'pause' : 'activate'} />
          <SubmitButton variant="secondary" className="min-h-11 w-auto px-4 text-sm">
            {spec.isActive ? 'Pause' : 'Resume'}
          </SubmitButton>
        </form>
        <form action={changeSpec}>
          <input type="hidden" name="specId" value={spec.id} />
          <input type="hidden" name="intent" value="delete" />
          <SubmitButton variant="danger" className="min-h-11 w-auto px-4 text-sm">
            Delete
          </SubmitButton>
        </form>
      </div>
    </li>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-brand-50 p-4 text-sm text-ink-600">{children}</p>;
}

/**
 * Formats a trust score for display.
 *
 * A score of zero is a real result meaning nothing has been scored yet, which is
 * not the same as being untrustworthy, so it is labelled rather than shown as a
 * number that reads like a verdict.
 */
function formatTrust(score: number | null): string {
  if (score === null || score === 0) return 'Not scored yet';
  return `${(score * 100).toFixed(0)}%`;
}

function formatDistance(distanceKm: number | null): string {
  return distanceKm === null ? 'Not shared' : `${Math.round(distanceKm)} km`;
}

function formatDate(value: string | null): string {
  return value ? DATE_FORMATTER.format(new Date(value)) : 'Unknown';
}