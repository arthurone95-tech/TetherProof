import Link from 'next/link';
import { BackHeader } from '@/components/shell/BackHeader';
import { homeFor } from '@/lib/navigation';
import { currentProfile } from '@/lib/server/api';

/**
 * The frame for the secondary pages: About, Help, Terms, Privacy.
 *
 * These are public — a worker or employer can reach them from the header menu
 * or from the marketing footer — so the frame branches on who is reading.
 *
 * A signed-in member gets the same header as every other page opened from the
 * menu: a back icon to the previous page and the page's name, with no footer
 * and no tab row. That is the point of these pages when opened from inside the
 * app — a focused screen reachable from one list, with one obvious way back —
 * and a signed-in visitor has no use for a "Sign in" link or a marketing footer
 * beside it.
 *
 * A signed-out visitor gets the marketing frame: the brand mark, a sign-in
 * path, and a slim footer that keeps the four sibling pages linked as one small
 * site rather than four dead ends.
 */
export default async function InfoLayout({ children }: { children: React.ReactNode }) {
  const profile = await currentProfile();

  if (profile) {
    return (
      <div className="flex min-h-screen flex-col">
        <BackHeader home={homeFor(profile.role)} />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
          <article className="flex flex-col gap-8">{children}</article>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-brand-100 bg-white">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
          <Link
            href="/"
            className="text-lg font-semibold tracking-wide text-brand-600 hover:text-brand-700"
          >
            TetherProof
          </Link>

          <Link
            href="/login"
            className="ml-auto text-sm font-semibold text-brand-700 hover:text-brand-800"
          >
            Sign in
          </Link>
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
          <span className="ml-auto">© {new Date().getFullYear()} TetherProof</span>
        </nav>
      </footer>
    </div>
  );
}
