'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Award, Building2, House, LayoutGrid, List, Mail, Search, Settings, TrendingUp, User, Users, type LucideIcon } from 'lucide-react';
import type { NavItem } from '@/lib/navigation';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

interface PrimaryNavProps {
  items: NavItem[];
  /**
   * A count to show on one destination — the invitations waiting for an answer.
   *
   * Keyed by the destination's address rather than passed per item, because the
   * count belongs to the account and not to the navigation: the layout reads it
   * once and hands it to whichever bar is on screen. The badge sits on the icon's
   * pill so it cannot move the label, and it is decorative for a screen reader,
   * which gets the same count from the link's `aria-label` instead.
   */
  badge?: { href: string; count: number; label?: string };
  /**
   * `bar` sits in the header on a wide screen; `tabs` is the row pinned to the
   * bottom of a phone. Labels are responsive: the tabs variant prefers each
   * item's short mobile label (Home, Work) so four tabs stay readable with a
   * thumb, while the bar shows the full destination names.
   */
  variant: 'bar' | 'tabs';
}

/**
 * The signed-in navigation, with the current page marked.
 *
 * `aria-current="page"` rather than a colour alone: the active state is the one
 * piece of information this component exists to carry, and a screen reader user
 * needs it as much as a sighted one does.
 *
 * Rendered twice — once per variant — but only ever one of the two is displayed,
 * so exactly one is in the accessibility tree at a time.
 */
export function PrimaryNav({ items, variant, badge }: PrimaryNavProps) {
  const pathname = usePathname();
  const badged = badge && badge.count > 0 ? badge : undefined;

  // The one destination this path belongs to, chosen by the longest matching
  // address rather than the first test. `/employer` is a prefix of every other
  // employer tab, so a plain prefix test lit Home on all of them; the most
  // specific match is the screen the member is actually standing on.
  const activeHref = activeHrefFor(items, pathname);

  if (variant === 'tabs') {
    return (
      <ul className="flex">
        {items.map((item) => {
          const active = item.href === activeHref;
          const count = badged?.href === item.href ? badged.count : 0;
          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                aria-label={count > 0 ? `${item.label}, ${count} waiting for your answer` : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 px-1 pt-2 pb-1.5 text-[11px] font-medium transition-colors ${
                  active ? 'text-brand-700' : 'text-ink-600 hover:text-ink-900'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`relative flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
                    active ? 'bg-brand-50' : ''
                  }`}
                >
                  <NavIcon name={item.icon} className="h-5 w-5" />
                  {count > 0 ? (
                    <span className="absolute -top-0.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white tabular-nums ring-2 ring-white">
                      {count > 99 ? '99+' : count}
                    </span>
                  ) : null}
                </span>
                {item.mobileLabel ?? item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className="flex items-center gap-1">
      {items.map((item) => {
        const active = item.href === activeHref;
        const count = badged?.href === item.href ? badged.count : 0;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              aria-label={count > 0 ? `${item.label}, ${count} waiting for your answer` : undefined}
              className={`flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors ${
                active ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-brand-50 hover:text-ink-900'
              }`}
            >
              <NavIcon name={item.icon} className="h-4 w-4" />
              {item.label}
              {count > 0 ? (
                <span className="rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white tabular-nums">
                  {count > 99 ? '99+' : count}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The active destination for a path: the longest of the items it sits under.
 *
 * An item covers its own address and anything below it, so a worker on
 * `/dashboard` is on Home and a nested future page under `/employer/search`
 * stays on Candidate search. When two items both cover the path — the employer
 * Dashboard (`/employer`) and any of its siblings — the longer (more specific)
 * address wins, which is the page actually being shown.
 */
function activeHrefFor(items: NavItem[], pathname: string): string | null {
  let match: string | null = null;
  for (const item of items) {
    if (!isWithin(item.href, pathname)) continue;
    if (match === null || item.href.length > match.length) match = item.href;
  }
  return match;
}

function isWithin(href: string, pathname: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(href.endsWith('/') ? href : `${href}/`);
}

/**
 * One icon per destination. The mapping is exhaustive by type, so adding a
 * destination to the navigation without an icon is a compile error rather than a
 * blank square in the tab row.
 */
const NAV_ICONS: Record<NavItem['icon'], LucideIcon> = {
  home: House,
  workspace: LayoutGrid,
  logs: List,
  profile: User,
  invitations: Mail,
  search: Search,
  candidates: Users,
  organization: Building2,
  roster: Users,
  issuer: Award,
  demand: TrendingUp,
  // The capability dashboard. Shown as a destination of its own because a person who has
  // finished setting up still comes back here to add their second or third area, and
  // burying that under the workspace switcher would make it look like a setting.
  capabilities: LayoutGrid,
  business: Building2,
  // The settings tab. What it means follows the open workspace — an employer sees
  // "Organization", a trainer "Institute details" — so the icon is the neutral one.
  settings: Settings,
};

function NavIcon({ name, className }: { name: NavItem['icon']; className: string }) {
  const Icon = NAV_ICONS[name];
  return <Icon aria-hidden="true" className={className} strokeWidth={ICON_STROKE_WIDTH} />;
}
