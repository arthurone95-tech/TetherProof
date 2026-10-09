import type { Metadata } from 'next';
import Link from 'next/link';
import { BadgeCheck, ShieldCheck } from 'lucide-react';
import type { PublicCapabilityProfileResponse } from '@tetherproof/shared';
import { ApiRequestError } from '@/lib/api-error';
import { skillLevelLabel } from '@/lib/capabilities';
import { apiPublic } from '@/lib/server/api';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

export const metadata: Metadata = {
  title: 'Capability profile — TetherProof',
};

// A share page reflects its subject's live record, so it is rendered per
// request and never cached — the API answers it with no-store for the same reason.
export const dynamic = 'force-dynamic';

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The read-only capability profile behind a worker's shareable link.
 *
 * Anyone can open this page, so it deliberately shows the narrow slice a
 * stranger is entitled to see: the name, the skills, the verified counts, and
 * nothing else — no media, no location, no contact details, no record of where
 * the proof came from. The address itself is the gate: it is generated once,
 * cannot be searched for, and belongs only to the worker.
 */
export default async function ShareProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let profile: PublicCapabilityProfileResponse;
  try {
    profile = await apiPublic<PublicCapabilityProfileResponse>(
      `/public/profiles/${encodeURIComponent(slug)}`,
    );
  } catch (error) {
    // Every missing shape — never enabled, wrong address, account gone — is the
    // same 404, so a probe cannot tell which of those it hit. Any other failure
    // is infrastructure, and is reported by the nearest error boundary.
    if (error instanceof ApiRequestError && error.status === 404) return <NotFound />;
    throw error;
  }

  return (
    <main className="flex min-h-screen flex-col bg-brand-50/50">
      <header className="border-b border-brand-100 bg-white">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-4">
          <Link href="/" className="text-lg font-semibold tracking-wide text-brand-600 hover:text-brand-700">
            TetherProof
          </Link>
          <span className="ml-auto rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
            Capability profile
          </span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <section className="rounded-2xl border border-brand-100 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-brand-700">
                {profile.verifiedTotal} verified proof{profile.verifiedTotal === 1 ? '' : 's'}
              </p>
              <h1 className="mt-1 text-2xl font-bold text-ink-900">
                {profile.displayName ?? 'A TetherProof worker'}
              </h1>
              <p className="mt-1 text-sm text-ink-600">
                Skills this worker has demonstrated and had verified by the people they worked
                with.
              </p>
            </div>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
              <BadgeCheck aria-hidden="true" className="h-6 w-6" strokeWidth={ICON_STROKE_WIDTH} />
            </span>
          </div>
        </section>

        <section className="mt-6">
          <h2 className="text-sm font-semibold tracking-wide text-ink-900 uppercase">Skills</h2>
          {profile.skills.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-3">
              {profile.skills.map((skill) => (
                <li
                  key={skill.skillTag}
                  className="rounded-2xl border border-brand-100 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-900">{skill.skillTag}</p>
                      <p className="mt-0.5 text-sm text-ink-600">
                        {skill.verifiedProofs} verified proof{skill.verifiedProofs === 1 ? '' : 's'}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                      {skillLevelLabel(skill.skillLevel)}
                    </span>
                  </div>
                  {skill.lastVerifiedAt ? (
                    <p className="mt-2 text-xs text-ink-500">
                      Last verified {DATE_FORMATTER.format(new Date(skill.lastVerifiedAt))}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-2xl border border-dashed border-brand-200 bg-white p-6 text-center text-sm text-ink-600">
              No verified skills yet.
            </p>
          )}
        </section>

        <p className="mt-8 flex items-center justify-center gap-2 text-center text-xs text-ink-600">
          <ShieldCheck aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
          This page shows verified aggregates only — no media, location, or contact details.
        </p>
      </div>
    </main>
  );
}

/** The friendly dead-end for a page that does not exist or was turned off. */
function NotFound() {
  return (
    <main className="flex min-h-screen flex-col bg-brand-50/50">
      <header className="border-b border-brand-100 bg-white">
        <div className="mx-auto flex w-full max-w-2xl items-center px-4 py-4">
          <Link href="/" className="text-lg font-semibold tracking-wide text-brand-600 hover:text-brand-700">
            TetherProof
          </Link>
        </div>
      </header>
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 text-center">
        <p className="text-lg font-semibold text-ink-900">This capability profile is not available</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-600">
          The link may be wrong, or the worker may have turned their public page off.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center rounded-xl border border-brand-600 px-5 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
        >
          Go to TetherProof
        </Link>
      </div>
    </main>
  );
}