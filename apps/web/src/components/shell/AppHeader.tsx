'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Mail, Settings } from 'lucide-react';
import type { NavItem } from '@/lib/navigation';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { menuFor, subpageTitleFor } from '@/lib/navigation';
import { BackHeader } from './BackHeader';
import { HamburgerMenu } from './HamburgerMenu';
import { PrimaryNav } from './PrimaryNav';

interface AppHeaderProps {
  /** The member's own home — what "on Home" means for this account. */
  home: string;
  items: NavItem[];
  /** Whether this account can receive invitations (workers); others see no badge. */
  showInvitations: boolean;
  /** How many invitations are waiting for an answer; drives the badge. */
  pendingInvitations: number;
}

/**
 * The header of the signed-in app, decided by where the member is standing.
 *
 * A page opened from the header menu (profile no longer counts — it is a
 * primary section now) renders the back header instead: a back icon into the
 * previous place and the page's name, with no tab row — those pages are focused
 * screens, not places to pass through. A primary section renders the section
 * title (or the brand on Home), the desktop navigation bar, and the menu of
 * secondary destinations.
 *
 * The layout is deliberately dual-shaped. On a phone the secondary screens live
 * behind the top-right hamburger and the bottom row carries the four tabs. On a
 * wide screen the tabs move up into the header as a nav bar, and the secondary
 * screens sit beside it as plain icons — an invitation inbox with its badge,
 * and settings — so a wide display does not need a hamburger to find either.
 *
 * It is a client component because "which section is this" is a question about
 * the current address, and the address only exists in the browser.
 */
export function AppHeader({
  home,
  items,
  showInvitations,
  pendingInvitations,
}: AppHeaderProps) {
  const pathname = usePathname();

  const subpageTitle = subpageTitleFor(pathname);
  if (subpageTitle) return <BackHeader home={home} />;

  const onHome = pathname === home || pathname.startsWith(`${home}/`);
  const sectionTitle = onHome
    ? null
    : pathname === '/workspace' || pathname.startsWith('/workspace/')
      ? 'Workspace'
      : pathname === '/logs' || pathname.startsWith('/logs/')
        ? 'Logs'
        : pathname === '/profile' || pathname.startsWith('/profile/')
          ? 'Profile'
          : null;

  return (
    <header className="sticky top-0 z-40 border-b border-brand-100 bg-white">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3">
        {/*
          The header is the page's one heading on a primary section: the section
          reads its own name, Home reads the app's. Keeping it as the h1 means
          every screen has exactly one, in the same place, without the page
          repeating it below.
        */}
        <h1 className="text-lg font-semibold">
          {sectionTitle ? (
            <span className="text-ink-900">{sectionTitle}</span>
          ) : (
            <Link href={home} className="tracking-wide text-brand-600 hover:text-brand-700">
              TetherProof
            </Link>
          )}
        </h1>

        <div className="hidden md:block">
          <PrimaryNav items={items} variant="bar" />
        </div>

        {/*
          Wide screens get the secondary screens as icons beside the nav bar; a
          phone gets them behind the hamburger. Setting both to the far edge
          keeps the destinations reachable from either shape without duplicating
          controls on one screen.
        */}
        <div className="relative ml-auto hidden items-center gap-1 md:flex">
          {showInvitations ? (
            <Link
              href="/invites"
              aria-label={
                pendingInvitations > 0
                  ? `Invitations, ${pendingInvitations} waiting for your answer`
                  : 'Invitations'
              }
              className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink-700 transition hover:bg-brand-50 hover:text-brand-700"
            >
              <Mail aria-hidden="true" className="h-6 w-6" strokeWidth={ICON_STROKE_WIDTH} />
              {pendingInvitations > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-semibold text-white tabular-nums"
                >
                  {pendingInvitations > 99 ? '99+' : pendingInvitations}
                </span>
              ) : null}
            </Link>
          ) : null}
          <Link
            href="/settings"
            aria-label="Settings"
            className="flex h-10 w-10 items-center justify-center rounded-full text-ink-700 transition hover:bg-brand-50 hover:text-brand-700"
          >
            <Settings aria-hidden="true" className="h-6 w-6" strokeWidth={ICON_STROKE_WIDTH} />
          </Link>
        </div>

        <HamburgerMenu items={menuFor(showInvitations)} badge={showInvitations ? pendingInvitations : 0} />
      </div>
    </header>
  );
}