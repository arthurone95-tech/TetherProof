import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type {
  AdminEmployerListItem,
  AdminEmployersResponse,
  AdminProofReviewItem,
  AdminProofReviewResponse,
  EmployerVerificationStatus,
} from '@tetherproof/shared';
import { Card } from '@/components/ui/Card';
import { apiServer, currentProfile } from '@/lib/server/api';
import { ApprovalForm } from './ApprovalForm';
import { ProofReviewForm } from './ProofReviewForm';

export const metadata: Metadata = {
  title: 'Review — TetherProof',
};

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const STATUS_STYLES: Record<EmployerVerificationStatus, { label: string; chip: string }> = {
  pending: { label: 'Pending', chip: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Approved', chip: 'bg-emerald-100 text-emerald-800' },
  rejected: { label: 'Rejected', chip: 'bg-red-100 text-red-800' },
};

/**
 * The review console.
 *
 * Two queues, in the order a reviewer should work them. Employer approvals come
 * first because they gate a stranger's outbound contact, and they are the oldest
 * thing waiting. The proof-review queue comes second because it decides whether
 * someone's recorded work counts at all.
 *
 * Every card carries its own decision controls and enough context to decide
 * without a second tab. Read-only apart from the decision POSTs it submits; the
 * API authorizes every call on its own and this page only ever sees what it is
 * entitled to.
 */
export default async function AdminPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  if (user.role === 'worker') redirect('/dashboard');
  if (user.role === 'employer') redirect('/employer');
  if (user.role !== 'admin') redirect('/pending');

  const [response, reviews] = await Promise.all([
    apiServer<AdminEmployersResponse>('/admin/employers'),
    apiServer<AdminProofReviewResponse>('/admin/proof-review'),
  ]);

  const pending = response.employers.filter((employer) => employer.status === 'pending');
  const reviewed = response.employers.filter((employer) => employer.status !== 'pending');

  // Undecided work first, then anything a reviewer has already ruled on, so the
  // queue never buries the record that is waiting on a person under the ones that
  // are not.
  const openReviews = reviews.items.filter((item) => item.verificationStatus === 'flagged');
  const closedReviews = reviews.items.filter((item) => item.verificationStatus !== 'flagged');

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="employer-heading" className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 id="employer-heading" className="text-2xl font-bold text-ink-900">
            Employer approvals
          </h1>
          <p className="text-sm text-ink-600">
            {pending.length > 0
              ? `${pending.length} ${pending.length === 1 ? 'organization is' : 'organizations are'} waiting for a decision.`
              : 'No organizations are waiting for a decision.'}
          </p>
        </header>

        {response.employers.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-600">No employer accounts have registered yet.</p>
          </Card>
        ) : null}

        {pending.length > 0 ? (
          <section aria-labelledby="pending-heading" className="flex flex-col gap-3">
            <h2
              id="pending-heading"
              className="text-xs font-bold uppercase tracking-wider text-ink-500"
            >
              Waiting for review
            </h2>
            {pending.map((employer) => (
              <EmployerReviewCard key={employer.employerId} employer={employer} />
            ))}
          </section>
        ) : null}

        {reviewed.length > 0 ? (
          <section aria-labelledby="reviewed-heading" className="flex flex-col gap-3">
            <h2
              id="reviewed-heading"
              className="text-xs font-bold uppercase tracking-wider text-ink-500"
            >
              Reviewed
            </h2>
            {reviewed.map((employer) => (
              <EmployerReviewCard key={employer.employerId} employer={employer} />
            ))}
          </section>
        ) : null}
      </section>

      <section aria-labelledby="proofs-heading" className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 id="proofs-heading" className="text-2xl font-bold text-ink-900">
            Withheld work records
          </h1>
          <p className="text-sm text-ink-600">
            {openReviews.length > 0
              ? `${openReviews.length} ${openReviews.length === 1 ? 'record is' : 'records are'} held back from counting as proof.`
              : 'No records are being held back.'}
          </p>
          <p className="max-w-2xl text-sm text-ink-600">
            The trust engine holds a record when its signals do not agree. It does not
            decide that anyone is lying — every record here is withheld, not accused.
            Restoring one puts the work back on the worker&rsquo;s record; upholding one
            is the only way a record is ever marked fraudulent, and the decision is
            recorded against your account.
          </p>
        </header>

        {reviews.items.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-600">
              No work records are being held back right now.
            </p>
          </Card>
        ) : null}

        {openReviews.length > 0 ? (
          <section aria-labelledby="open-proofs-heading" className="flex flex-col gap-3">
            <h2
              id="open-proofs-heading"
              className="text-xs font-bold uppercase tracking-wider text-ink-500"
            >
              Waiting for a decision
            </h2>
            {openReviews.map((item) => (
              <ProofReviewCard key={item.proofId} item={item} />
            ))}
          </section>
        ) : null}

        {closedReviews.length > 0 ? (
          <section aria-labelledby="closed-proofs-heading" className="flex flex-col gap-3">
            <h2
              id="closed-proofs-heading"
              className="text-xs font-bold uppercase tracking-wider text-ink-500"
            >
              Already decided
            </h2>
            {closedReviews.map((item) => (
              <ProofReviewCard key={item.proofId} item={item} />
            ))}
          </section>
        ) : null}
      </section>
    </div>
  );
}

