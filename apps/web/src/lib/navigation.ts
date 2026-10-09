import type { UserRole } from '@tetherproof/shared';

/** One destination in the signed-in primary navigation. */
export type NavIcon = 'home' | 'workspace' | 'logs' | 'profile';

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

/**
 * One destination in the top-right menu (the hamburger on a phone, the icon
 * group beside the header nav on a wide screen).
 */
export interface MenuItem {
  href: string;
  label: string;
  /** The single sentence a screen reader or a skim can hang on. */
  description: string;
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
 * record, and manage their own account and capabilities. The invitation inbox
 * and the static pages sit in the header's menu instead: they are screens a
 * worker visits occasionally, and keeping them out of the bottom row leaves the
 * everyday tabs readable on a phone. The log form is deliberately its own
 * tab — it is the one task a worker came to do, and mixing it into a scrolling
 * dashboard would bury it under content.
 */
const WORKER_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', mobileLabel: 'Home', icon: 'home' },
  { href: '/workspace', label: 'Workspace', mobileLabel: 'Work', icon: 'workspace' },
  { href: '/logs', label: 'Logs', icon: 'logs' },
  { href: '/profile', label: 'Profile', icon: 'profile' },
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
 * What lives in the header menu.
 *
 * Invitations and notifications exist only for workers — they hold a worker's
 * inbox. Profile is a primary tab now, so it is deliberately not listed here;
 * the rest — settings and the four static pages — are open to every role.
 * Static pages are public, but a signed-in person reaching them from the app
 * gets the app's back header rather than marketing chrome.
 */
export function menuFor(isWorker: boolean): MenuItem[] {
  return [
    ...(isWorker
      ? [
          { href: '/notifications', label: 'Notifications', description: 'Verification and invitation updates' },
          { href: '/invites', label: 'Invitations', description: 'Invitations waiting for your answer' },
        ]
      : []),
    { href: '/settings', label: 'Settings', description: 'Your account and privacy choices' },
    { href: '/help', label: 'Help', description: 'How the app works' },
    { href: '/about', label: 'About', description: 'What TetherProof is for' },
    { href: '/terms', label: 'Terms & Conditions', description: 'The rules of using the service' },
    { href: '/privacy', label: 'Privacy Policy', description: 'What we do with your data' },
  ];
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
  ['/invites', 'Invitations'],
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
 * Primary sections (Home, Work, Logs, Profile) are deliberately absent: they
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