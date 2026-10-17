import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { currentProfile } from '@/lib/server/api';
import { PrivacyForm } from './PrivacyForm';

export const metadata: Metadata = {
  title: 'Privacy — TetherProof',
};

/**
 * The worker's privacy choices, one card.
 *
 * Three controls and one honest rule each: whether employer search may surface
 * the worker, who may send an invitation, and whether a public capability page
 * exists at all. Everything the interface shows here is enforced by the API at
 * the layer that decides — search excludes undiscoverable workers, offers are
 * refused to non-approved senders, and the public endpoint answers only the
 * enabled page — so turning a toggle off is a real withdrawal, not a UI mood
 * switch.
 *
 * Worker-only: the concepts are worker concepts. An employer has no search
 * entry to be excluded from, and asking a worker-only endpoint on their behalf
 * would be a request they are not allowed to make.
 */
export default async function PrivacyPage() {
  const profile = await currentProfile();
  if (!profile) redirect('/login');
  if (!profile.capabilities.includes('worker')) redirect('/settings');

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Card title="Privacy & sharing">
        <PrivacyForm
          discoverable={profile.discoverable}
          showNameOnVerificationLink={profile.showNameOnVerificationLink}
          publicProfile={profile.publicProfile}
          publicSlug={profile.publicSlug}
          invitationPreference={profile.invitationPreference}
        />
      </Card>
    </div>
  );
}