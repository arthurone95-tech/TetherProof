import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import type { ReceivedOffersResponse } from '@tetherproof/shared';
import { AppShell } from '@/components/shell/AppShell';
import { homeFor, navFor } from '@/lib/navigation';
import { apiServer, currentProfile } from '@/lib/server/api';

/**
 * The frame around every signed-in screen.
 *
 * Authentication lives here rather than being repeated by each page, so a new
 * route cannot be added without a session check by simply forgetting one — the
 * layout already redirects. Pages keep their own role checks, because those turn
 * a mismatch into a sentence rather than into an error screen, and a page is the
 * only place that knows which roles it is for.
 *
 * This is a layout rather than a repeated component on purpose: navigation is
 * then rendered once per navigation instead of once per page, and a link to a
 * screen not built yet has nowhere to be forgotten.
 */
export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const profile = await currentProfile();
  if (!profile) redirect('/login');

  return (
    <AppShell
      home={homeFor(profile.role)}
      items={navFor(profile.role)}
      showInvitations={profile.role === 'worker'}
      pendingInvitations={await pendingInvitationsFor(profile.role)}
    >
      {children}
    </AppShell>
  );
}

/**
 * How many invitations are waiting for this member's answer — the badge on
 * Home's invitation icon.
 *
 * Worker-only: invitations are sent to workers, so another role has no inbox to
 * count and asking the worker-only endpoint on their behalf would be a request
 * they are not allowed to make. A failure anywhere in the read degrades to zero
 * rather than taking the whole shell down with it — a missing badge is a quiet
 * icon, while a thrown error would be every signed-in page refusing to render
 * over a number.
 */
async function pendingInvitationsFor(role: string): Promise<number> {
  if (role !== 'worker') return 0;
  try {
    const inbox = await apiServer<ReceivedOffersResponse>('/invites/offers');
    return inbox.pendingCount;
  } catch {
    return 0;
  }
}
