'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavItem } from '@/lib/navigation';

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

function NavIcon({ name, className }: { name: NavItem['icon']; className: string }) {
  const shared = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className,
  };

  switch (name) {
    case 'home':
      return (
        <svg {...shared}>
          <path d="m4 11.5 8-7 8 7" />
          <path d="M6 9.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5" />
          <path d="M10 20v-5h4v5" />
        </svg>
      );
    case 'workspace':
      return (
        <svg {...shared}>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
        </svg>
      );
    case 'logs':
      return (
        <svg {...shared}>
          <path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12" />
          <path d="M4 6.5h1M4 12h1M4 17.5h1" />
        </svg>
      );
    case 'invitations':
      return (
        <svg {...shared}>
          <rect x="3" y="5.5" width="18" height="13" rx="2" />
          <path d="m3.8 7.5 8.2 5.6 8.2-5.6" />
        </svg>
      );
    case 'profile':
      return (
        <svg {...shared}>
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5 19.5a7 7 0 0 1 14 0" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...shared}>
          <path d="M4 7.5h9M19 7.5h1M4 16.5h3M13 16.5h7" />
          <circle cx="16" cy="7.5" r="2.2" />
          <circle cx="10" cy="16.5" r="2.2" />
        </svg>
      );
    case 'more':
      return (
        <svg {...shared}>
          <circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}
