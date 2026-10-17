import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { EmployerApprovalResponse } from '@tetherproof/shared';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { apiServer, currentProfile } from '@/lib/server/api';
import { homeFor } from '@/lib/navigation';
import { OrganizationForm } from './OrganizationForm';

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
 * The verification state leads, because whether an invitation can be sent is
 * the one fact this page has to make obvious, and doing so needs the decision,
 * its date, and — when declined — the reason. Below it sit the two fields that
 * decision is based on, edited on request rather than always open.
 */
export default async function EmployerOrganizationPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  if (!user.capabilities.includes('employer')) redirect(homeFor(user));

  const approval = await apiServer<EmployerApprovalResponse>('/employers/approval');

  return (
    <div className="flex flex-col gap-5">
      <VerificationNotice approval={approval} />

      <Card title="Organization">
        <p className="text-sm text-ink-600">
          Candidates see your organization name on an invitation. Distance in search results is
          measured from your location, which is optional.
        </p>
        <OrganizationForm organizationName={user.organizationName} locationGps={user.locationGps} />
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
