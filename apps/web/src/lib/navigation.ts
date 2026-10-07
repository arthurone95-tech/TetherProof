import type { UserRole } from '@tetherproof/shared';

/** One destination in the signed-in navigation. */
export type NavIcon = 'home' | 'workspace' | 'logs' | 'invitations' | 'profile' | 'settings';

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

/** A secondary destination behind the more/hamburger menu. */
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

/** What each role is called in the interface. */
export const ROLE_LABEL: Record<UserRole, string> = {
  worker: 'Worker',
  employer: 'Employer',
  training_provider: 'Training provider',
  admin: 'Administrator',
};

/**
 * The four primary tabs.
 *
 * Workers live in four places: see the overview, log the next job, read the
 * record, and manage the account. The log form is deliberately its own tab —
 * it is the one task a worker came to do, and mixing it into a scrolling
 * dashboard would bury it under content. Everything else (invitations,
 * settings, static pages) sits behind the more menu so the four tabs stay
 * readable on a phone.
 */
const WORKER_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', mobileLabel: 'Home', icon: 'home' },
  { href: '/workspace', label: 'Workspace', mobileLabel: 'Work', icon: 'workspace' },
  { href: '/logs', label: 'Logs', icon: 'logs' },
  { href: '/profile', label: 'Profile', icon: 'profile' },
];

/** Employers keep two tabs; settings and the docs sit behind the more menu. */
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
 * What hides behind the more (hamburger) menu.
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