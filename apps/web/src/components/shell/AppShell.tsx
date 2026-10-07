import Link from 'next/link';
import type { NavItem } from '@/lib/navigation';
import { PrimaryNav } from './PrimaryNav';

interface AppShellProps {
  /** Where the brand mark goes: the member's own home, not the marketing page. */
  home: string;
  /** Who is signed in, as the header states it. */
  identity: string;
  items: NavItem[];
  children: React.ReactNode;
}

/**
 * The frame every signed-in page sits inside.
 *
 * Before this, each page drew its own brand line, so moving between two screens
 * meant the chrome disappeared and reappeared, and the only way to reach a third
 * screen was to know its address. One shell fixes that: navigation is always in
 * the same place, and the current page is marked on it.
 *
 * Sign-out deliberately does not live here. It is the one action a member never
 * needs in a hurry, and keeping it out of a bar every page shares means it cannot
 * be hit by a stray tap on the way to something else. It lives on the profile
 * page instead, next to the account it ends.
 *
 * The header is sticky rather than fixed, so it occupies layout space and never
 * covers the first line of a heading. The tab row for a phone is a sibling rather
 * than a child of the header because a `backdrop-filter` on the header would make
 * it the containing block for a fixed descendant and pin the tabs to the header
 * instead of the bottom of the screen.
 */
export function AppShell({ home, identity, items, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-brand-100 bg-white">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-2.5">
          <Link
            href={home}
            className="text-sm font-semibold tracking-wide text-brand-600 uppercase hover:text-brand-700"
          >
            TetherProof
          </Link>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden md:block">
              <PrimaryNav items={items} variant="bar" />
            </div>
            <span className="hidden max-w-48 truncate text-sm text-ink-600 sm:block">{identity}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-7 pb-32 md:pb-14">{children}</main>

      {/*
        A phone gets four tabs along the bottom, where a thumb reaches. The
        padding under the content keeps the last card clear of them.
      */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-brand-100 bg-white md:hidden"
      >
        <PrimaryNav items={items} variant="tabs" />
      </nav>
    </div>
  );
}
