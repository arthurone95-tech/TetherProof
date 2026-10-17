import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Building2, ChevronRight, ShieldCheck, Trash2, UserRound, type LucideIcon } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { currentProfile } from '@/lib/server/api';

export const metadata: Metadata = {
  title: 'Settings — TetherProof',
};

interface Entry {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

/**
 * The settings index: real, grouped choices.
 *
 * Everything here is something the account can actually save and the API
 * enforces. The entries are grouped by what they are about — the member's own
 * details, the worker's sharing preferences, and — kept apart and marked
 * destructive — deleting the account. A group that would be empty is left out
 * instead of shown as a heading with nothing under it: an employer has no
 * worker privacy choices, and inventing a decoration for that would imply a
 * setting they do not have.
 */
export default async function SettingsPage() {
  const profile = await currentProfile();
  if (!profile) redirect('/login');

  const account: Entry[] = [
    {
      href: '/profile',
      title: 'Your profile',
      description: 'Your name, photo, and location.',
      icon: UserRound,
    },
  ];

  if (profile.capabilities.includes('employer')) {
    account.push({
      href: '/employer/organization',
      title: 'Organization',
      description: 'Your company name and the point searches measure from.',
      icon: Building2,
    });
  }

  const preferences: Entry[] =
    profile.capabilities.includes('worker')
      ? [
          {
            href: '/settings/privacy',
            title: 'Privacy & sharing',
            description: 'Who may find you, invite you, and see your verified record.',
            icon: ShieldCheck,
          },
        ]
      : [];

  const danger: Entry = {
    href: '/settings/account',
    title: 'Delete account',
    description: 'Remove your account and start its data cleanup. This cannot be undone.',
    icon: Trash2,
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-7">
      <SettingsGroup title="Account" entries={account} />

      {preferences.length > 0 ? <SettingsGroup title="Privacy" entries={preferences} /> : null}

      <section aria-labelledby="danger-heading" className="flex flex-col gap-3">
        <h2
          id="danger-heading"
          className="px-1 text-xs font-bold tracking-wider text-ink-500 uppercase"
        >
          Danger zone
        </h2>
        <ul className="flex flex-col gap-3">
          <SettingsRow entry={danger} danger />
        </ul>
      </section>
    </div>
  );
}

function SettingsGroup({ title, entries }: { title: string; entries: Entry[] }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="px-1 text-xs font-bold tracking-wider text-ink-500 uppercase">{title}</h2>
      <ul className="flex flex-col gap-3">
        {entries.map((entry) => (
          <SettingsRow key={entry.href} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

function SettingsRow({ entry, danger = false }: { entry: Entry; danger?: boolean }) {
  const Icon = entry.icon;
  return (
    <li>
      <Link
        href={entry.href}
        className={`flex items-center gap-3 rounded-2xl border bg-white p-4 transition-colors ${
          danger ? 'border-red-200 hover:border-red-500' : 'border-brand-100 hover:border-brand-600'
        }`}
      >
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            danger ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand-700'
          }`}
        >
          <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block font-semibold ${danger ? 'text-red-800' : 'text-ink-900'}`}>
            {entry.title}
          </span>
          <span className="block text-sm text-ink-600">{entry.description}</span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className={`h-5 w-5 shrink-0 ${danger ? 'text-red-700' : 'text-ink-400'}`}
          strokeWidth={ICON_STROKE_WIDTH}
        />
      </Link>
    </li>
  );
}
