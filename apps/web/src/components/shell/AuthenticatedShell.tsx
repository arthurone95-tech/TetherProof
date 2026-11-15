'use client';

import { useEffect, useState } from 'react';
import type { UserCapability } from '@tetherproof/shared';
import type { ProfileResponse } from '@tetherproof/shared';
import { AppShell } from './AppShell';
import { navFor, workspacesFor, WORKSPACES } from '@/lib/navigation';
import { getPendingInvitationsAction, getUnreadNotificationsAction } from '@/lib/actions';

/**
 * The signed-in shell, rendered without blocking on secondary data.
 *
 * `AuthenticatedLayout` awaits only `currentProfile()` (the auth gate), then hands
 * the profile to this client component. This component paints immediately with
 * sensible defaults — the first held capability as the active workspace and zero
 * badges — then fetches invitation and notification counts client-side and re-renders.
 *
 * The page's `children` are never held up by shell badge round-trips.
 */
interface AuthenticatedShellProps {
  profile: ProfileResponse;
  children: React.ReactNode;
}

export function AuthenticatedShell({ profile, children }: AuthenticatedShellProps) {
  const [pendingInvitations, setPendingInvitations] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [activeRole, setActiveRole] = useState<UserCapability | null>(null);

  // Compute the active role from the address and capabilities, without any server
  // round-trip. The address wins when it names a workspace; otherwise the first
  // held capability is the opening position. This mirrors the server's
  // `resolveActiveRole` minus the httpOnly stored-role cookie, which the client
  // cannot read.
  const capabilities = profile.capabilities;
  const ORDER: UserCapability[] = ['worker', 'employer', 'training_provider', 'trainee'];

  function workspaceForPath(pathname: string): UserCapability | null {
    let best: { id: UserCapability; length: number } | null = null;
    for (const id of ORDER) {
      const href = WORKSPACES[id].href;
      if (pathname === href || pathname.startsWith(`${href}/`)) {
        if (!best || href.length > best.length) best = { id, length: href.length };
      }
    }
    return best?.id ?? null;
  }

  // Resolve immediately on mount from the current address.
  if (typeof window !== 'undefined') {
    const fromPath = workspaceForPath(window.location.pathname);
    const initial = (fromPath && capabilities.includes(fromPath)) ? fromPath
      : ORDER.find((id) => capabilities.includes(id)) ?? null;
    setActiveRole(initial);
  }

  // Fetch secondary badge data client-side so the shell is not blocked. Failures
  // degrade to zero — a missing badge is a quiet icon, not a broken page.
  useEffect(() => {
    let mounted = true;
    getPendingInvitationsAction().then((count) => {
      if (mounted) setPendingInvitations(count);
    });
    getUnreadNotificationsAction().then((count) => {
      if (mounted) setUnreadNotifications(count);
    });
    return () => { mounted = false; };
  }, []);

  const held = workspacesFor(capabilities);
  const primary = activeRole ? held.find((w) => w.id === activeRole) : held[0];
  const home = primary ? primary.href : '/roles';
  const items = navFor({ capabilities, active: activeRole });

  return (
    <AppShell
      home={home}
      items={items}
      capabilities={capabilities}
      activeRole={activeRole ?? null}
      account={{
        name: profile.fullName,
        subtitle: profile.organizationName?.trim() || profile.capabilities.map(c =>
          c.charAt(0).toUpperCase() + c.slice(1)
        ).join(' · '),
        avatarUrl: profile.avatarUrl,
      }}
      showNotifications={capabilities.length > 0}
      pendingInvitations={pendingInvitations}
      unreadNotifications={unreadNotifications}
    >
      {children}
    </AppShell>
  );
}
