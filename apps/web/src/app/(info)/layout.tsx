import Link from 'next/link';

/**
 * The frame for the secondary pages: About, Help, Terms, Privacy.
 *
 * These are public — a worker or employer can reach them from the signed-in
 * more menu or from the marketing footer — so they get the marketing brand
 * mark and a sign-in path, and a slim footer of their own instead of the app's
 * full chrome. Keeping their sibling pages linked at the bottom means the
 * policy pages form one small site rather than four dead ends.
 */
export default function InfoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-brand-100 bg-white">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3">
          <Link
            href="/"
            className="text-sm font-semibold tracking-wide text-brand-600 uppercase hover:text-brand-700"
          >
            TetherProof
          </Link>
          <Link
            href="/login"
            className="text-sm font-semibold text-brand-700 hover:text-brand-800"
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