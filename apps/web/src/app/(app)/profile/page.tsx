import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ConnectionsResponse, WorkerCapabilityProfileResponse } from '@tetherproof/shared';
import { Card } from '@/components/ui/Card';
import { signOut } from '@/lib/actions';
import { currentProfile, apiServer } from '@/lib/server/api';
import { SignOutButton } from '@/components/shell/SignOutButton';
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
 * Profile is a primary tab now, so the page carries its own heading in the
 * header and keeps the bottom navigation. It shows the details card every role
 * has (photo, name, organisation, location), open for editing on request, and
 * the worker-only record: the proven capabilities with per-skill levels and
 * verified counts, the shareable page link, and the connected work sources.
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

  let capabilities: WorkerCapabilityProfileResponse | null = null;
  let connections: ConnectionsResponse | null = null;
  if (profile.role === 'worker') {
    [capabilities, connections] = await Promise.all([
      apiServer<WorkerCapabilityProfileResponse>('/workers/capabilities').catch(() => null),
      apiServer<ConnectionsResponse>('/workers/connections').catch(() => null),
    ]);
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Card title="Your details">
        <ProfileForm
          role={profile.role}
          fullName={profile.fullName}
          organizationName={profile.organizationName}
          locationGps={profile.locationGps}
          avatarUrl={profile.avatarUrl}
        />
      </Card>

      {profile.role === 'worker' && capabilities ? (
        <Card title="Your capabilities">
          <CapabilitiesCard capabilities={capabilities} />
        </Card>
      ) : null}

      {profile.role === 'worker' ? (
        <Card title="Share your proof">
          <ShareCard enabled={profile.publicProfile} slug={profile.publicSlug} />
        </Card>
      ) : null}

      {profile.role === 'worker' && connections ? (
        <Card title="Connected sources">
          <ConnectionsCard connections={connections.connections} />
        </Card>
      ) : null}

      <Card title="Sign out">
        <p className="text-sm text-ink-600">Ends your session on this device only.</p>
        <form action={signOut} className="mt-4">
          <SignOutButton />
        </form>
      </Card>
    </div>
  );
}