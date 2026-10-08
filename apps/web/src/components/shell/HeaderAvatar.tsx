'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ProfileAvatar } from './ProfileAvatar';

/**
 * The account corner at the top-right of the signed-in header.
 *
 * It is a client component because what belongs in the corner depends on where
 * the member is standing. The avatar links to the profile page — the one place
 * on the app where a photo and the account already fill the screen. Pointing at
 * it from its own page would be an anchor to where the user already is, so the
 * corner goes silent there and the page's own avatar (the large one under the
 * heading) stands in for it. Everywhere else the avatar stays, unchanged.
 *
 * The rule mirrors the nav's, so a future nested profile route is covered the
 * same way: active on `/profile` and anything beneath it.
 */
export function HeaderAvatar({ avatarUrl }: { avatarUrl: string | null }) {
  const pathname = usePathname();
  const onProfile = pathname === '/profile' || pathname.startsWith('/profile/');
  if (onProfile) return null;

  return (
    <Link
      href="/profile"
      aria-label="Your profile"
      className="ml-auto rounded-full ring-2 ring-transparent transition hover:ring-brand-200"
    >
      <ProfileAvatar avatarUrl={avatarUrl} size="sm" />
    </Link>
  );
}