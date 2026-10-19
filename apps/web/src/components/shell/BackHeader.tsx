'use client';

import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { subpageTitleFor } from '@/lib/navigation';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

interface BackHeaderProps {
  /** Where the back button lands when there is nothing to go back to. */
  home: string;
  /**
   * A fixed destination for the back button, when one exists.
   *
   * Most sub-pages are genuinely reached from several places, so history is right for
   * them. An individual work log is not: it is one record reached from the Logs list,
   * and going back to wherever the person happened to come from can strand them with no
   * route to the record they were looking at.
   */
  backTo?: string;
}

/**
 * The header of a page opened from the menu: a back icon and the page's name.
 *
 * One component decides the title, so the app shell and the public pages agree
 * on what "Invitations" or "Privacy Policy" is called, and a member who reaches
 * `/help` from either side gets the same header.
 *
 * The back icon returns where the member came from rather than to a fixed
 * address: these pages are reached from several places now, not one, so a
 * fixed destination would be wrong for everyone but one entrant. When there is
 * nothing to go back to — the page was opened directly, from a fresh tab or an
 * external link — the button falls back to the member's own home instead of
 * silently doing nothing. The `aria-label` carries the words for a screen
 * reader; a title with no match falls back to "Back" rather than rendering an
 * empty header for a route the map does not know.
 */
export function BackHeader({ home, backTo }: BackHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const title = subpageTitleFor(pathname);

  function goBack(): void {
    if (backTo) {
      router.push(backTo);
      return;
    }
    // `router.back()` navigates the browser's own history, which is exactly
    // what a back icon should do; but on a page that was entered directly the
    // history stack is empty and the call is a no-op. `history.length` is only
    // truthful in the browser, which is also the only place this runs.
    if (window.history.length > 1) {
      router.back();
    } else {
      router.replace(home);
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-brand-100 bg-white">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-1 px-2 py-2">
        <button
          type="button"
          onClick={goBack}
          aria-label="Back"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-700 transition hover:bg-brand-50 hover:text-brand-700"
        >
          <ArrowLeft aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
        </button>
        <h1 className="truncate text-lg font-semibold text-ink-900">{title ?? 'Back'}</h1>
      </div>
    </header>
  );
}