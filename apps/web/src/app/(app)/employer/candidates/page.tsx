import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Mail, Phone } from 'lucide-react';
import type {
  AcceptedCandidate,
  AcceptedCandidatesResponse,
  SentOffer,
  SentOffersResponse,
} from '@tetherproof/shared';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { apiServer, currentProfile } from '@/lib/server/api';

export const metadata: Metadata = {
  title: 'Candidates — TetherProof',
};

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * The employer's invitations and the people who answered them.
 *
 * The accepted section is the one place contact details appear, and it only ever
 * contains workers who chose to be contacted by accepting: the reveal is the
 * thing an acceptance buys, not a setting an employer can flip. Pending
 * invitations stay masked, and a decline reveals nothing beyond the fact of the
 * decline — identity flows one way, and only after agreement.
 */
export default async function EmployerCandidatesPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  if (user.role === 'worker') redirect('/dashboard');
  if (user.role !== 'employer') redirect('/pending');

  const [acceptedResponse, sentResponse] = await Promise.all([
    apiServer<AcceptedCandidatesResponse>('/employers/candidates'),
    apiServer<SentOffersResponse>('/employers/offers'),
  ]);

  const accepted = acceptedResponse.candidates;
  const pending = sentResponse.offers.filter((offer) => offer.status === 'pending');
  const declinedCount = sentResponse.offers.filter((offer) => offer.status === 'declined').length;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-ink-600">
        Invitations you have sent and the candidates who answered. Contact details unlock the moment a
        candidate accepts.
      </p>

      <Card title={`Accepted candidates${accepted.length > 0 ? ` (${accepted.length})` : ''}`}>
        {accepted.length === 0 ? (
          <EmptyState>
            No one has accepted an invitation yet. When a candidate does, their name and contact
            details appear here.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {accepted.map((candidate) => (
              <AcceptedRow key={candidate.offerId} candidate={candidate} />
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Awaiting a reply${pending.length > 0 ? ` (${pending.length})` : ''}`}>
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
          <p className="mt-4 rounded-xl bg-neutral-50 p-3 text-xs text-ink-600">
            {declinedCount} {declinedCount === 1 ? 'invitation was' : 'invitations were'} declined.
          </p>
        ) : null}
      </Card>

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

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-brand-50 p-4 text-sm text-ink-600">{children}</p>;
}
