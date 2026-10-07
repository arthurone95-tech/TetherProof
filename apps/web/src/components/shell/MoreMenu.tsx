'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { MoreItem } from '@/lib/navigation';

/**
 * The secondary navigation: a hamburger on a phone, a "More" control on a
 * wide screen, opening the same list of destinations.
 *
 * The four primary tabs stay on the bar/bottom row; everything that is real
 * but not daily — invitations, settings, and the static pages — lives behind
 * this. One component for both breakpoints so the two can never drift apart
 * about where something lives.
 *
 * Dismissal is thorough because this hangs off the sticky header: tapping the
 * page, pressing Escape, or navigating must all take it down, and the trigger
 * keeps `aria-expanded` so the state is not a visual secret.
 */
export function MoreMenu({ items }: { items: MoreItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // A navigation dismisses the menu, so it never sits open over a new page.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More options"
        className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-ink-600 transition-colors hover:bg-brand-50 hover:text-ink-900"
      >
        <MenuIcon className="h-5 w-5" />
        <span className="hidden md:inline">More</span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="More options"
          className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-brand-100 bg-white py-1 shadow-lg"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              className="flex min-h-11 items-center px-4 text-sm font-medium text-ink-700 hover:bg-brand-50 hover:text-ink-900"
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MenuIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M4 6.5h16M4 12h16M4 17.5h16" />
    </svg>
  );
}