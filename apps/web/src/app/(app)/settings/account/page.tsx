import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Banner } from '@/components/ui/Banner';
import { currentProfile } from '@/lib/server/api';
import { DeleteAccountView } from './DeleteAccountView';

export const metadata: Metadata = {
  title: 'Settings — TetherProof',
};

/**
 * Where a member deletes their own account.
 *
 * Opened from More, so the header shows a back icon and "Settings" and the page
 * carries no heading of its own. The page itself stays thin on purpose: it
 * checks who is signing in, surfaces a failed deletion if one was just
 * attempted, and hands the rest to `DeleteAccountView`. The explanation of what
 * deletion means is a confirmation step, not a pre-read section — see that
 * component for why. No email address appears here, and not as an oversight:
 * `ProfileResponse` does not carry one — identity data stays in Supabase Auth
 * and is not duplicated into the profile the interface reads.
 */
export default async function AccountSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentProfile();
  if (!user) redirect('/login');

  const { error } = await searchParams;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      {error ? <Banner tone="problem" title="Account not deleted">{error}</Banner> : null}

      <DeleteAccountView />
    </div>
  );
}