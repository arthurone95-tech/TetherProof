'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  Bell,
  CircleHelp,
  FileText,
  Info,
  Mail,
  Menu,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import type { MenuItem } from '@/lib/navigation';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

interface HamburgerMenuProps {
  items: MenuItem[];
  /**
   * How many invitations are waiting for this member's answer, shown as the
   * badge on the menu button itself — the one place a worker passing through
   * any screen sees that something arrived without having to look.
   */
  badge: number;
}

/**
 * The phone menu: a button in the header that opens the secondary screens.
 *
 * Everything the bottom tabs do not carry (the inbox, settings, the documents)
 * lives here on a phone. The button is small and sits at the top-right — where
 * a thumb reaches on a phone held in either hand — and opens a panel that
 * lists the destinations with a line each, so a menu is not just a column of
 * link text you must already know the meaning of.
 *
 * The panel closes on its own when the member navigates, presses Escape, or
 * taps anywhere outside it. Each behaviour is a separate listener with its own
 * reason: navigation means the menu's job is done, Escape is the keyboard's
 * way out, and an outside tap means the blackout behind the panel is the
 * obvious dismissal affordance.
 */
export function HamburgerMenu({ items, badge }: HamburgerMenuProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);

  // Navigated away — the menu no longer belongs to the screen being shown.
  useEffect(() => setOpen(false), [pathname]);

  // Tapped outside. Listening on capture keeps the target that was tapped from
  // also handling the event after this closes the panel.
  useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', dismiss, true);
    document.addEventListener('touchstart', dismiss, true);
    return () => {
      document.removeEventListener('mousedown', dismiss, true);
      document.removeEventListener('touchstart', dismiss, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div ref={containerRef} className="relative ml-auto md:hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-haspopup="menu"
        className="relative flex h-11 w-11 items-center justify-center rounded-full text-ink-700 transition hover:bg-brand-50 hover:text-brand-700"
      >
        {open ? (
          <Menu aria-hidden="true" className="h-6 w-6 rotate-90 transition-transform" strokeWidth={ICON_STROKE_WIDTH} />
        ) : (
          <Menu aria-hidden="true" className="h-6 w-6" strokeWidth={ICON_STROKE_WIDTH} />
        )}
        {badge > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-semibold text-white tabular-nums"
          >
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute top-full right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-brand-100 bg-white p-2 shadow-lg shadow-brand-950/5"
        >
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  role="menuitem"
                  className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-brand-50"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                    <MenuItemIcon href={item.href} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink-900">{item.label}</span>
                    <span className="block text-xs text-ink-600">{item.description}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One icon per known menu destination, by address. A destination without an
 * entry falls back to the settings sliders — a menu item should not render as
 * a blank square, and an honest fallback beats a crash or a missing icon.
 */
const MENU_ICONS_BY_PATH: ReadonlyArray<readonly [prefix: string, Icon: LucideIcon]> = [
  ['/notifications', Bell],
  ['/invites', Mail],
  ['/settings', SlidersHorizontal],
  ['/help', CircleHelp],
  ['/about', Info],
  ['/terms', FileText],
  ['/privacy', ShieldCheck],
];

function MenuItemIcon({ href, className }: { href: string; className: string }) {
  const match = MENU_ICONS_BY_PATH.find(([prefix]) => href === prefix || href.startsWith(`${prefix}/`));
  const Icon = match?.[1] ?? SlidersHorizontal;
  return <Icon aria-hidden="true" className={className} strokeWidth={ICON_STROKE_WIDTH} />;
}