import type { UserRole } from '@tetherproof/shared';

/** One destination in the signed-in primary navigation. */
export type NavIcon = 'home' | 'workspace' | 'logs' | 'profile' | 'invitations';

export interface NavItem {
  href: string;
  label: string;
  /**
   * The label on a phone's bottom bar, when the full word is too wide for a
   * thumb-sized tab. "Dashboard" and "Workspace" both read as cramped on a
   * small screen, so phones say "Home" and "Work" for the same destinations.
   */
  mobileLabel?: string;
  icon: NavIcon;
}

/** The icon a row in the account menu carries; the menu component maps each to a glyph. */
export type MenuIcon = 'profile' | 'settings' | 'help' | 'about' | 'terms' | 'privacy';

/** One destination in the account menu (the avatar at the header's right edge). */
export interface MenuItem {
  href: string;
  label: string;
  icon: MenuIcon;
}

/** A run of related destinations, separated from its neighbours by a divider. */
export interface MenuGroup {
  id: string;
  items: MenuItem[];
}

/**
 * The page each role treats as home.
 *
 * Workers open on the overview (their dashboard), employers on search, and the
 * roles whose modules are not built on a page that says so. The training
 * provider and admin roles have no interface yet, and sending them to a page
 * that pretends otherwise would be worse than saying so.
 */
export function homeFor(role: UserRole): string {
  switch (role) {
    case 'employer':
      return '/employer';
    case 'worker':
      return '/dashboard';
    default:
      return '/pending';
  }
}

/**
 * The primary tabs.
 *
 * Workers live in four places: see the overview, log the next job, read the
 * record, and answer the invitations waiting for them. Invitations sit in the tab
 * row rather than in the header because a count of unanswered invitations is one
 * of the few things worth interrupting a glance for, and a badge in the bar a
 * thumb already rests on is seen more often than one across the screen.
 * Everything occasional — settings, help, the documents, and the account itself
 * — sits in the header's menu instead, so the everyday tabs stay readable on a
 * phone. The log form is deliberately its own tab: it is the one task a worker
 * came to do, and mixing it into a scrolling dashboard would bury it under
 * content.
 *
 * Profile is therefore absent here, and was in the tab row until the account menu
 * took it: with the menu in the header, a Profile tab repeated a destination the
 * member can already reach from anywhere on any screen, including the ones with
 * no tab row at all.
 */
const WORKER_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', mobileLabel: 'Home', icon: 'home' },
  { href: '/workspace', label: 'Workspace', mobileLabel: 'Work', icon: 'workspace' },
  { href: '/logs', label: 'Logs', icon: 'logs' },
  { href: '/invites', label: 'Invitations', mobileLabel: 'Invites', icon: 'invitations' },
];

/** Employers keep two tabs; settings and the docs live in the header menu. */
const EMPLOYER_NAV: NavItem[] = [
  { href: '/employer', label: 'Workspace', icon: 'workspace' },
  { href: '/profile', label: 'Profile', icon: 'profile' },
];

const PLACEHOLDER_NAV: NavItem[] = [
  { href: '/pending', label: 'Workspace', icon: 'workspace' },
  { href: '/profile', label: 'Profile', icon: 'profile' },
];

export function navFor(role: UserRole): NavItem[] {
  if (role === 'worker') return WORKER_NAV;
  if (role === 'employer') return EMPLOYER_NAV;
  return PLACEHOLDER_NAV;
}

/**
 * What lives in the account menu.
 *
 * Three groups, in the order a member reaches for them: the account itself,
 * help about the product, and the documents. Invitations and notifications are
 * deliberately absent: they are the member's inbox, so they sit in the header
 * as their own icons (with their badges) and never need a menu to be found.
 * Every row is open to every role. Static pages are public, but a signed-in
 * person reaching them from the app gets the app's back header rather than
 * marketing chrome.
 *
 * Sign-out is not here on purpose; it lives on the Profile page, next to the
 * account it ends.
 */
export const ACCOUNT_MENU: ReadonlyArray<MenuGroup> = [
  {
    id: 'account',
    items: [
      { href: '/profile', label: 'Profile', icon: 'profile' },
      { href: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
  {
    id: 'support',
    items: [
      { href: '/help', label: 'Help', icon: 'help' },
      { href: '/about', label: 'About', icon: 'about' },
    ],
  },
  {
    id: 'legal',
    items: [
      { href: '/terms', label: 'Terms & Conditions', icon: 'terms' },
      { href: '/privacy', label: 'Privacy Policy', icon: 'privacy' },
    ],
  },
];

/**
 * The words under a member's name in the account menu when they have no
 * organisation: the role, in sentence case ("Worker", "Employer").
 */
export function roleLabel(role: UserRole): string {
  const spaced = String(role).replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The title of a secondary page, keyed by its address prefix.
 *
 * The header carries a page's name instead of the page repeating it inside its
 * own body, so this one map decides both what the back header reads and which
 * routes count as sub-pages anywhere in the app — including the public static
 * pages when a signed-in member opens them.
 */
const SUBPAGE_TITLES: ReadonlyArray<readonly [prefix: string, title: string]> = [
  ['/notifications', 'Notifications'],
  ['/settings', 'Settings'],
  ['/help', 'Help'],
  ['/about', 'About'],
  ['/terms', 'Terms & Conditions'],
  ['/privacy', 'Privacy Policy'],
];

/**
 * The sub-page title for a path, or `null` when the path is a primary section.
 *
 * Primary sections (Home, Work, Logs, Invitations) are deliberately absent: they
 * keep the bottom navigation and their own header treatment. Anything in the
 * map is a page opened from the header menu — no tab row, a back icon, and the
 * name in the header.
 */
export function subpageTitleFor(pathname: string): string | null {
  for (const [prefix, title] of SUBPAGE_TITLES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return title;
  }
  return null;
}