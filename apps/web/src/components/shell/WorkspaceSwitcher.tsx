'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BadgeCheck,
  Building2,
  Check,
  ChevronDown,
  GraduationCap,
  Hammer,
  LayoutGrid,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { UserCapability } from '@tetherproof/shared';
import { WORKSPACES } from '@/lib/navigation';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

const ICONS: Record<UserCapability, LucideIcon> = {
  worker: Hammer,
  trainee: GraduationCap,
  training_provider: BadgeCheck,
  employer: Building2,
};

/**
 * The workspace selector, in the header.
 *
 * ## Why the header, and not a floating button
 *
 * A floating control has to live somewhere. The bottom-right corner is the obvious spot, but
 * a permanent button there competes with the bottom tab row for the thumb and will
 * eventually sit on top of whichever dashboard control is added next. The header already
 * carries the section title and the account menu, it is not crowded, and a control there is
 * where a person already looks for "which part of this am I in". One place, both widths, no
 * new permanent overlay over the content.
 *
 * ## One control, two shapes
 *
 * On a desktop the panel drops down from the header, anchored to the button. On a phone it
 * rises from the bottom edge as a sheet, because a dropdown anchored near the top of a
 * small screen either overflows or needs scrolling to reach. Same component and same
 * behaviour — only the positioning classes change at `md`.
 *
 * ## It shows all four capabilities, not only the ones held
 *
 * Tapping a capability you have switches to it. Tapping one you do not have goes to that
 * capability's setup page. That is how somebody discovers there is a second thing available
 * to them without already knowing it exists, which was the gap the old design left: the
 * only entry point was a tab shown to accounts that had nothing at all.
 *
 * ## It changes nothing
 *
 * No write and no confirmation — this opens a different window onto an account that already
 * exists. The only thing it can do is take you somewhere that *asks* for a decision, which
 * is a page's job. Switching is not a role change: it changes what is on screen, never who
 * you are, and never your password.
 *
 * Driven by the database-backed capability set, so a person cannot reach an area by being
 * shown it — and neither can a modified client, because every route re-checks the same
 * capabilities server-side.
 */
