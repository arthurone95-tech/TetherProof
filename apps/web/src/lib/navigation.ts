import type { UserCapability, UserRole } from '@tetherproof/shared';

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
  | 'demand'
  | 'capabilities'
  | 'business'
  | 'settings';

/**
 * One authorised area a person can be working in.
 *
 * The workspace is what replaces a role as the thing the interface is organised around.
 * A person holding worker and trainee has two, and switching between them changes what is
 * on screen — it never changes who they are, and it never asks them to sign in again.
 */
export interface Workspace {
  id: UserCapability;
  label: string;
  href: string;
  /** Shown in the switcher as one line, so the choice is not just a name. */
  blurb: string;
  /**
   * Where this capability's own settings live.
   *
   * The answer to "how do I edit the details for *this* role". Each workspace names its
   * own, so a single bottom-bar button can mean "Organization" to an employer and
   * "Institute" to a trainer without the person having to find it — see `navFor`, which
   * appends it as the last tab of whichever workspace is open.
   */
  settingsHref: string;
  /** What the settings tab is called in that workspace. */
  settingsLabel: string;
  /** Short enough for a thumb-sized tab. */
  settingsMobileLabel: string;
}

/**
 * Every workspace, keyed by capability.
 *
 * All four are always present in this map — a workspace is a destination, not a
 * privilege — and whether one is *offered* is decided by `workspacesFor`, which only
 * shows the ones the account actually holds. That separation is deliberate: it means a
 * new capability cannot appear in navigation without someone deciding what its workspace
 * looks like, rather than silently getting somebody else's.
 */
export const WORKSPACES: Record<UserCapability, Workspace> = {
  worker: {
    id: 'worker',
    label: 'Work',
    href: '/dashboard',
    blurb: 'Jobs, evidence and customer verification',
    // A worker's details are the profile: their name, where they are, and the skills
    // an employer is shown. There is no separate "worker settings" page because there is
    // nothing else to put on it.
    settingsHref: '/connect',
    settingsLabel: 'Connect',
    settingsMobileLabel: 'Connect',
  },
  trainee: {
    id: 'trainee',
    label: 'Trainee',
    href: '/credentials',
    blurb: 'Institute, milestones and credentials',
    settingsHref: '/connect',
    settingsLabel: 'Connect',
    settingsMobileLabel: 'Connect',
  },
  training_provider: {
    id: 'training_provider',
    label: 'Institute',
    href: '/trainer',
    blurb: 'Students, milestone issuer and demand',
    // The institute's name is the profile's organisation field. It is what appears on
    // every credential this provider signs, so it matters more here than for an employer.
    settingsHref: '/profile',
    settingsLabel: 'Institute details',
    settingsMobileLabel: 'Inst.',
  },
  employer: {
    id: 'employer',
    label: 'Hiring',
    href: '/employer',
    blurb: 'Search candidates and manage invitations',
    settingsHref: '/employer/organization',
    settingsLabel: 'Organization',
    settingsMobileLabel: 'Org',
  },
};

/**
 * Where a person goes to *set up* a capability they do not hold yet.
 *
 * Separate from `settingsHref` because the two answer different questions: "edit the
 * details of the thing I have" versus "turn this thing on". Sending someone who has not
 * activated a capability to that capability's settings page would show them an empty form
 * for an organisation that does not exist.
 */
export function setupHrefFor(capability: UserCapability): string {
  return `/setup/${capability}`;
}

/** The workspaces this account may work in, in the order they should be offered. */
export function workspacesFor(capabilities: readonly UserCapability[]): Workspace[] {
  const order: UserCapability[] = ['worker', 'trainee', 'training_provider', 'employer'];
  return order.filter((c) => capabilities.includes(c)).map((c) => WORKSPACES[c]);
}

/** One destination in the signed-in primary navigation. */
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
 * The page an account opens on.
 *
 * An administrator gets the approval console, because that is the work they are here to do
 * and there is no personal workspace to put them in. Everyone else opens on the workspace
 * matching the first capability they hold, in the order `workspacesFor` uses.
 *
 * An account with no capability at all — a brand-new signup — lands on the capability
 * dashboard, which is the honest place for it: there is nothing to show them yet, and
 * sending them to an empty worker dashboard would imply they had one.
 */
export function homeFor(input: {
  capabilities: readonly UserCapability[];
  isAdmin?: boolean;
}): string {
  if (input.isAdmin) return '/admin';
  const first = workspacesFor(input.capabilities)[0];
  return first ? first.href : '/capabilities';
}

