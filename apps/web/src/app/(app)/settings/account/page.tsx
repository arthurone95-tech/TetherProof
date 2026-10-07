import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Banner } from '@/components/ui/Banner';
import { currentProfile } from '@/lib/server/api';
import { DeleteAccountView } from './DeleteAccountView';

export const metadata: Metadata = {
  title: 'Account — TetherProof',
};

/**
 * Where a member deletes their own account.
 *
 * The page itself stays thin on purpose: it checks who is signing in, surfaces a
 * failed deletion if one was just attempted, and hands the rest to
 * `DeleteAccountView`. The explanation of what deletion means is a confirmation
 * step, not a pre-read section — see that component for why.
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
      <header>
        <h1 className="text-2xl font-bold text-ink-900">Your account</h1>
        {/*
          No email address here, and not as an oversight: `ProfileResponse` does not
          carry one. Identity data stays in Supabase Auth and is not duplicated into
          the profile the interface reads, so this page cannot display an address even
          if it wanted to. That is the same rule as everywhere else in the app.
        */}
        <p className="mt-2 text-ink-600">
          Signed in as {user.fullName ?? user.role}.
          {user.organizationName ? ` ${user.organizationName}.` : null}
        </p>
      </header>

      {error ? <Banner tone="problem" title="Account not deleted">{error}</Banner> : null}

      <DeleteAccountView />
    </div>
  );
}