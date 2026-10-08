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
 * This is a destination the navigation needed before it could be honest about
 * having one: a header offering "Profile" with no page behind it would be a link
 * to a 404. It shows the three things the API's profile actually carries that a
 * member may change — photo, name, organisation, location — in a read-only view
 * that is only opened for editing on request, so the page answers "who am I"
 * rather than presenting a form as the whole answer.
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
      <header>
        <h1 className="text-2xl font-bold text-ink-900">Your profile</h1>
        <p className="mt-2 text-ink-600">
          Your photo, your name, your organisation if you have one, and the point distances are
          measured from. Employers search on verified proof counts, so this page is about your
          account rather than about what a search returns.
        </p>
      </header>

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
        <p className="text-sm text-ink-600">
          Ends your session on this device only. Your account and your proof record stay on the
          platform, and you can sign back in whenever you need to.
        </p>
        <form action={signOut} className="mt-4">
          <SignOutButton />
        </form>
      </Card>
    </div>
  );
}
