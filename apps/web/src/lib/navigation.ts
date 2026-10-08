import type { UserRole } from '@tetherproof/shared';

/** One destination in the signed-in navigation. */
export type NavIcon = 'home' | 'workspace' | 'logs' | 'invitations' | 'profile' | 'settings' | 'more';

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

/** One destination on the More page. */
export interface MoreItem {
  href: string;
  label: string;
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
 * The primary tabs, ending in More.
 *
 * Workers live in three places: see the overview, log the next job, and read the
 * record. Account is reached from the avatar in the header, and everything else
 * (invitations, settings, static pages) sits on the More page, so the everyday
 * tabs stay readable on a phone. The log form is deliberately its own tab — it
 * is the one task a worker came to do, and mixing it into a scrolling dashboard
 * would bury it under content.
 *
 * More is the last tab on purpose: on a phone it is the bottom-right corner,
 * where a thumb travels least, and the flat destinations it leads to are all
 * optional.
 */
const WORKER_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', mobileLabel: 'Home', icon: 'home' },
  { href: '/workspace', label: 'Workspace', mobileLabel: 'Work', icon: 'workspace' },
  { href: '/logs', label: 'Logs', icon: 'logs' },
  { href: '/more', label: 'More', icon: 'more' },
];

/** Employers keep one tab plus More; account and the docs live behind the avatar and More. */
const EMPLOYER_NAV: NavItem[] = [
  { href: '/employer', label: 'Workspace', icon: 'workspace' },
  { href: '/more', label: 'More', icon: 'more' },
];

const PLACEHOLDER_NAV: NavItem[] = [
  { href: '/pending', label: 'Workspace', icon: 'workspace' },
  { href: '/more', label: 'More', icon: 'more' },
];

export function navFor(role: UserRole): NavItem[] {
  if (role === 'worker') return WORKER_NAV;
  if (role === 'employer') return EMPLOYER_NAV;
  return PLACEHOLDER_NAV;
}

/**
 * What lives on the More page.
 *
 * Invitations is worker-only; every signed-in role gets settings plus the four
 * static pages. Static pages are public, but a signed-in person reaching them
 * from the app keeps the same chrome rather than being dropped onto marketing.
 */
export function moreFor(role: UserRole): MoreItem[] {
  const common: MoreItem[] = [
    { href: '/help', label: 'Help' },
    { href: '/about', label: 'About' },
    { href: '/terms', label: 'Terms & Conditions' },
    { href: '/privacy', label: 'Privacy Policy' },
  ];

  const settings: MoreItem = { href: '/settings/account', label: 'Settings' };
  if (role === 'worker') {
    return [{ href: '/invites', label: 'Invitations' }, settings, ...common];
  }
  return [settings, ...common];
}