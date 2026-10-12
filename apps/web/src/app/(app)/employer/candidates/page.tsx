import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Mail, Phone } from 'lucide-react';
import type {
  AcceptedCandidate,
  AcceptedCandidatesResponse,
  SentOffer,
  SentOffersResponse,
} from '@tetherproof/shared';
import { ApiRequestError } from '@/lib/api-error';
import { apiServer, currentProfile } from '@/lib/server/api';
import { Avatar } from '@/components/ui/Avatar';
import { Banner } from '@/components/ui/Banner';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { PeopleTabs } from './PeopleTabs';

export const metadata: Metadata = {
  title: 'People — TetherProof',
};

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * The employer's invitations and the people who answered them.
 *
 * The accepted tab is the one place contact details appear, and it only ever
 * contains workers who chose to be contacted by accepting: the reveal is the
 * thing an acceptance buys, not a setting an employer can flip. Pending
 * invitations stay masked, and a decline reveals nothing beyond the fact of the
 * decline — identity flows one way, and only after agreement.
 *
 * The two lists are fetched independently so one endpoint being down shows an
 * error inside its own tab rather than blanking the whole screen.
 */
export default async function EmployerCandidatesPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  if (user.role === 'worker') redirect('/dashboard');
  if (user.role !== 'employer') redirect('/pending');

  const [acceptedResult, sentResult] = await Promise.allSettled([
    apiServer<AcceptedCandidatesResponse>('/employers/candidates'),
    apiServer<SentOffersResponse>('/employers/offers'),
  ]);

  const accepted = acceptedResult.status === 'fulfilled' ? acceptedResult.value.candidates : [];
  const acceptedError = loadError(acceptedResult);

  const offers = sentResult.status === 'fulfilled' ? sentResult.value.offers : [];
  const pending = offers.filter((offer) => offer.status === 'pending');
  const declinedCount = offers.filter((offer) => offer.status === 'declined').length;
  const awaitingError = loadError(sentResult);

  return (
    <div className="flex flex-col gap-4">
      <PeopleTabs
        acceptedCount={accepted.length}
        awaitingCount={pending.length}
        accepted={<AcceptedPanel candidates={accepted} error={acceptedError} />}
        awaiting={<AwaitingPanel pending={pending} declinedCount={declinedCount} error={awaitingError} />}
      />

      <div className="rounded-2xl border border-dashed border-brand-200 bg-brand-50/20 p-4 text-sm text-ink-600">
        Not enough candidates yet?{' '}
        <Link href="/employer/search" className="font-semibold text-brand-700 hover:text-brand-800">
          Run a search
        </Link>{' '}
        to invite more people.
      </div>
    </div>
  );
}

/** A readable reason for a failed sidebar read, or null when it succeeded. */
function loadError(result: PromiseSettledResult<unknown>): string | null {
  if (result.status === 'fulfilled') return null;
  return result.reason instanceof ApiRequestError
    ? result.reason.message
    : 'We could not load this list just now. Please try again.';
}

function AcceptedPanel({ candidates, error }: { candidates: AcceptedCandidate[]; error: string | null }) {
  if (error) {
    return (
      <Banner tone="problem" title="Could not load accepted candidates">
        {error}
      </Banner>
    );
  }

  if (candidates.length === 0) {
    return (
      <EmptyState>
        No one has accepted an invitation yet. When a candidate does, their name and contact details
        appear here.
      </EmptyState>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {candidates.map((candidate) => (
        <AcceptedRow key={candidate.offerId} candidate={candidate} />
      ))}
    </ul>
  );
}

function AwaitingPanel({
  pending,
  declinedCount,
  error,
}: {
  pending: SentOffer[];
  declinedCount: number;
  error: string | null;
}) {
  if (error) {
    return <Banner tone="problem" title="Could not load your invitations">{error}</Banner>;
  }

  return (
    <div className="flex flex-col gap-4">
      {pending.length === 0 ? (
        <EmptyState>No invitations are waiting on an answer right now.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {pending.map((offer) => (
            <PendingRow key={offer.id} offer={offer} />
          ))}
        </ul>
      )}
      {declinedCount > 0 ? (
        <p className="rounded-xl bg-neutral-50 p-3 text-xs text-ink-600">
          {declinedCount} {declinedCount === 1 ? 'invitation was' : 'invitations were'} declined.
        </p>
      ) : null}
    </div>
  );
}

function AcceptedRow({ candidate }: { candidate: AcceptedCandidate }) {
  const hasContact = Boolean(candidate.email || candidate.phone);

  return (
    <li className="rounded-xl border border-brand-100 bg-white p-4">
      <div className="flex items-start gap-3">
        <Avatar name={candidate.fullName} src={candidate.avatarUrl} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-ink-900">{candidate.fullName?.trim() || 'Candidate'}</p>
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
              Accepted
            </span>
          </div>

          <div className="mt-2 flex flex-col gap-1.5 text-sm">
            {candidate.email ? (
              <a
                href={`mailto:${candidate.email}`}
                className="flex items-center gap-2 text-brand-700 hover:text-brand-800"
              >
                <Mail aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={ICON_STROKE_WIDTH} />
                <span className="truncate">{candidate.email}</span>
              </a>
            ) : null}
            {candidate.phone ? (
              <a
                href={`tel:${candidate.phone}`}
                className="flex items-center gap-2 text-brand-700 hover:text-brand-800"
              >
                <Phone aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={ICON_STROKE_WIDTH} />
                <span>{candidate.phone}</span>
              </a>
            ) : null}
            {!hasContact ? (
              <p className="text-ink-600">No email or phone on file. Reach them through the platform.</p>
            ) : null}
          </div>

          {candidate.note ? (
            <p className="mt-3 rounded-lg bg-brand-50/60 p-2.5 text-xs text-ink-700">“{candidate.note}”</p>
          ) : null}

          {candidate.acceptedAt ? (
            <p className="mt-2 text-xs text-ink-500">
              Accepted {DATE_FORMATTER.format(new Date(candidate.acceptedAt))}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function PendingRow({ offer }: { offer: SentOffer }) {
  return (
    <li className="rounded-xl border border-brand-100 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink-900">Candidate</span>
        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
          Waiting for a reply
        </span>
      </div>
      {offer.note ? (
        <p className="mt-2 rounded-lg bg-brand-50/60 p-2.5 text-xs text-ink-700">“{offer.note}”</p>
      ) : null}
      <p className="mt-2 text-xs text-ink-500">
        Invited {DATE_FORMATTER.format(new Date(offer.createdAt))}
      </p>
    </li>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-brand-50 p-4 text-sm text-ink-600">{children}</p>;
}
