import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { deleteAccount } from '@/lib/actions';
import { homeFor } from '@/lib/navigation';
import { currentProfile } from '@/lib/server/api';

export const metadata: Metadata = {
  title: 'Account — TetherProof',
};

/**
 * Where a member deletes their own account.
 *
 * Deletion is irreversible, so the page leads with what actually happens rather
 * than with the button. The retention policy is genuinely two-sided: the profile
 * and the account go, and the work stays in a form nobody is attached to. That is
 * the honest version of the promise, and stating it here is what makes the
 * confirmation mean something.
 *
 * Confirmation is a second action rather than a checkbox. A checkbox is one tap
 * past the button, so it tests willingness rather than intent, and the cost of a
 * mis-tapped irreversible deletion is somebody's entire record.
 *
 * The second step is a form containing a button and nothing else, so it is not
 * nested inside the outer form. Nested forms are invalid HTML, and a browser that
 * repairs the nesting will silently drop one of the two.
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

      <Card title="Delete your account">
        <div className="space-y-3 text-sm text-ink-600">
          <p>Your account and your profile are removed straight away. That includes your name, your contact details, and your location.</p>
          <p>
            The work you logged stays on the platform, with your name and everything that
            identifies you taken off it. We keep it because proof counts are shared: if one
            person's records vanished, the totals other people rely on would quietly change,
            and so would the reputation built on them.
          </p>
          <p>What is kept is the skill, the verification, and the date. What identifies you is not.</p>
          <p className="font-semibold text-ink-900">This cannot be undone, and there is no way to get the account back afterwards.</p>
        </div>

        {/* The two steps are siblings, not nested forms. */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <form action={deleteAccount}>
            <SubmitButton variant="danger">Delete my account</SubmitButton>
          </form>
          <Link
            href={homeFor(user.role)}
            className="inline-flex min-h-12 items-center rounded-xl px-4 font-semibold text-ink-600 hover:text-ink-900"
          >
            Keep my account
          </Link>
        </div>
      </Card>
    </div>
  );
}