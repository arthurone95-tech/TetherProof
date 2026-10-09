import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type {
  AdminEmployerListItem,
  AdminEmployersResponse,
  EmployerVerificationStatus,
} from '@tetherproof/shared';
import { Card } from '@/components/ui/Card';
import { apiServer, currentProfile } from '@/lib/server/api';
import { ApprovalForm } from './ApprovalForm';

export const metadata: Metadata = {
  title: 'Approvals — TetherProof',
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
 * The approval console.
 *
 * The queue is the page: pending accounts first, because a reviewer opening this
 * screen should land on the work rather than on decisions already made. Each
 * account carries its own decision controls, and the note an employer wrote is
 * shown alongside so a review does not require a second tab.
 *
 * Read-only apart from the decision POST it submits; the API authorizes every
 * call on its own and this page only ever sees accounts it is entitled to.
 */
export default async function AdminPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  if (user.role === 'worker') redirect('/dashboard');
  if (user.role === 'employer') redirect('/employer');
  if (user.role !== 'admin') redirect('/pending');

  const response = await apiServer<AdminEmployersResponse>('/admin/employers');
  const pending = response.employers.filter((employer) => employer.status === 'pending');
  const reviewed = response.employers.filter((employer) => employer.status !== 'pending');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-ink-900">Employer approvals</h1>
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
          <h2 id="pending-heading" className="text-xs font-bold uppercase tracking-wider text-ink-500">
            Waiting for review
          </h2>
          {pending.map((employer) => (
            <EmployerReviewCard key={employer.employerId} employer={employer} />
          ))}
        </section>
      ) : null}

      {reviewed.length > 0 ? (
        <section aria-labelledby="reviewed-heading" className="flex flex-col gap-3">
          <h2 id="reviewed-heading" className="text-xs font-bold uppercase tracking-wider text-ink-500">
            Reviewed
          </h2>
          {reviewed.map((employer) => (
            <EmployerReviewCard key={employer.employerId} employer={employer} />
          ))}
        </section>
      ) : null}
    </div>
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
