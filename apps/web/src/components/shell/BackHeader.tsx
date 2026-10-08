'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { subpageTitleFor } from '@/lib/navigation';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

/**
 * The header of a page opened from More: a back icon and the page's name.
 *
 * One component decides the title, so the app shell and the public pages agree
 * on what "Invitations" or "Privacy Policy" is called, and a member who reaches
 * `/help` from either side gets the same header. The back icon returns to More —
 * the only place these pages are reached from — and carries no visible "Back"
 * label: the arrow and the title beside it say where it goes, and the
 * `aria-label` carries the words for a screen reader.
 *
 * A title with no match falls back to More rather than rendering an empty
 * header: the route should not exist if the map does not know it, and a link
 * home beats a blank bar.
 */
export function BackHeader() {
  const pathname = usePathname();
  const title = subpageTitleFor(pathname);

  return (
    <header className="sticky top-0 z-40 border-b border-brand-100 bg-white">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-1 px-2 py-2">
        <Link
          href="/more"
          aria-label="Back to More"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-700 transition hover:bg-brand-50 hover:text-brand-700"
        >
          <ArrowLeft
            aria-hidden="true"
            className="h-5 w-5"
            strokeWidth={ICON_STROKE_WIDTH}
          />
        </Link>
        <h1 className="truncate text-lg font-semibold text-ink-900">{title ?? 'More'}</h1>
      </div>
    </header>
  );
}
