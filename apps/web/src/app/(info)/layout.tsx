import Link from 'next/link';
import { ProfileAvatar } from '@/components/shell/ProfileAvatar';
import { homeFor } from '@/lib/navigation';
import { currentProfile } from '@/lib/server/api';

/**
 * The frame for the secondary pages: About, Help, Terms, Privacy.
 *
 * These are public — a worker or employer can reach them from the More page or
 * from the marketing footer — so they get a slim frame of their own instead of
 * the app's full chrome, and a slim footer keeps the four sibling pages linked
 * as one small site rather than four dead ends.
 *
 * The header is the one thing the frame branches on. A signed-in visitor keeps
 * the account avatar at the top-right, the same corner as every other signed-in
 * page, so reaching Help from the app does not drop them onto a "Sign in" link
 * that denies they are signed in at all. A signed-out visitor gets the
 * marketing header: the brand mark and a sign-in path. Signed-in visitors also
 * get a "More" link in the footer, so invitations and settings stay reachable
 * from a static page without re-drawing the app's tabs.
 */
export default async function InfoLayout({ children }: { children: React.ReactNode }) {
  const profile = await currentProfile();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-brand-100 bg-white">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
          <Link
            href={profile ? homeFor(profile.role) : '/'}
            className="text-lg font-semibold tracking-wide text-brand-600 hover:text-brand-700"
          >
            TetherProof
          </Link>

          {profile ? (
            <Link
              href="/profile"
              aria-label="Your profile"
              className="ml-auto rounded-full ring-2 ring-transparent transition hover:ring-brand-200"
            >
              <ProfileAvatar avatarUrl={profile.avatarUrl} size="sm" />
            </Link>
          ) : (
            <Link
              href="/login"
              className="ml-auto text-sm font-semibold text-brand-700 hover:text-brand-800"
            >
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <article className="flex flex-col gap-8">{children}</article>
      </main>

      <footer className="border-t border-brand-100 bg-white">
        <nav
          aria-label="Legal and support pages"
          className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-6 text-sm text-ink-600"
        >
          <Link href="/about" className="hover:text-ink-900">
            About
          </Link>
          <Link href="/help" className="hover:text-ink-900">
            Help
          </Link>
          <Link href="/terms" className="hover:text-ink-900">
            Terms &amp; Conditions
          </Link>
          <Link href="/privacy" className="hover:text-ink-900">
            Privacy Policy
          </Link>
          {profile ? (
            <Link href="/more" className="hover:text-ink-900">
              More
            </Link>
          ) : null}
          <span className="ml-auto">© {new Date().getFullYear()} TetherProof</span>
        </nav>
      </footer>
    </div>
  );
}