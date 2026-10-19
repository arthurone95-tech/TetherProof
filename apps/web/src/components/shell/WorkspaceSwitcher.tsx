'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  ChevronDown,
  LayoutGrid,
  Repeat2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { UserCapability } from '@tetherproof/shared';
import { WORKSPACES } from '@/lib/navigation';
import { switchRole } from '@/lib/actions';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

/**
 * The roles, with the short mark each is known by.
 *
 * Letters rather than glyphs on purpose. These appear *inside* the selector, where the
 * thing being identified is the role and the control's own icon already says "this is the
 * selector". Four different icons here made the list look like four unrelated controls,
 * and they drifted towards the workspace icon the selector is meant to be distinct from.
 */
const ROLE_MARKS: Record<UserCapability, string> = {
  worker: 'W',
  trainee: 'T',
  training_provider: 'I',
  employer: 'H',
};

/**
 * One icon for the selector, always.
 *
 * It used to show the *active role's* icon, which made the control look like a different
 * control in each workspace and hid the fact that it was one control. A button whose
 * glyph depends on what you already selected has to be re-found every time. This never
 * changes — not by role, not by page.
 */
const SELECTOR_ICON = Repeat2;

/**
 * The role selector, in the header.
 *
 * ## Why the active role arrives as a prop
 *
 * This used to work the active role out from `usePathname`, with a fallback to "the first
 * capability you hold". Both halves were wrong. The URL says nothing about the role on
 * `/profile`, `/settings` or `/notifications`, so nothing could be marked active there; and
 * the fallback read capabilities in whatever order the database returned them, so standing
 * on one role's setup page could highlight a completely different one.
 *
 * The role is now resolved **once on the server** (`lib/server/active-role.ts`), from the
 * address first, then the remembered choice, then what is held — and re-validated against
 * the capabilities the database actually returned. It arrives here as `activeRole`, so this
 * component draws a single value instead of deciding anything. Two roles highlighted at once
 * is not guarded against here; it is unexpressible.
 *
 * ## Why choosing a role is a form, not a link
 *
 * A link would change the address and nothing else, which is not what switching is. Choosing
 * a role has to be recorded so a refresh stays put, and has to rebuild the navigation and
 * header for that role rather than only moving the label. A form posting to `switchRole`
 * does all three on the server, and works without JavaScript.
 *
 * ## It changes nothing about the account
 *
 * No capability is granted, revoked or altered by choosing one. `switchRole` only validates
 * that the target is reachable and records the preference. Granting happens on the setup
 * page, which is a separate, explicit step.
 */
export function WorkspaceSwitcher({
  capabilities,
  activeRole,
}: {
  capabilities: readonly UserCapability[];
  /** Resolved on the server. `null` only for an account holding no capability at all. */
  activeRole: UserCapability | null;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const all = Object.keys(WORKSPACES) as UserCapability[];

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!activeRole && capabilities.length === 0) return null;

  // The label follows the active role, because that is what the button is telling you.
  // The icon never does.
  const label = activeRole ? WORKSPACES[activeRole].label : 'Roles';

  return (
    /*
     * One wrapper carries the ref for BOTH the button and the panel. The outside-click
     * handler tests `contains()`, and the panel is not a descendant of the button — when
     * only the button was wrapped, tapping a role counted as "outside", the panel closed on
     * `mousedown`, and the link was detached before `click` could fire, so choosing a role
     * did nothing at all.
     *
     * It stays `relative` because the desktop dropdown is `absolute` and needs a positioned
     * ancestor. `position: relative` does not create a containing block for `position:
     * fixed`, so the phone's sheet still anchors to the viewport.
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
        <SELECTOR_ICON aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-700" strokeWidth={ICON_STROKE_WIDTH} />
        <span className="hidden truncate sm:inline">{label}</span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink-500" strokeWidth={ICON_STROKE_WIDTH} />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 md:absolute md:inset-auto md:left-4 md:top-[calc(100%+0.5rem)] md:w-72"
          role="presentation"
        >
          <button
            type="button"
            aria-label="Close role selector"
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-ink-900/40 md:hidden"
          />

          <div
            role="menu"
            aria-label="Your roles"
            className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl md:inset-auto md:bottom-auto md:left-0 md:top-0 md:w-72 md:rounded-2xl md:border md:border-brand-100 md:shadow-lg"
          >
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
                One account. Move between your roles without signing out.
              </p>
            </div>

            <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3">
              {all.map((id) => {
                const workspace = WORKSPACES[id];
                const isHeld = capabilities.includes(id);
                const isActive = id === activeRole;

                /*
                 * Active is drawn differently in *shape*, not just shade: a ring, a solid
                 * icon tile and a tick. It used to be the same white row with a marginally
                 * deeper background, and a touch screen keeps `:hover` latched on whatever
                 * you last pressed, so the row you had just tapped stayed highlighted and
                 * read as a second active role.
                 */
                const rowClass = isActive
                  ? 'bg-brand-100 ring-1 ring-brand-300'
                  : 'hover:bg-brand-50/70';

                return (
                  <li key={id}>
                    <form action={switchRole}>
                      <input type="hidden" name="role" value={id} />
                      <button
                        type="submit"
                        role="menuitem"
                        aria-current={isActive ? 'page' : undefined}
                        className={`flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${rowClass}`}
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
                          <span className="text-sm font-bold" aria-hidden="true">{ROLE_MARKS[id]}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                            {workspace.label}
                            {isActive ? (
                              <Check
                                aria-hidden="true"
                                className="h-4 w-4 text-brand-700"
                                strokeWidth={ICON_STROKE_WIDTH}
                              />
                            ) : null}
                          </span>
                          <span className="block text-xs text-ink-600">
                            {isHeld ? workspace.blurb : 'Not set up yet — tap to set up'}
                          </span>
                        </span>
                      </button>
                    </form>
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
                Roles and profiles
                <LayoutGrid aria-hidden="true" className="ml-auto h-3.5 w-3.5 text-ink-400" strokeWidth={ICON_STROKE_WIDTH} />
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}