export function WorkspaceSwitcher({ capabilities }: { capabilities: readonly UserCapability[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const all = Object.keys(WORKSPACES) as UserCapability[];

  /*
   * The active role is decided **only** by where you are, never by guessing.
   *
   * The obvious "helpful" fallback — if no workspace matches, assume the first one you
   * hold — is wrong, and it was wrong in a way people noticed. `/setup/worker`, `/roles`,
   * `/profile` and `/settings` all belong to no workspace, so the fallback ticked whichever
   * capability happened to come first out of the database, which has no defined order.
   * Standing on the worker setup page would show "Hiring" ticked and the header button
   * labelled Hiring, while the page itself said you were setting up work. Two different
   * answers to "which am I in", from one screen.
   *
   * So: no match means no role is active, and the header says so plainly. `activeId` is
   * nullable and every mark of activity is drawn from it, which also makes two rows
   * highlighted impossible rather than unlikely.
   */
  const activeId =
    all.find(
      (id) => pathname === WORKSPACES[id].href || pathname.startsWith(`${WORKSPACES[id].href}/`),
    ) ?? null;

  // Something to name on the button when you are not inside a workspace.
  const label = activeId ? WORKSPACES[activeId].label : 'Roles';
  const TriggerIcon = activeId ? ICONS[activeId] : LayoutGrid;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: MouseEvent) => {
      // A tap outside closes it, except a tap that started inside — the desktop case.
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    // A sheet covers the page behind it, so the page behind must not scroll under it.
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!activeId && capabilities.length === 0) return null;

  return (
    /*
     * One wrapper carries the ref for BOTH the button and the panel, because the
     * outside-click handler uses `contains()` and the panel is not a descendant of the
     * button. When only the button was wrapped, a tap on a role counted as "outside", the
     * handler closed the panel on `mousedown`, and the link was detached before `click`
     * could fire — so tapping a role appeared to do nothing but close the menu.
     *
     * It stays `relative` rather than `display: contents`, because the desktop dropdown is
     * `absolute` and needs a positioned ancestor to hang from. `position: relative` does
     * **not** create a containing block for `position: fixed`, so the phone's sheet still
     * resolves against the viewport as intended — the two requirements do not conflict.
     * Making this `contents` to avoid an extra flex item would silently break the desktop
     * menu by letting it anchor to the page instead of the button.
     */
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex min-h-10 max-w-[9.5rem] items-center gap-1.5 rounded-xl border border-brand-100 bg-white px-2.5 text-sm font-semibold text-ink-800 transition-colors hover:bg-brand-50 sm:px-3"
      >
        <TriggerIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-700" strokeWidth={ICON_STROKE_WIDTH} />
        {/* Compact on a phone: the icon alone still says which workspace, and the label
            is in the sheet a tap away. The full name fits comfortably from `sm` up. */}
        <span className="hidden truncate sm:inline">{label}</span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink-500" strokeWidth={ICON_STROKE_WIDTH} />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 md:absolute md:inset-auto md:left-4 md:top-[calc(100%+0.5rem)] md:w-72"
          role="presentation"
        >
          {/* Scrim: closes on a tap outside, and on desktop it is only behind the menu. */}
          <button
            type="button"
            aria-label="Close workspace selector"
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-ink-900/40 md:hidden"
          />

          <div
            role="menu"
            aria-label="Your workspaces"
            className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl md:inset-auto md:bottom-auto md:left-0 md:top-0 md:w-72 md:rounded-2xl md:border md:border-brand-100 md:shadow-lg"
          >
            {/* Sheet grab handle and close button: phone only, where there is no other
                affordance for dismissing a panel that covers the screen. */}
            <div className="flex items-center justify-between px-5 pt-3 pb-1 md:hidden">
              <span aria-hidden="true" className="h-1.5 w-10 rounded-full bg-neutral-200" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="-mt-1 ml-auto flex h-9 w-9 items-center justify-center rounded-full text-ink-500"
              >
                <X aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
              </button>
            </div>

            <div className="px-5 pt-2 pb-3">
              <h2 className="text-base font-bold text-ink-900">Switch role</h2>
              <p className="mt-0.5 text-xs text-ink-600">
                One account. Move between them without signing out.
              </p>
            </div>

            <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3">
              {all.map((id) => {
                const workspace = WORKSPACES[id];
                const Icon = ICONS[id];
                const isHeld = capabilities.includes(id);
                const isActive = id === activeId;
                // Held capabilities go to their workspace; the rest go to setup, because
                // arriving at an empty workspace and being told it is empty is a worse
                // first impression than being asked to switch one on.
                const href = isHeld ? workspace.href : `/setup/${id}`;

                /*
                 * The active row is drawn differently in **shape**, not just shade: a ring,
                 * a solid icon tile and a tick. It used to be the same white row with a
                 * marginally deeper background, and a touch screen keeps `:hover` latched
                 * on whatever you last tapped — so the row you had just pressed stayed
                 * highlighted and read as a second active role. Two roles highlighted at
                 * once is now impossible: `isActive` comes from a single nullable value.
                 */
                const rowClass = isActive ? 'bg-brand-100 ring-1 ring-brand-300' : 'hover:bg-brand-50/70';

                return (
                  <li key={id}>
                    <Link
                      href={href}
                      role="menuitem"
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => setOpen(false)}
                      className={`flex items-start gap-3 rounded-2xl px-3 py-3 transition-colors ${rowClass}`}
                    >
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                          isActive
                            ? 'bg-brand-600 text-white'
                            : isHeld
                              ? 'bg-brand-50 text-brand-700'
                              : 'bg-neutral-100 text-ink-500'
                        }`}
                      >
                        <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                          {workspace.label}
                          {isActive ? (
                            <Check aria-hidden="true" className="h-4 w-4 text-brand-700" strokeWidth={ICON_STROKE_WIDTH} />
                          ) : null}
                        </span>
                        <span className="block text-xs text-ink-600">
                          {isHeld ? workspace.blurb : 'Not set up yet — tap to set up'}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="border-t border-neutral-100 bg-neutral-50/70 p-3">
              <Link
                href="/roles"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
              >
                <SlidersHorizontal aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
                Manage roles
                <LayoutGrid aria-hidden="true" className="ml-auto h-3.5 w-3.5 text-ink-400" strokeWidth={ICON_STROKE_WIDTH} />
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}