import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight, ShieldCheck, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { currentProfile } from '@/lib/server/api';
import { ProfileForm } from './ProfileForm';

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
 * record: the capability section and the account's privacy and deletion choices.
 *
 * Privacy and deletion sit here rather than behind Settings because for a
 * worker there is nothing else in Settings, and a separate destination for two
 * rows made both harder to find than a section on the page they already open.
 * Every other workspace keeps Settings untouched; this page is the worker's one
 * place for them.
 *
 * The capability card is kept as a section with no contents for now. It used to
 * read `GET /workers/capabilities` and render one row per skill; that read is
 * gone, and what replaces it is an open decision. The section stays because an
 * empty card is a slot the reader recognises, while a missing card reads as a
 * feature the account never had.
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

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Card title="Your details">
        <ProfileForm
          showOrganizationName={isEmployer || profile.capabilities.includes('training_provider')}
          fullName={profile.fullName}
          locationGps={profile.locationGps}
          avatarUrl={profile.avatarUrl}
        />
      </Card>

      {/*
        A section that is deliberately empty. Nothing is read for it and nothing
        is rendered inside — what belongs here is an open decision, and a
        placeholder that pretended to show something would be worse than none.
      */}
      {isWorker ? (
        <Card title="Your capabilities">
          <></>
        </Card>
      ) : null}

      {isWorker ? (
        <Card title="Privacy & sharing">
          <p className="text-sm text-ink-600">
            Choose who can find you, who may invite you, what appears on your profile, and
            whether your verified skills have a shareable page.
          </p>
          <Link
            href="/settings/privacy"
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-brand-600 px-4 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
          >
            <ShieldCheck aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
            Manage privacy
          </Link>
        </Card>
      ) : null}

      {/*
        Last on the page on purpose: deletion is the one action here that cannot
        be undone, so it sits below everything the account is and keeps its own
        heading and colour rather than reading as one more row.
      */}
      {isWorker ? (
        <section aria-labelledby="danger-heading" className="flex flex-col gap-3">
          <h2
            id="danger-heading"
            className="px-1 text-xs font-bold tracking-wider text-ink-500 uppercase"
          >
            Danger zone
          </h2>
          <Link
            href="/settings/account"
            className="flex items-center gap-3 rounded-2xl border border-red-200 bg-white p-4 transition-colors hover:border-red-500"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700">
              <Trash2 aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-red-800">Delete account</span>
              <span className="block text-sm text-ink-600">
                Remove your account and start its data cleanup. This cannot be undone.
              </span>
            </span>
            <ChevronRight
              aria-hidden="true"
              className="h-5 w-5 shrink-0 text-red-700"
              strokeWidth={ICON_STROKE_WIDTH}
            />
          </Link>
        </section>
      ) : null}
    </div>
  );
}
