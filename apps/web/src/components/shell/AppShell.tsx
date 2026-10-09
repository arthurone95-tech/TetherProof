import type { NavItem } from '@/lib/navigation';
import { AppHeader } from './AppHeader';
import type { AccountSummary } from './AccountMenu';
import { AppTabs } from './AppTabs';

interface AppShellProps {
  /** Where the brand mark goes: the member's own home, not the marketing page. */
  home: string;
  items: NavItem[];
  /** Who is signed in: the avatar and the top of the account menu. */
  account: AccountSummary;
  /** Whether this account has an inbox (workers only): notifications in the header. */
  showInvitations: boolean;
  /** Invitations waiting for an answer; the badge on the tab row's Invitations tab. */
  pendingInvitations: number;
  /** Notifications not yet seen; the badge on the header's notification icon. */
  unreadNotifications: number;
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
 * The shell itself stays a server component: the session-derived values (home
 * address, tabs, account summary, inbox counts) are fetched once per render here and handed
 * to two small client components. `AppHeader` draws the header — section title
 * on the primary tabs, back icon and page name on a page opened from the account
 * menu or an inbox icon, and the member's controls (inbox icons and the avatar
 * menu) at every width — and `AppTabs` draws the
 * phone's bottom row, which steps aside on those same sub-pages. Both decide
 * from the current address, so neither the layout nor the pages need to know
 * which of the two they are.
 *
 * Sign-out deliberately does not live here. It is the one action a member never
 * needs in a hurry, and keeping it out of a bar every page shares means it
 * cannot be hit by a stray tap on the way to something else. It lives on the
 * profile page instead, next to the account it ends.
 *
 * The header is sticky rather than fixed, so it occupies layout space and never
 * covers the first line of a heading. The tab row for a phone is a sibling rather
 * than a child of the header because a `backdrop-filter` on the header would make
 * it the containing block for a fixed descendant and pin the tabs to the header
 * instead of the bottom of the screen.
 */
export function AppShell({
  home,
  items,
  account,
  showInvitations,
  pendingInvitations,
  unreadNotifications,
  children,
}: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader
        home={home}
        items={items}
        account={account}
        showInvitations={showInvitations}
        unreadNotifications={unreadNotifications}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-7 pb-32 md:pb-14">{children}</main>

      {/*
        A phone gets the tabs along the bottom, where a thumb reaches. The
        padding under the content keeps the last card clear of the row.
      */}
      <AppTabs items={items} pendingInvitations={pendingInvitations} />
    </div>
  );
}
