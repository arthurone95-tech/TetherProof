'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { usePathname } from 'next/navigation';
import {
  CircleHelp,
  FileText,
  Info,
  LogOut,
  ShieldCheck,
  SlidersHorizontal,
  User,
  type LucideIcon,
} from 'lucide-react';
import { ACCOUNT_MENU, type MenuIcon } from '@/lib/navigation';
import { signOut } from '@/lib/actions';
import { Avatar } from '@/components/ui/Avatar';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

/** What the menu says about the signed-in member. Email is deliberately absent: the profile has none. */
export interface AccountSummary {
  name: string | null;
  /** Organisation when there is one, otherwise the role ("Worker", "Employer"). */
  subtitle: string;
  avatarUrl: string | null;
}

/**
 * The account menu: the member's avatar in the header, opening the screens that
 * are about the account and the product rather than the work.
 *
 * It replaces the phone-only hamburger and is shown at every width, so Profile,
 * Help and the documents are reachable the same way on a phone and on a desktop.
 * Settings is the one row that depends on the workspace: a worker reaches their
 * privacy choices and account deletion from Profile, so the menu does not offer
 * a second door to them, while every other workspace keeps Settings. The panel
 * starts with who is signed in (photo or initial, name, and the organisation or
 * role), then the destinations in three groups.
 *
 * Dismissal is the same set of listeners the old menu had, each for its own
 * reason: navigating means the menu's job is done, Escape is the keyboard's way
 * out (and hands focus back to the avatar), and a tap outside is the obvious
 * dismissal on a touch screen. Arrow keys, Home and End move between rows, so the
 * menu is usable without a pointer.
 */
export function AccountMenu({
  account,
  showSettings,
}: {
  account: AccountSummary;
  showSettings: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Navigated away — the menu no longer belongs to the screen being shown.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Tapped outside. Listening on capture keeps the tapped target from also
  // handling the event after this closes the panel.
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

  // Escape closes and returns focus to where the member opened the menu from.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Move focus into the panel so arrow keys work straight away.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  function onPanelKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const rows = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (rows.length === 0) return;
    const current = rows.indexOf(document.activeElement as HTMLElement);

    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = current < 0 ? 0 : (current + 1) % rows.length;
        break;
      case 'ArrowUp':
        next = current <= 0 ? rows.length - 1 : current - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = rows.length - 1;
        break;
      case 'Tab':
        setOpen(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    rows[next]?.focus();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-brand-50 md:h-10 md:w-10 ${
          open ? 'bg-brand-50' : ''
        }`}
      >
        <Avatar name={account.name} src={account.avatarUrl} size="sm" />
      </button>

      {open ? (
        <div
          ref={panelRef}
          tabIndex={-1}
          onKeyDown={onPanelKeyDown}
          className="absolute top-full right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-lg shadow-brand-950/5 outline-none"
        >
          <div className="flex items-center gap-3 px-4 py-4">
            <Avatar name={account.name} src={account.avatarUrl} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-ink-900">
                {account.name?.trim() || 'Your account'}
              </p>
              <p className="truncate text-sm text-ink-600">{account.subtitle}</p>
            </div>
          </div>

          <div role="menu" aria-label="Account">
            {ACCOUNT_MENU.map((group) => (
              <div key={group.id} role="group" className="border-t border-brand-100 p-2">
                {group.items
                  /*
                    Settings belongs to every workspace except the worker's. A worker's
                    privacy choices and account deletion live on Profile, so an entry
                    here would be a second door to the same two things — and the menu
                    would name a destination that has nothing of its own. The filter is
                    by active workspace, not by account: a person who is also an employer
                    still finds Settings the moment they switch to that role.
                  */
                  .filter((item) => showSettings || item.href !== '/settings')
                  .map((item) => {
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        role="menuitem"
                        tabIndex={-1}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => setOpen(false)}
                        className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:bg-brand-50 focus-visible:outline-none ${
                          active ? 'bg-brand-50 text-brand-700' : 'text-ink-900 hover:bg-brand-50'
                        }`}
                      >
                        <MenuRowIcon name={item.icon} className="h-5 w-5 shrink-0 text-ink-600" />
                        {item.label}
                      </Link>
                    );
                  })}
              </div>
            ))}

            {/*
              Sign out sits in the header menu rather than as a section on the
              Profile page. It belongs to the account, which the menu already
              speaks for, and it is then one tap away on every screen instead of
              a card on one screen. The row is a normal menu row — full label,
              44px target — but it submits rather than navigating: ending the
              session is a decision, not a destination.
            */}
            <div role="group" className="border-t border-brand-100 p-2">
              <form action={signOut}>
                <button
                  type="submit"
                  role="menuitem"
                  tabIndex={-1}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-ink-900 transition-colors hover:bg-brand-50 focus-visible:bg-brand-50 focus-visible:outline-none"
                >
                  <LogOut
                    aria-hidden="true"
                    className="h-5 w-5 shrink-0 text-ink-600"
                    strokeWidth={ICON_STROKE_WIDTH}
                  />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** One glyph per menu destination. Exhaustive by type: a new `MenuIcon` without a glyph fails to compile. */
const MENU_ICONS: Record<MenuIcon, LucideIcon> = {
  profile: User,
  settings: SlidersHorizontal,
  help: CircleHelp,
  about: Info,
  terms: FileText,
  privacy: ShieldCheck,
};

function MenuRowIcon({ name, className }: { name: MenuIcon; className: string }) {
  const Icon = MENU_ICONS[name];
  return <Icon aria-hidden="true" className={className} strokeWidth={ICON_STROKE_WIDTH} />;
}
