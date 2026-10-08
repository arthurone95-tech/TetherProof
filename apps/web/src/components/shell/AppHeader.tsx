'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Mail } from 'lucide-react';
import type { NavItem } from '@/lib/navigation';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { subpageTitleFor } from '@/lib/navigation';
import { BackHeader } from './BackHeader';
import { PrimaryNav } from './PrimaryNav';

interface AppHeaderProps {
  /** The member's own home — what "on Home" means for this account. */
  home: string;
  items: NavItem[];
  /** Whether this account can receive invitations (workers); others see no icon. */
  showInvitations: boolean;
  /** How many invitations are waiting for an answer; drives the badge. */
  pendingInvitations: number;
}

/**
 * The header of the signed-in app, decided by where the member is standing.
 *
 * A page opened from More (profile, invitations, settings) renders the back
 * header instead: a back icon into More and the page's name, with no tab row —
 * those pages are focused screens, not places to pass through. A primary
 * section renders the section's own title in place of the brand: Home and More
 * read "TetherProof", Workspace and Logs read their section name, so the header
 * says which part of the app is on screen rather than repeating the app's name
 * everywhere.
 *
 * The top-right corner is only used on Home, and only for a worker: the
 * invitation icon with a badge counting invitations not yet answered. The count
 * comes from the server-rendered shell, so no client fetch runs on every page,
 * and an unanswered invitation is the one thing worth interrupting a glance for.
 * Everywhere else the corner stays empty — navigation lives in the tab row and
 * the section title, not in an icon.
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
  if (subpageTitle) return <BackHeader />;

  const onHome = pathname === home || pathname.startsWith(`${home}/`);
  const sectionTitle = onHome
    ? null
    : pathname === '/workspace' || pathname.startsWith('/workspace/')
      ? 'Workspace'
      : pathname === '/logs' || pathname.startsWith('/logs/')
        ? 'Logs'
        : null;

  return (
    <header className="sticky top-0 z-40 border-b border-brand-100 bg-white">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3">
        {/*
          The header is the page's one heading on a primary section: the section
          reads its own name, Home and More read the app's. Keeping it as the
          h1 means every screen has exactly one, in the same place, without the
          page repeating it below.
        */}
        <h1 className="text-lg font-semibold">
          {sectionTitle ? (
            <span className="text-ink-900">{sectionTitle}</span>
          ) : (
            <Link
              href={home}
              className="tracking-wide text-brand-600 hover:text-brand-700"
            >
              TetherProof
            </Link>
          )}
        </h1>

        <div className="hidden md:block">
          <PrimaryNav items={items} variant="bar" />
        </div>

        {showInvitations && onHome ? (
          <Link
            href="/invites"
            aria-label={
              pendingInvitations > 0
                ? `Invitations, ${pendingInvitations} waiting for your answer`
                : 'Invitations'
            }
            className="relative ml-auto flex h-10 w-10 items-center justify-center rounded-full text-ink-700 transition hover:bg-brand-50 hover:text-brand-700"
          >
            <Mail
              aria-hidden="true"
              className="h-6 w-6"
              strokeWidth={ICON_STROKE_WIDTH}
            />
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
      </div>
    </header>
  );
}