/**
 * One withheld record, as a reviewer sees it.
 *
 * The engine's score is shown here and nowhere else. The worker is told what kind
 * of thing raised the record, in words they can act on, and never a number — but a
 * reviewer deciding whether to uphold needs the number, and hiding it from the
 * person with the authority to overrule would be the opposite of accountable.
 */
function ProofReviewCard({ item }: { item: AdminProofReviewItem }) {
  const appealed = item.reviewStatus === 'appealed' || item.reviewStatus === 'under_review';
  const decided = item.reviewStatus === 'upheld' || item.reviewStatus === 'overturned';

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-ink-900">
            {item.skillTag ?? 'Uncategorised work'}
          </p>
          <p className="mt-1 text-sm text-ink-700">{item.description}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
            item.verificationStatus === 'flagged'
              ? 'bg-amber-100 text-amber-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {item.verificationStatus === 'flagged' ? 'Held' : 'Blocked'}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-600 sm:grid-cols-4">
        <div>
          <dt className="font-semibold text-ink-700">Client said</dt>
          <dd>{item.clientResponse ?? 'not recorded'}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink-700">Engine score</dt>
          <dd>{item.fraudScore === null ? 'not scored' : item.fraudScore.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink-700">Held since</dt>
          <dd>{item.flaggedAt ? DATE_FORMATTER.format(new Date(item.flaggedAt)) : 'unknown'}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink-700">Worker asked</dt>
          <dd>
            {appealed ? 'yes' : decided ? 'after the decision' : 'not yet'}
          </dd>
        </div>
      </dl>

      {item.flagReason ? (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          The worker was told: {item.flagReason}
        </p>
      ) : null}

      {decided ? (
        <p className="mt-3 text-sm font-medium text-ink-700">
          {item.reviewStatus === 'overturned'
            ? 'Reviewed and restored. This record counts toward the worker again.'
            : 'Reviewed and upheld. The record stays withheld from counting as proof.'}
        </p>
      ) : (
        <ProofReviewForm proofId={item.proofId} />
      )}
    </Card>
  );
}

function EmployerReviewCard({ employer }: { employer: AdminEmployerListItem }) {
  const status = STATUS_STYLES[employer.status];

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-ink-900">
            {employer.organizationName?.trim() || 'Unnamed organization'}
          </p>
          <p className="text-sm text-ink-600">
            {employer.contactName?.trim() || 'No contact name'} · registered{' '}
            {DATE_FORMATTER.format(new Date(employer.registeredAt))}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.chip}`}>
          {status.label}
        </span>
      </div>

      {employer.reviewedAt ? (
        <p className="mt-2 text-xs text-ink-500">
          Last reviewed {DATE_FORMATTER.format(new Date(employer.reviewedAt))}
          {employer.note?.trim() ? ` · “${employer.note}”` : ''}
        </p>
      ) : null}

      <ApprovalForm employerId={employer.employerId} />
    </Card>
  );
}
