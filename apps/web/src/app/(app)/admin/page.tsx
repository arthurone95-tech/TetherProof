import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type {
  AdminBusinessesResponse,
  AdminProofReviewItem,
  AdminProofReviewResponse,
} from '@tetherproof/shared';
import { Card } from '@/components/ui/Card';
import { apiServer, currentProfile } from '@/lib/server/api';
import { homeFor } from '@/lib/navigation';
import { AdminBusinessRow } from './AdminBusinessRow';
import { ProofReviewForm } from './ProofReviewForm';

export const metadata: Metadata = {
  title: 'Review — TetherProof',
};

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});


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
  if (!user.isAdmin) redirect(homeFor(user));

  const [reviews, businesses] = await Promise.all([
    apiServer<AdminProofReviewResponse>('/admin/proof-review'),
    apiServer<AdminBusinessesResponse>('/admin/businesses').catch(() => ({ businesses: [] })),
  ]);

  // Undecided work first, then anything a reviewer has already ruled on, so the
  // queue never buries the record that is waiting on a person under the ones that
  // are not.
  const openReviews = reviews.items.filter((item) => item.verificationStatus === 'flagged');
  const closedReviews = reviews.items.filter((item) => item.verificationStatus !== 'flagged');

  return (
    <div className="flex flex-col gap-8">
      {businesses.businesses.length > 0 ? (
        <section aria-labelledby="business-heading" className="flex flex-col gap-4">
          <header className="flex flex-col gap-1">
            <h1 id="business-heading" className="text-2xl font-bold text-ink-900">
              Business approvals
            </h1>
            <p className="text-sm text-ink-600">
              Hiring runs through an approved business. Approving one grants its owner the
              employer capability; rejecting or queuing one takes it away again unless they
              run another approved business.
            </p>
          </header>
          <ul className="flex flex-col gap-2">
            {businesses.businesses.map((business) => (
              <AdminBusinessRow key={business.id} business={business} />
            ))}
          </ul>
        </section>
      ) : (
        <Card>
          <p className="text-sm text-ink-600">No businesses are waiting for review.</p>
        </Card>
      )}

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

