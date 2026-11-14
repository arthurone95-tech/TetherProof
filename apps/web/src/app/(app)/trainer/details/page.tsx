import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { currentProfile } from '@/lib/server/api';
import { homeFor } from '@/lib/navigation';
import { InstituteDetailsForm } from './InstituteDetailsForm';

export const metadata: Metadata = {
  title: 'Institute details — TetherProof',
};

export default async function InstituteDetailsPage() {
  const profile = await currentProfile();
  if (!profile) redirect('/login');
  if (!profile.capabilities.includes('training_provider')) redirect(homeFor(profile));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Card title="Institute details">
        <p className="text-sm text-ink-600">
          The name that appears on every credential you sign, and your own name beside it.
        </p>
        <InstituteDetailsForm
          fullName={profile.fullName}
          organizationName={profile.organizationName}
        />
      </Card>
    </div>
  );
}
