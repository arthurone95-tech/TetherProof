import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { currentProfile } from '@/lib/server/api';
import { ProfileForm } from './ProfileForm';

export const metadata: Metadata = {
  title: 'Profile — TetherProof',
};

/**
 * Where a member edits what their account says about them.
 *
 * This is a destination the navigation needed before it could be honest about
 * having one: a header offering "Profile" with no page behind it would be a link
 * to a 404. It holds the three things the API's profile actually carries that a
 * member may change — name, organisation, location — and nothing else.
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
          Your name, your organisation if you have one, and the point distances are measured
          from. Employers search on verified proof counts, so this page is about your account
          rather than about what a search returns.
        </p>
      </header>

      <Card title="Your details">
        <ProfileForm
          role={profile.role}
          fullName={profile.fullName}
          organizationName={profile.organizationName}
          locationGps={profile.locationGps}
        />
      </Card>
    </div>
  );
}
