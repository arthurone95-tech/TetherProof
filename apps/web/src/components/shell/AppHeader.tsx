'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, type LucideIcon } from 'lucide-react';
import type { NavItem } from '@/lib/navigation';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { subpageTitleFor } from '@/lib/navigation';
import { AccountMenu, type AccountSummary } from './AccountMenu';
import { BackHeader } from './BackHeader';
import { PrimaryNav } from './PrimaryNav';

interface AppHeaderProps {
  /** The member's own home — what "on Home" means for this account. */
  home: string;
  items: NavItem[];
  /** Who is signed in: drives the avatar and the top of the account menu. */
  account: AccountSummary;
  /** Whether this account has an inbox (workers); others see no notification icon. */
  showInvitations: boolean;
  /** How many notifications the member has not seen; drives the badge. */
  unreadNotifications: number;
}

/**
 * The header of the signed-in app, decided by where the member is standing.
 *
 * A page opened from the account menu or an inbox icon renders the back header
 * instead: a back icon into the previous place and the page's name, with no tab
 * row — those pages are focused screens, not places to pass through. A primary
 * section renders the section title (or the brand on Home), the desktop
 * navigation bar, and the member's controls at the far edge.
 *
 * Those controls are the same on every screen width: Notifications as its own
 * icon with a badge (a worker passing through any screen sees that something
 * arrived without opening anything), then the avatar, which opens the account
 * menu. The tabs move between the header (wide) and the bottom row (phone); the
 * controls do not.
 *
 * Invitations are not here. They are a tab now — the waiting count is the one
 * number worth interrupting a glance for, and a badge in the bar a thumb already
 * rests on is met more often than one across the screen. With Profile in the
 * account menu, the header had become the place everything ended up, and two of
 * its icons answered questions the tab row or the menu already answered.
 *
 * It is a client component because "which section is this" is a question about
 * the current address, and the address only exists in the browser.
 */
export function AppHeader({
  home,
  items,
  account,
  showInvitations,
  unreadNotifications,
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
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-2.5">
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

        <div className="ml-auto flex items-center gap-0.5 md:gap-1">
          {showInvitations ? (
            <HeaderIconLink
              href="/notifications"
              icon={Bell}
              count={unreadNotifications}
              label={
                unreadNotifications > 0
                  ? `Notifications, ${unreadNotifications} unread`
                  : 'Notifications'
              }
            />
          ) : null}
          <AccountMenu account={account} />
        </div>
      </div>
    </header>
  );
}

interface HeaderIconLinkProps {
  href: string;
  icon: LucideIcon;
  label: string;
  count: number;
}

/** An icon-only link in the header, with a count badge when something is waiting. */
function HeaderIconLink({ href, icon: Icon, label, count }: HeaderIconLinkProps) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="relative flex h-11 w-11 items-center justify-center rounded-full text-ink-700 transition-colors hover:bg-brand-50 hover:text-brand-700 md:h-10 md:w-10"
    >
      <Icon aria-hidden="true" className="h-6 w-6" strokeWidth={ICON_STROKE_WIDTH} />
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute top-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-semibold text-white tabular-nums ring-2 ring-white"
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}
