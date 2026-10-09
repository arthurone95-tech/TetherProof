import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldCheck, UserRound, ChevronRight, type LucideIcon } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { currentProfile } from '@/lib/server/api';

export const metadata: Metadata = {
  title: 'Settings — TetherProof',
};

/**
 * The settings index: one entry per group of choices.
 *
 * Opened from the header menu, so the header shows a back icon and "Settings"
 * and the page carries no heading of its own. The privacy entry exists only for
 * workers — those choices (who may find you, invite you, and see your record)
 * are worker concepts, and an empty group would be worse than an absent one.
 * Account, which every role can delete, is the one entry everyone gets.
 */
export default async function SettingsPage() {
  const profile = await currentProfile();
  if (!profile) redirect('/login');

  const entries: Array<{ href: string; title: string; description: string; icon: LucideIcon }> = [
    {
      href: '/settings/account',
      title: 'Account',
      description: 'Delete your account and start its data cleanup.',
      icon: UserRound,
    },
    ...(profile.role === 'worker'
      ? [
          {
            href: '/settings/privacy',
            title: 'Privacy & sharing',
            description: 'Who may find you, invite you, and see your verified record.',
            icon: ShieldCheck,
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <ul className="flex flex-col gap-3">
        {entries.map((entry) => {
          const Icon = entry.icon;
          return (
            <li key={entry.href}>
              <Link
                href={entry.href}
                className="flex items-center gap-3 rounded-2xl border border-brand-100 bg-white p-4 transition-colors hover:border-brand-600"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink-900">{entry.title}</span>
                  <span className="block text-sm text-ink-600">{entry.description}</span>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 text-ink-400"
                  strokeWidth={ICON_STROKE_WIDTH}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}