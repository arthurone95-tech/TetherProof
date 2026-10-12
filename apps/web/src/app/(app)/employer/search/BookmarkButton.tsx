'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

/**
 * The bookmark control on one candidate card.
 *
 * The star is its own button, so tapping it cannot be mistaken for opening the
 * card or sending an invitation. It is labelled from the masked skill rather than
 * a name, because the candidate is anonymous until they accept and the label is
 * read aloud.
 *
 * There is no stored bookmark in the product yet, so this is the interaction
 * only: the star flips for as long as the result is on screen and does not
 * survive a reload or reach another device. It is intentionally not keyed to the
 * candidate handle, which is short-lived and scoped to one employer and is not a
 * durable worker identity.
 */
export function BookmarkButton({ label }: { label: string }) {
  const [bookmarked, setBookmarked] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setBookmarked((current) => !current)}
      aria-pressed={bookmarked}
      aria-label={bookmarked ? `Remove bookmark for ${label}` : `Bookmark ${label}`}
      title={bookmarked ? 'Bookmarked' : 'Bookmark candidate'}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
        bookmarked
          ? 'text-amber-500 hover:bg-amber-50'
          : 'text-ink-400 hover:bg-brand-50 hover:text-ink-700'
      }`}
    >
      <Star
        aria-hidden="true"
        className={`h-5 w-5 ${bookmarked ? 'fill-current' : ''}`}
        strokeWidth={ICON_STROKE_WIDTH}
      />
    </button>
  );
}
