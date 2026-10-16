import type { UserRole } from '@tetherproof/shared';

/** One destination in the signed-in primary navigation. */
export type NavIcon =
  | 'home'
  | 'workspace'
  | 'logs'
  | 'profile'
  | 'invitations'
  | 'search'
  | 'candidates'
  | 'organization'
  | 'roster'
  | 'issuer'
  | 'demand';

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
 * Workers open on the overview (their dashboard), employers on their dashboard,
 * training providers on theirs, and administrators on the approval console.
 *
 * The training provider's fallback is still `/pending`, which is the honest page for
 * an account whose role has no workspace. It is simply no longer where a training
 * provider lands, because the module behind those four tabs now exists.
 */
export function homeFor(role: UserRole): string {
  switch (role) {
    case 'employer':
      return '/employer';
    case 'admin':
      return '/admin';
    case 'training_provider':
      return '/trainer';
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

/**
 * Employers live in four places: the dashboard that shows what needs attention,
 * the search that finds people, the invitations they have sent and the answers
 * that came back, and the organization details an approval is based on. Profile
 * and settings stay in the account menu, which is reachable from every screen.
 *
 * The dashboard is the home tab, so the brand stands in the header there; the
 * three sibling tabs each carry their own section name.
 */
const EMPLOYER_NAV: NavItem[] = [
  { href: '/employer', label: 'Dashboard', mobileLabel: 'Home', icon: 'home' },
  { href: '/employer/search', label: 'Candidate search', mobileLabel: 'Search', icon: 'search' },
  { href: '/employer/candidates', label: 'Candidates', mobileLabel: 'People', icon: 'candidates' },
  { href: '/employer/organization', label: 'Organization', mobileLabel: 'Org', icon: 'organization' },
];

/** Administrators have the approval console and the shared profile. */
const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Approvals', icon: 'workspace' },
  { href: '/profile', label: 'Profile', icon: 'profile' },
];

/**
 * Training providers live in the three places doc/05 §C names, plus a home.
 *
 * Roster, issuer, and demand are the module: who is on the books, what an instructor
 * has signed off, and what the market is short of. The fourth tab is the dashboard
 * that answers the question an institute opens the app with — how many students,
 * how many answers outstanding — before it goes to do any of the three.
 *
 * The issuer tab is the one an instructor lives in, so it gets the short mobile
 * label; "Milestone issuer" is unreadable at the width of a thumb-sized tab.
 */
const TRAINER_NAV: NavItem[] = [
  { href: '/trainer', label: 'Dashboard', mobileLabel: 'Home', icon: 'home' },
  { href: '/trainer/roster', label: 'Student roster', mobileLabel: 'Roster', icon: 'roster' },
  { href: '/trainer/credentials', label: 'Milestone issuer', mobileLabel: 'Issuer', icon: 'issuer' },
  { href: '/trainer/demand', label: 'Market demand', mobileLabel: 'Demand', icon: 'demand' },
];

const PLACEHOLDER_NAV: NavItem[] = [
  { href: '/pending', label: 'Workspace', icon: 'workspace' },
  { href: '/profile', label: 'Profile', icon: 'profile' },
];

export function navFor(role: UserRole): NavItem[] {
  if (role === 'worker') return WORKER_NAV;
  if (role === 'employer') return EMPLOYER_NAV;
  if (role === 'admin') return ADMIN_NAV;
  if (role === 'training_provider') return TRAINER_NAV;
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
 * Sign-out is not in this list because it is not a destination: the menu
 * component renders it as its own row beneath these groups, where it can be a
 * form that ends the session rather than a link.
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