/**
 * The navigation for an account.
 *
 * The tab row follows the *primary* workspace — the one they landed on — and everything
 * else is reachable from the switcher in the header. Putting four workspaces in a phone's
 * bottom bar would leave no room for the labels, and the switcher is already on every
 * screen.
 */
export function navFor(input: {
  capabilities: readonly UserCapability[];
  isAdmin?: boolean;
  /** The workspace being looked at, when it is not the first one held. */
  active?: UserCapability | null;
}): NavItem[] {
  if (input.isAdmin) return ADMIN_NAV;

  const held = workspacesFor(input.capabilities);
  const primary = held.find((w) => w.id === input.active) ?? held[0];
  if (!primary) return NO_CAPABILITY_NAV;

  const base = NAV_BY_WORKSPACE[primary.id];
  const settings = WORKSPACES[primary.id];

  // The settings tab is appended rather than hand-written into each array, so a
  // workspace cannot forget it and the label follows the workspace instead of being
  // copied four times. It is also what answers "how do I edit *this* role's details":
  // one button, meaning whatever the open workspace calls it.
  if (base.some((item) => item.href === settings.settingsHref)) return base;

  return [
    ...base,
    {
      href: settings.settingsHref,
      label: settings.settingsLabel,
      mobileLabel: settings.settingsMobileLabel,
      icon: 'settings',
    },
  ];
}

/**
 * True when this account may open this area.
 *
 * The client-side half of `requireCapability` on the server, and only the half: it decides
 * what to draw, never what is reachable. Every route re-checks on the server, because a
 * page that is merely hidden is not a permission.
 */
export function can(
  capabilities: readonly UserCapability[],
  capability: UserCapability,
): boolean {
  return capabilities.includes(capability);
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
 * What a brand-new account sees.
 *
 * One destination, because there is exactly one thing to do: choose a capability. Showing
 * a worker dashboard full of empty states would imply a work profile that does not exist
 * yet, which is the confusing version of this screen.
 */
const NO_CAPABILITY_NAV: NavItem[] = [
  { href: '/roles', label: 'Get started', icon: 'capabilities' },
  { href: '/profile', label: 'Profile', icon: 'profile' },
];

const TRAINER_NAV: NavItem[] = [
  { href: '/trainer', label: 'Dashboard', mobileLabel: 'Home', icon: 'home' },
  { href: '/trainer/roster', label: 'Student roster', mobileLabel: 'Roster', icon: 'roster' },
  { href: '/trainer/credentials', label: 'Milestone issuer', mobileLabel: 'Issuer', icon: 'issuer' },
  { href: '/trainer/demand', label: 'Market demand', mobileLabel: 'Demand', icon: 'demand' },
];

/**
 * A student's own training record.
 *
 * Two tabs, because that is genuinely all there is: what the institute has recorded, and
 * where to change which capabilities the account holds. The credentials page *is* the
 * trainee dashboard — it answers "how am I doing" for somebody whose work history lives on
 * a different workspace entirely.
 */
const TRAINEE_NAV: NavItem[] = [
  { href: '/credentials', label: 'My credentials', mobileLabel: 'Home', icon: 'home' },
];

/** Which tab row belongs to which workspace. */
const NAV_BY_WORKSPACE: Record<UserCapability, NavItem[]> = {
  worker: WORKER_NAV,
  trainee: TRAINEE_NAV,
  training_provider: TRAINER_NAV,
  employer: EMPLOYER_NAV,
};

/** The capabilities page is reachable from every workspace, so it appears in the menu. */

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
 * The words under a member's name in the account menu.
 *
 * Their capabilities, in sentence case, because that is what describes them. A person who
 * is an electrician, a student and a business owner should not be labelled by whichever
 * one the code happened to check first.
 */
export function capabilityLabel(capabilities: readonly UserCapability[]): string {
  if (capabilities.length === 0) return 'No workspace yet';
  return capabilities
    .map((capability) => {
      const spaced = capability.replace(/_/g, ' ');
      return spaced.charAt(0).toUpperCase() + spaced.slice(1);
    })
    .join(' · ');
}

/**
 * The single word for a role, kept for the places that genuinely have one — an
 * administrator, or a page that is specific to one kind of account.
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
  // The trailing slash is deliberate: it matches an individual log and not the list. The
  // list is a primary destination with its own tab, so it keeps the section header. Without
  // this an individual log fell through to the section header and looked like a browser
  // page rather than the same drill-down pattern the rest of the app uses.
  ['/logs/', 'Log'],
  ['/invites', 'Invitations'],
  ['/connect', 'Connect'],
  ['/roles', 'Roles and profiles'],
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