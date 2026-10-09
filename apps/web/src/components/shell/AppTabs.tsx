'use client';

import { usePathname } from 'next/navigation';
import type { NavItem } from '@/lib/navigation';
import { subpageTitleFor } from '@/lib/navigation';
import { PrimaryNav } from './PrimaryNav';

/**
 * The phone's bottom tab row.
 *
 * It exists only on the primary sections (Home, Work, Logs, Invitations). A page
 * opened from the header menu has no tab row: those screens are read one at a
 * time, and a bar offering three other destinations under an invitation you are
 * deciding about is an invitation to leave mid-decision. The row returns the
 * moment the member is back on a primary section, so the app's frame stays
 * where they expect it.
 *
 * The invitations tab carries the waiting count, which used to sit on a header
 * icon: the badge is in the bar a thumb already rests on, so it is seen on the
 * way past rather than only when the member looks up.
 *
 * Client-side because the decision is about the current address.
 */
export function AppTabs({
  items,
  pendingInvitations,
}: {
  items: NavItem[];
  /** Invitations waiting for an answer; badges the Invitations tab. */
  pendingInvitations: number;
}) {
  const pathname = usePathname();
  if (subpageTitleFor(pathname)) return null;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-brand-100 bg-white md:hidden"
    >
      <PrimaryNav
        items={items}
        variant="tabs"
        badge={{ href: '/invites', count: pendingInvitations }}
      />
    </nav>
  );
}
