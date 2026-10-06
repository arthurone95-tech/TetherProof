import type { UserRole } from '@tetherproof/shared';

/**
 * One destination in the signed-in navigation.
 *
 * Deliberately data rather than markup: the header renders a top bar on a wide
 * screen and a tab bar on a phone from the same list, so the two can never drift
 * into disagreeing about where something lives.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: 'workspace' | 'invitations' | 'profile' | 'settings';
}

/**
 * The page each role treats as home.
 *
 * Workers open on the place they log work, employers on search, and the roles
 * whose modules are not built on a page that says so. The training provider and
 * admin roles have no interface yet, and sending them to a page that pretends
 * otherwise would be worse than saying so.
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
 * What each role is called in the interface.
 *
 * The API's own value is `training_provider`, which reads as a database
 * identifier rather than as a person's account type.
 */
export const ROLE_LABEL: Record<UserRole, string> = {
  worker: 'Worker',
  employer: 'Employer',
  training_provider: 'Training provider',
  admin: 'Administrator',
};

const WORKER_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Workspace', icon: 'workspace' },
  { href: '/invites', label: 'Invitations', icon: 'invitations' },
  { href: '/profile', label: 'Profile', icon: 'profile' },
  { href: '/settings/account', label: 'Settings', icon: 'settings' },
];

/**
 * Employers have no separate invitations page: the invitations they have sent
 * are listed on their own workspace next to the search that produced them, so a
 * fourth tab would be a link to the first one.
 */
const EMPLOYER_NAV: NavItem[] = [
  { href: '/employer', label: 'Workspace', icon: 'workspace' },
  { href: '/profile', label: 'Profile', icon: 'profile' },
  { href: '/settings/account', label: 'Settings', icon: 'settings' },
];

const PLACEHOLDER_NAV: NavItem[] = [
  { href: '/pending', label: 'Workspace', icon: 'workspace' },
  { href: '/profile', label: 'Profile', icon: 'profile' },
  { href: '/settings/account', label: 'Settings', icon: 'settings' },
];

export function navFor(role: UserRole): NavItem[] {
  if (role === 'worker') return WORKER_NAV;
  if (role === 'employer') return EMPLOYER_NAV;
  return PLACEHOLDER_NAV;
}
