import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type {
  CandidateCard,
  CapabilitySpec,
  EmployerApprovalResponse,
  SearchResponse,
  SentOffersResponse,
} from '@tetherproof/shared';
import { changeSpec } from '@/lib/actions';
import { apiServer, currentProfile } from '@/lib/server/api';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { CreateSpecForm } from './CreateSpecForm';
import { OfferForm } from './OfferForm';
import { ProfileForm } from './ProfileForm';

export const metadata: Metadata = {
  title: 'Employer dashboard — TetherProof',
};

interface SearchParams {
  skill?: string;
  minProofs?: string;
  radiusKm?: string;
  error?: string;
}

/**
 * The employer dashboard.
 *
 * A server component throughout. Everything it shows is fetched with the caller's
 * own token on the server, so no session material is rendered into the page and two
 * employers can never see each another's data, not even in a cached response.
 *
 * Search is a plain GET form rather than client-side fetching. That makes a search
 * result a shareable, reloadable, bookmarkable URL, which is what an employer
 * comparing candidates actually wants, and it means the page works before any
 * JavaScript arrives.
 */
export default async function EmployerDashboard({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await currentProfile();
  if (!user) redirect('/login');
  // The API enforces this too. Checking here as well turns a role mismatch into a
  // sentence rather than an error screen.
  if (user.role !== 'employer') redirect('/pending');

  const params = await searchParams;

  const [approval, specsResult, sentResult] = await Promise.all([
    apiServer<EmployerApprovalResponse>('/employers/approval'),
    apiServer<{ specs: CapabilitySpec[] }>('/employers/specs'),
    apiServer<SentOffersResponse>('/employers/offers'),
  ]);

  const specs = specsResult.specs;
  const sentOffers = sentResult.offers;
  const sendingBlocked = approval.sending.eligibility === 'blocked' ? approval.sending.reason : undefined;

  const candidates = params.skill
    ? (await searchCandidates(params, user.locationGps)).candidates
    : null;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-ink-900 sm:text-3xl">
          {user.organizationName ?? user.fullName ?? 'Employer dashboard'}
        </h1>
      </header>

      {params.error ? <Banner tone="problem">{params.error}</Banner> : null}
      {approvalBanner(approval)}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Your details">
          <ProfileForm
            organizationName={user.organizationName}
            locationGps={user.locationGps}
          />
        </Card>

        <Card title="Search verified proof">
          <p className="text-ink-600">
            Results show how much proof a worker has and how it was verified. Names, contact details, and
            worker identifiers stay hidden until an invitation is accepted.
          </p>
          <form method="get" action="/employer" className="mt-4 flex flex-col gap-4">
            <Field
              name="skill"
              label="Skill"
              placeholder="Solar Panel Installation"
              required
              defaultValue={params.skill ?? ''}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                name="minProofs"
                label="Minimum verified proofs"
                type="number"
                inputMode="numeric"
                min={1}
                max={500}
                step={1}
                defaultValue={params.minProofs ?? '1'}
              />
              <Field
                name="radiusKm"
                label="Within (km)"
                type="number"
                inputMode="numeric"
                min={1}
                max={20000}
                step={1}
                defaultValue={params.radiusKm ?? '25'}
                hint={
                  user.locationGps
                    ? 'Measured from your saved search location.'
                    : 'Ignored until you set a search location.'
                }
              />
            </div>
            <SubmitButton className="sm:w-auto" pendingLabel="Searching…">
              Search
            </SubmitButton>
          </form>
        </Card>
      </div>

      {candidates ? <SearchResults candidates={candidates} sendingBlocked={sendingBlocked} /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Saved searches">
          {specs.length === 0 ? (
            <EmptyState>
              You have not saved a search yet. Save one to reuse the same filter without retyping it.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {specs.map((spec) => (
                <SpecRow key={spec.id} spec={spec} />
              ))}
            </ul>
          )}
          <CreateSpecForm />
        </Card>

        <Card title="Invitations you have sent">
          {sentOffers.length === 0 ? (
            <EmptyState>
              No invitations yet. Search above, then send one to a candidate you want to talk to.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {sentOffers.map((offer) => (
                <li key={offer.id} className="rounded-xl border border-brand-100 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <StatusPill status={offer.status} />
                    <span className="text-sm text-ink-600">{formatDate(offer.respondedAt ?? offer.createdAt)}</span>
                  </div>
                  {offer.note ? <p className="mt-2 text-ink-600">{offer.note}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * Runs the search and turns a refusal into an empty list.
 *
 * A malformed query from a hand-edited URL should say so, not crash the page, and the
 * API's own validation messages are the clearest version of that.
 */
async function searchCandidates(params: SearchParams, referenceGps: string | null) {
  const query = new URLSearchParams({
    requiredSkill: params.skill!,
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

function approvalBanner(approval: EmployerApprovalResponse) {
  if (approval.status === 'approved') {
    return (
      <Banner tone="success" title="Account approved">
        You can search and send invitations.
      </Banner>
    );
  }

  if (approval.status === 'rejected') {
    return (
      <Banner tone="problem" title="Account not approved">
        <p>
          {approval.record.note ??
            'An administrator has not approved this account, so invitations cannot be sent.'}
        </p>
      </Banner>
    );
  }

  return (
    <Banner tone="warning" title="Awaiting approval">
      <p>
        You can search now. A person on our team checks each employer account before invitations can be
        sent, so that workers are not contacted by accounts nobody has looked at.
        {approval.sending.reason ? ` ${approval.sending.reason}` : ''}
      </p>
    </Banner>
  );
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
      <Card title="Search results">
        <EmptyState>
          No worker matches that filter yet. Try a broader skill, a lower proof threshold, or a wider
          distance. Workers who have not shared a location are still included.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card title={`Search results (${candidates.length})`}>
      <ul className="grid gap-4 sm:grid-cols-2">
        {candidates.map((candidate) => (
          <li key={candidate.candidateHandle} className="rounded-xl border border-brand-100 p-4">
            <p className="font-semibold text-ink-900">{candidate.skillTag}</p>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-600">Verified proofs</dt>
                <dd className="font-medium text-ink-900">{candidate.verifiedProofs}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-600">Trust score</dt>
                <dd className="font-medium text-ink-900">{formatTrust(candidate.trustScore)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-600">Distance</dt>
                <dd className="font-medium text-ink-900">{formatDistance(candidate.distanceKm)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-600">Last verified</dt>
                <dd className="font-medium text-ink-900">{formatDate(candidate.lastVerifiedAt)}</dd>
              </div>
            </dl>
            <OfferForm
              candidateHandle={candidate.candidateHandle}
              skillTag={candidate.skillTag}
              disabledReason={sendingBlocked}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SpecRow({ spec }: { spec: CapabilitySpec }) {
  return (
    <li className="rounded-xl border border-brand-100 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-ink-900">{spec.requiredSkill}</p>
        {spec.isActive ? (
          <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">Active</span>
        ) : (
          <span className="rounded-full bg-ink-600/10 px-3 py-1 text-xs font-medium text-ink-600">Paused</span>
        )}
      </div>
      <p className="mt-1 text-sm text-ink-600">
        At least {spec.minProofThreshold} verified proof{spec.minProofThreshold === 1 ? '' : 's'}, within{' '}
        {spec.maxDistanceKm} km.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={{
            pathname: '/employer',
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

function StatusPill({ status }: { status: 'pending' | 'accepted' | 'declined' }) {
  const styles: Record<typeof status, string> = {
    pending: 'bg-ink-600/10 text-ink-600',
    accepted: 'bg-brand-50 text-brand-700',
    declined: 'bg-red-50 text-red-800',
  };
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${styles[status]}`}>
      {status === 'pending' ? 'Waiting for a reply' : status === 'accepted' ? 'Accepted' : 'Declined'}
    </span>
  );
}

/**
 * Formats a trust score for display.
 *
 * A score of zero is a real result meaning nothing has been scored yet, which is not
 * the same as being untrustworthy, so it is labelled rather than shown as a number
 * that reads like a verdict.
 */
function formatTrust(score: number | null): string {
  if (score === null) return 'Not scored yet';
  if (score === 0) return 'Not scored yet';
  return `${(score * 100).toFixed(0)}%`;
}

function formatDistance(distanceKm: number | null): string {
  return distanceKm === null ? 'Not shared' : `${Math.round(distanceKm)} km`;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : 'Unknown';
}