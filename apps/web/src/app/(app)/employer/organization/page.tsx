import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { EmployerApprovalResponse } from '@tetherproof/shared';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { apiServer, currentProfile } from '@/lib/server/api';
import { ProfileForm } from '../ProfileForm';

export const metadata: Metadata = {
  title: 'Organization — TetherProof',
};

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * The employer's organization profile: the details candidates see on an
 * invitation, and the details an administrator reviews.
 *
 * The verification banner is the same fact the dashboard summarises, shown here
 * with its reason and date because this is the page where a declined employer can
 * read what to fix.
 */
export default async function EmployerOrganizationPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  if (user.role === 'worker') redirect('/dashboard');
  if (user.role !== 'employer') redirect('/pending');

  const approval = await apiServer<EmployerApprovalResponse>('/employers/approval');

  return (
    <div className="flex flex-col gap-6">
      <VerificationNotice approval={approval} />

      <Card title="Organization details">
        <p className="text-sm text-ink-600">
          This is what candidates see on an invitation, and what an administrator reviews before
          approving your organization.
        </p>
        <ProfileForm organizationName={user.organizationName} locationGps={user.locationGps} />
      </Card>
    </div>
  );
}

function VerificationNotice({ approval }: { approval: EmployerApprovalResponse }) {
  if (approval.status === 'approved') {
    return (
      <Banner tone="success" title="Organization verified">
        {approval.record.reviewedAt
          ? `Approved on ${DATE_FORMATTER.format(new Date(approval.record.reviewedAt))}. Your invitations reach candidates with your organization name attached.`
          : 'Your invitations reach candidates with your organization name attached.'}
      </Banner>
    );
  }

  if (approval.status === 'rejected') {
    return (
      <Banner tone="problem" title="Organization not approved">
        {approval.record.note?.trim() ||
          'An administrator has not approved this organization. Update the details below if something is wrong, then contact support for another review.'}
      </Banner>
    );
  }

  return (
    <Banner tone="warning" title="Approval pending">
      {approval.sending.reason?.trim() ||
        'An administrator is reviewing your organization. Searches work now; sending invitations unlocks on approval.'}
    </Banner>
  );
}
