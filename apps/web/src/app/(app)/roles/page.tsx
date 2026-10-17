import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  Check,
  CircleCheck,
  GraduationCap,
  Hammer,
  type LucideIcon,
} from 'lucide-react';
import type { CapabilitiesResponse, UserCapability } from '@tetherproof/shared';
import { apiServer, currentProfile } from '@/lib/server/api';
import { WORKSPACES } from '@/lib/navigation';
import { CapabilitySetup } from '@/components/capabilities/CapabilitySetup';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

export const metadata: Metadata = {
  title: 'Roles and profiles — TetherProof',
};

const ICONS: Record<UserCapability, LucideIcon> = {
  worker: Hammer,
  trainee: GraduationCap,
  training_provider: BadgeCheck,
  employer: Building2,
};

/**
 * Managing what this account may do.
 *
 * ## Why this lives in settings and not on the dashboard
 *
 * A dashboard answers "what is going on in the part I am working in". Setting up a fourth
 * area is not that — it is maintenance of the account itself, it happens rarely, and it is
 * the same task whichever workspace you happen to be standing in. Leaving it on the
 * dashboard meant that switching to work meant also seeing four setup cards, which is the
 * one thing the dashboard should not be doing.
 *
 * ## Why it lists all four rather than only what is missing
 *
 * The question here is not "what can I do" — it is "what else could I do". Hiding the two
 * already held would make this look like a to-do list and would hide the fact that being
 * both a worker and a student is supported rather than accidental.
 */
export default async function CapabilitiesSettingsPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');

  const described = await apiServer<CapabilitiesResponse>('/auth/capabilities');

  const held = described.capabilities.filter((entry) => entry.held);
  const available = described.capabilities.filter((entry) => !entry.held);

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/roles"
        className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-ink-900"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
        Settings
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-ink-900">Roles &amp; profiles</h1>
        <p className="text-sm text-ink-600">
          One account, and as many of these as you need. Switch between them from the
          workspace button without signing out, and each keeps its own records.
        </p>
      </header>

      {held.length > 0 ? (
        <section aria-labelledby="active-heading" className="flex flex-col gap-2">
          <h2 id="active-heading" className="px-1 text-xs font-bold uppercase tracking-wider text-ink-500">
            Active
          </h2>
          <ul className="flex flex-col gap-2 sm:grid sm:grid-cols-2">
            {held.map((entry) => {
              const workspace = WORKSPACES[entry.capability];
              const Icon = ICONS[entry.capability];
              return (
                <li key={entry.capability}>
                  <Link
                    href={workspace.href}
                    className="group flex items-start gap-3 rounded-2xl border border-brand-200 bg-brand-50/50 p-4 shadow-sm transition-colors hover:border-brand-300"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand-700 shadow-sm">
                      <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                        {workspace.label}
                        <CircleCheck aria-hidden="true" className="h-4 w-4 text-emerald-600" strokeWidth={ICON_STROKE_WIDTH} />
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-600">{workspace.blurb}</span>
                      {entry.grantSource === 'legacy' ? (
                        <span className="mt-1 block text-[11px] text-ink-500">
                          Carried over from before capabilities existed.
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {available.length > 0 ? (
        <section aria-labelledby="available-heading" className="flex flex-col gap-3">
          <h2 id="available-heading" className="px-1 text-xs font-bold uppercase tracking-wider text-ink-500">
            {held.length > 0 ? 'You can also add' : 'Set up'}
          </h2>
          <ul className="flex flex-col gap-2 sm:grid sm:grid-cols-2">
            {available.map((entry) => {
              const Icon = ICONS[entry.capability];
              return (
                <li key={entry.capability}>
                  <CapabilitySetup
                    capability={entry.capability}
                    howToActivate={entry.howToActivate}
                    icon={<Icon aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <div className="flex items-center gap-2 rounded-2xl border border-brand-100 bg-white p-5 shadow-sm">
          <Check aria-hidden="true" className="h-5 w-5 text-emerald-600" strokeWidth={ICON_STROKE_WIDTH} />
          <p className="text-sm text-ink-700">
            Every capability is on. There is nothing left to set up.
          </p>
        </div>
      )}

      {held.length > 1 ? (
        <p className="text-xs text-ink-600">
          Use the workspace button to move between them. On a phone it floats near the
          bottom corner; on a desktop it sits in the header.
        </p>
      ) : null}
    </div>
  );
}