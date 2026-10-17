import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { capabilityLabel, homeFor, navFor } from '@/lib/navigation';
import { currentProfile } from '@/lib/server/api';
import { getInvitationInbox, getNotifications } from '@/lib/server/shell-data';

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

  const [pendingInvitations, unreadNotifications] = await Promise.all([
    // Both badges are capability-gated rather than role-gated, because the person who
    // receives an invitation is a worker and the person who sent one is an employer — and
    // somebody who is both now has both, which the old single-role check could not
    // express at all.
    profile.capabilities.includes('worker') ? pendingInvitationsFor('worker') : 0,
    profile.capabilities.length > 0 ? unreadNotificationsFor('worker') : 0,
  ]);

  return (
    <AppShell
      home={homeFor(profile)}
      items={navFor(profile)}
      // Both switchers need the full set, including capabilities not yet held: tapping one
      // is how somebody finds out there is something to set up.
      capabilities={profile.capabilities}
      account={{
        name: profile.fullName,
        // No email on `ProfileResponse` by design: the organisation if there is
        // one, otherwise what the person can do. A Kojo who is an electrician, a student
        // and a business owner should not be labelled by whichever check ran first.
        subtitle:
          profile.organizationName?.trim() || capabilityLabel(profile.capabilities),
        avatarUrl: profile.avatarUrl,
      }}
      showNotifications={profile.capabilities.length > 0}
      pendingInvitations={pendingInvitations}
      unreadNotifications={unreadNotifications}
    >
      {children}
    </AppShell>
  );
}

/**
 * How many invitations are waiting for this member's answer — the badge on the
 * Invitations tab.
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
    const inbox = await getInvitationInbox();
    return inbox.pendingCount;
  } catch {
    return 0;
  }
}

/**
 * How many notifications this member has not seen — the badge on the header's
 * bell.
 *
 * Workers and employers both have a feed now. This reads the whole feed to take
 * one number from it, on every signed-in render; a dedicated
 * `GET /notifications/unread-count` returning `{ unreadCount }` would make this
 * a one-field read, and is a drop-in replacement for the call below. As with
 * invitations, any failure degrades to zero rather than taking the shell down.
 */
async function unreadNotificationsFor(role: string): Promise<number> {
  if (role !== 'worker' && role !== 'employer') return 0;
  try {
    const feed = await getNotifications();
    return feed.unreadCount;
  } catch {
    return 0;
  }
}
