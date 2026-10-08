'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  House,
  LayoutGrid,
  List,
  Mail,
  MoreHorizontal,
  SlidersHorizontal,
  User,
  type LucideIcon,
} from 'lucide-react';
import type { NavItem } from '@/lib/navigation';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

interface PrimaryNavProps {
  items: NavItem[];
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
export function PrimaryNav({ items, variant }: PrimaryNavProps) {
  const pathname = usePathname();

  if (variant === 'tabs') {
    return (
      <ul className="flex">
        {items.map((item) => {
          const active = isActive(item.href, pathname);
          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 px-1 pt-2 pb-1.5 text-[11px] font-medium transition-colors ${
                  active ? 'text-brand-700' : 'text-ink-600 hover:text-ink-900'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
                    active ? 'bg-brand-50' : ''
                  }`}
                >
                  <NavIcon name={item.icon} className="h-5 w-5" />
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
        const active = isActive(item.href, pathname);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors ${
                active ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-brand-50 hover:text-ink-900'
              }`}
            >
              <NavIcon name={item.icon} className="h-4 w-4" />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A destination is active for its own address and for anything underneath it,
 * so `/settings/account` also marks itself when a future settings page is added.
 * Anchors and query strings are not part of the address the router reports, so
 * they need no handling here.
 */
function isActive(href: string, pathname: string): boolean {
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
  invitations: Mail,
  profile: User,
  settings: SlidersHorizontal,
  more: MoreHorizontal,
};

function NavIcon({ name, className }: { name: NavItem['icon']; className: string }) {
  const Icon = NAV_ICONS[name];
  return <Icon aria-hidden="true" className={className} strokeWidth={ICON_STROKE_WIDTH} />;
}
