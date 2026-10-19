import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { ConnectionsResponse } from '@tetherproof/shared';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { apiServer, currentProfile } from '@/lib/server/api';
import { ConnectionsCard } from './ConnectionsCard';
import { LinkConnections } from './LinkConnections';

export const metadata: Metadata = {
  title: 'Connect — TetherProof',
};

/**
 * Connect: everything this account is linked to, in one place.
 *
 * ## Why it is a destination rather than a section of Profile
 *
 * Profile is who you are — your name, your photo, your location, the proof you have built.
 * Connect is what you have linked to, which is a different question with a different shape:
 * it is a list that grows, it has to say clearly which entries actually work, and it is
 * something you manage repeatedly rather than fill in once. Filing it under Profile buried
 * it, and put "you" in the bottom navigation doing a job it was not named for.
 *
 * ## The three states are kept visibly different
 *
 * The list below is deliberately built from a single table with a `kind` discriminator, so
 * adding an integration is one row and not a redesign:
 *
 * | kind | what it does | shown as |
 * |---|---|---|
 * | `oauth` | a real, working integration. Reads data, connects, disconnects. | Connect / Disconnect |
 * | `link` | a URL you give us. We store it and show it. No API, no sync. | Add a link |
 * | `soon` | named, not built. Shown so the roadmap is visible. | "Not available yet", inert |
 *
 * **Nothing in `soon` is clickable and nothing claims to be connected.** An integration
 * presented as working when there is no OAuth flow, no token and no API behind it is worse
 * than an absent one, because a person will rely on it and build something on the promise.
 * Only `github` is `oauth` today, because only GitHub has a working flow in this codebase.
 */
export default async function ConnectPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');

  // A failure here must not take the whole page down: links are still usable without it.
  const response = await apiServer<ConnectionsResponse>('/workers/connections').catch(() => ({
    connections: [],
  }));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Link
        href="/dashboard"
        className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-ink-900"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
        Back
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-ink-900">Connect</h1>
        <p className="text-sm text-ink-600">
          Link your work to this account so an employer can see it without taking your word
          for it.
        </p>
      </header>

      <ConnectionsCard connections={response.connections} />

      <LinkConnections />

      {/*
        Your profile itself is not here on purpose. It is reached from the avatar in the
        header, and it is about who you are rather than what you have linked.
      */}
      <p className="text-xs text-ink-600">
        Looking to change your name, photo or location?{' '}
        <Link href="/profile" className="font-semibold text-brand-700 hover:text-brand-800">
          That is in your profile →
        </Link>
      </p>
    </div>
  );
}