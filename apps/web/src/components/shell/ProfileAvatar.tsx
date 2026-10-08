/**
 * The member's photo, or a plain person icon when they have not uploaded one.
 *
 * `avatarUrl` is a short-lived signed URL from the API and nothing else — never
 * a storage path and never a client-supplied address — so an `<img>` is safe to
 * render directly. The placeholder is a person icon rather than initials or an
 * abbreviation: the top-right header avatar stands in for the account itself,
 * and the account's name is shown where the account is read, not stamped onto a
 * circle everywhere.
 */
import { User } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
export function ProfileAvatar({
  avatarUrl,
  size = 'md',
  alt = '',
}: {
  avatarUrl: string | null;
  /** `sm` for a header, `md` beside profile details, `lg` in the photo editor. */
  size?: 'sm' | 'md' | 'lg';
  alt?: string;
}) {
  const frame =
    size === 'sm' ? 'h-10 w-10' : size === 'md' ? 'h-20 w-20' : 'h-36 w-36';
  const iconSize = size === 'sm' ? 'h-5 w-5' : 'h-8 w-8';

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={alt}
        className={`${frame} shrink-0 rounded-full object-cover ring-1 ring-brand-100`}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={`${frame} flex shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 ring-1 ring-brand-100`}
    >
      <User className={iconSize} strokeWidth={ICON_STROKE_WIDTH} />
    </div>
  );
}