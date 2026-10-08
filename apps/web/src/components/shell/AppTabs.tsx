'use client';

import { usePathname } from 'next/navigation';
import type { NavItem } from '@/lib/navigation';
import { subpageTitleFor } from '@/lib/navigation';
import { PrimaryNav } from './PrimaryNav';

/**
 * The phone's bottom tab row.
 *
 * It exists only on the primary sections (Home, Workspace, Logs, More). A page
 * opened from More has no tab row: those screens are read one at a time, and a
 * bar offering three other destinations under an invitation you are deciding
 * about is an invitation to leave mid-decision. The row returns the moment the
 * member is back on a primary section, so the app's frame stays where they
 * expect it.
 *
 * Client-side because the decision is about the current address.
 */
export function AppTabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  if (subpageTitleFor(pathname)) return null;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-brand-100 bg-white md:hidden"
    >
      <PrimaryNav items={items} variant="tabs" />
    </nav>
  );
}
