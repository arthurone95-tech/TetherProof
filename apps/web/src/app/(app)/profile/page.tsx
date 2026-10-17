import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ConnectionsResponse, WorkerCapabilityProfileResponse } from '@tetherproof/shared';
import { Card } from '@/components/ui/Card';
import { currentProfile, apiServer } from '@/lib/server/api';
import { CapabilitiesCard } from './CapabilitiesCard';
import { ConnectionsCard } from './ConnectionsCard';
import { ProfileForm } from './ProfileForm';
import { ShareCard } from './ShareCard';

export const metadata: Metadata = {
  title: 'Profile — TetherProof',
};

/**
 * Where a member reads and edits what their account says about them, and — for
 * a worker — what the account proves.
 *
 * Opened from the account menu, so its header is a back header carrying the
 * page's name. The details card every role has is personal: a photo, a name,
 * and (for a worker) the location distances are measured from. An employer's
 * organization name and search location are not edited here because they are
 * not personal — they live on the Organization page, one source of truth for
 * what candidates and an administrator see. The rest of the page is the worker
 * record: proven capabilities, the shareable page, and the connected sources.
 *
 * The capability read and the connection read are deliberately parallel: one
 * round trip for both, and either failing on its own hides that card rather
 * than taking the page down — a missing capability list on a worker with an
 * otherwise healthy record is worse than a page that will not render over it.
 *
 * No email address, and not as an oversight: `ProfileResponse` does not carry
 * one. Identity data stays in Supabase Auth and is not duplicated into the
 * profile the interface reads, so this page cannot display an address even if
 * it wanted to.
 */
export default async function ProfilePage() {
  const profile = await currentProfile();
  if (!profile) redirect('/login');

  // Worker-only sections, and the worker's own data behind them. Capability-gated rather
  // than role-gated: the profile of somebody who is both a worker and a business owner
  // shows their work portfolio as well as their organisation, which is the whole point of
  // one account.
  const isWorker = profile.capabilities.includes('worker');
  const isEmployer = profile.capabilities.includes('employer');

  let capabilities: WorkerCapabilityProfileResponse | null = null;
  let connections: ConnectionsResponse | null = null;
  if (isWorker) {
    [capabilities, connections] = await Promise.all([
      apiServer<WorkerCapabilityProfileResponse>('/workers/capabilities').catch(() => null),
      apiServer<ConnectionsResponse>('/workers/connections').catch(() => null),
    ]);
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Card title="Your details">
        <ProfileForm
          showOrganizationName={isEmployer || profile.capabilities.includes('training_provider')}
          fullName={profile.fullName}
          organizationName={profile.organizationName}
          locationGps={profile.locationGps}
          avatarUrl={profile.avatarUrl}
        />
      </Card>

      {capabilities?.skills.length || capabilities?.verifiedTotal ? (
        <Card title="Your capabilities">
          <CapabilitiesCard capabilities={capabilities} />
        </Card>
      ) : null}

      {isWorker ? (
        <Card title="Share your proof">
          <ShareCard enabled={profile.publicProfile} slug={profile.publicSlug} />
        </Card>
      ) : null}

      {isWorker && connections ? (
        <Card title="Connected sources">
          <ConnectionsCard connections={connections.connections} />
        </Card>
      ) : null}
    </div>
  );
}