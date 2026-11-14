import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { BusinessesResponse, BusinessMembersResponse, UserCapability } from '@tetherproof/shared';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { AddMemberForm } from './AddMemberForm';
import { apiServer, currentProfile } from '@/lib/server/api';
import { homeFor } from '@/lib/navigation';

export const metadata: Metadata = {
  title: 'Members — TetherProof',
};

/**
 * The employer's team screen: who may hire through their business, and how many
 * people hold that right.
 *
 * Reads only the caller's own businesses and, for each approved one, its members.
 * The roster is the owner's own decision about who may hire; it is not a directory of
 * every worker on the network.
 */
export default async function EmployerMembersPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  const held: UserCapability[] = user.capabilities;
  if (!held.includes('employer')) redirect(homeFor(user));

  const businesses: BusinessesResponse = await apiServer<BusinessesResponse>('/businesses');
  const approved = businesses.businesses.filter((b) => b.status === 'approved');

  const rosters = await Promise.all(
    approved.map(async (business) => {
      const members: BusinessMembersResponse = await apiServer<BusinessMembersResponse>(
        `/businesses/${encodeURIComponent(business.id)}/members`,
      );
      return { business, members };
    }),
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-ink-900">Members</h1>
        <p className="text-sm text-ink-600">
          People who may hire through your approved business. Adding someone grants them the same
          hiring right you hold.
        </p>
      </header>

      {rosters.length === 0 ? (
        <Banner tone="info" title="No approved business yet">
          Hire approval comes first. Until a business is approved, nobody on your team can send
          invitations.
        </Banner>
      ) : (
        <div className="flex flex-col gap-4">
          {rosters.map(({ business, members }) => (
            <Card key={business.id} title={business.name}>
              <ul className="flex flex-col gap-2">
                {members.members.map((member) => (
                  <li
                    key={member.userId}
                    className="flex items-center justify-between gap-3 rounded-xl border border-brand-100 bg-brand-50/40 px-4 py-2"
                  >
                    <span className="text-sm font-semibold text-ink-900">
                      {member.fullName?.trim() || 'Member'}
                    </span>
                    <span className="text-xs font-semibold text-ink-600">
                      {member.memberRole === 'owner' ? 'Owner' : 'Hiring'}
                    </span>
                  </li>
                ))}
              </ul>
              <AddMemberForm businessId={business.id} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
