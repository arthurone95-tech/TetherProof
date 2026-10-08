import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { moreFor } from '@/lib/navigation';
import { currentProfile } from '@/lib/server/api';

export const metadata: Metadata = {
  title: 'More — TetherProof',
};

/**
 * Everything less than daily, in one place.
 *
 * The header carries the account (the avatar) and the tabs carry what a role
 * does day to day; this page is the flat list of what a member needs sometimes —
 * invitations, settings, and the four static pages. It is a page rather than a
 * dropdown so each destination gets a real link with the app frame around it,
 * and the phone's bottom-right corner has a stable, thumb-sized entry point.
 */
export default async function MorePage() {
  const user = await currentProfile();
  if (!user) redirect('/login');

  const items = moreFor(user.role);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-ink-900 sm:text-3xl">More</h1>
        <p className="mt-1 text-ink-600">The rest of your account, when you need it.</p>
      </header>

      <Card title="Everything else">
        <ul className="divide-y divide-brand-100">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group flex items-center justify-between gap-4 px-1 py-4 text-ink-900 transition hover:text-brand-700"
              >
                <span className="font-medium">{item.label}</span>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-4 w-4 text-ink-400 transition group-hover:text-brand-600"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-sm text-ink-600">
        Signed in as {user.fullName ?? 'this account'}.
      </p>
    </div>
  );
}