'use client';

import { useState } from 'react';
import { User } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

type AvatarSize = 'sm' | 'md' | 'lg';

const SIZES: Record<AvatarSize, { box: string; text: string; icon: string }> = {
  sm: { box: 'h-8 w-8', text: 'text-sm', icon: 'h-4 w-4' },
  md: { box: 'h-10 w-10', text: 'text-base', icon: 'h-5 w-5' },
  lg: { box: 'h-12 w-12', text: 'text-lg', icon: 'h-6 w-6' },
};

interface AvatarProps {
  /** The member's full name; its first letter is the fallback. */
  name: string | null;
  /** The profile photo, when there is one. */
  src: string | null;
  size?: AvatarSize;
}

/**
 * A member's face, or their initial when there is no face to show.
 *
 * The photo URL is a short-lived signed link, so a missing image is an ordinary
 * case rather than an error: the link may have expired, or the file may be gone.
 * The component remembers which URL failed and falls back to the initial for
 * that URL only, so a freshly minted link on the next render gets its chance.
 *
 * Decorative by design (`aria-hidden`): every place it appears sits next to the
 * name or inside a control that already carries an `aria-label`.
 */
export function Avatar({ name, src, size = 'md' }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const dims = SIZES[size];
  const showImage = Boolean(src) && failedSrc !== src;
  const initial = Array.from((name ?? '').trim())[0]?.toUpperCase() ?? null;

  if (showImage) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex shrink-0 overflow-hidden rounded-full border border-brand-100 bg-brand-50 ${dims.box}`}
      >
        {/*
          `onError` below is a load-failure hook rather than a user interaction, and
          the image is decorative — the name beside it carries the meaning — so the
          non-interactive-element rule is silenced for this one element rather than
          for the file. The img-element rule is off in the lint config, because
          every image here is a short-lived signed URL that must not be proxied.
        */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <img
          ref={(node) => {
            // An image that failed before React attached `onError` (server-rendered
            // markup, a cached 404) never fires the event, so check it here too.
            if (node && node.complete && node.naturalWidth === 0) setFailedSrc(src);
          }}
          src={src ?? undefined}
          alt=""
          draggable={false}
          onError={() => setFailedSrc(src)}
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full bg-brand-600 font-semibold text-white ${dims.box} ${dims.text}`}
    >
      {initial ?? <User className={dims.icon} strokeWidth={ICON_STROKE_WIDTH} />}
    </span>
  );
}
