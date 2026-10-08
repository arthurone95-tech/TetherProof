import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { signOut } from '@/lib/actions';
import { currentProfile } from '@/lib/server/api';
import { SignOutButton } from '@/components/shell/SignOutButton';
import { ProfileForm } from './ProfileForm';

export const metadata: Metadata = {
  title: 'Profile — TetherProof',
};

/**
 * Where a member reads and edits what their account says about them.
 *
 * Opened from More, so the header shows a back icon and "Profile" — the page
 * itself carries no heading of its own. It shows the three things the API's
 * profile actually carries that a member may change — photo, name,
 * organisation, location — in a read-only view that is only opened for editing
 * on request, so the page answers "who am I" rather than presenting a form as
 * the whole answer.
 *
 * No email address, and not as an oversight: `ProfileResponse` does not carry one.
 * Identity data stays in Supabase Auth and is not duplicated into the profile the
 * interface reads, so this page cannot display an address even if it wanted to.
 */
export default async function ProfilePage() {
  const profile = await currentProfile();
  if (!profile) redirect('/login');

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

      <Card title="Sign out">
        <p className="text-sm text-ink-600">Ends your session on this device only.</p>
        <form action={signOut} className="mt-4">
          <SignOutButton />
        </form>
      </Card>
    </div>
  );
}
