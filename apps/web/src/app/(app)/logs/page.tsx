import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ProofsResponse } from '@tetherproof/shared';
import { ProofListItemView } from '@/components/proofs/ProofListItemView';
import { apiServer, currentProfile } from '@/lib/server/api';

export const metadata: Metadata = {
  title: 'Your logs — TetherProof',
};

/**
 * The worker's logbook: every job they have logged, newest first.
 *
 * Each row is a thumbnail square, the skill and verdict, and the description.
 * Rows link to the entry's own screen, where the detail — including the full
 * media — and the edit form live. Everything comes from the caller's own rows
 * via the server, and the media URLs are short-lived signed links minted for
 * this exact request.
 */
export default async function LogsPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  if (user.role !== 'worker') redirect(user.role === 'employer' ? '/employer' : '/pending');

  const { proofs } = await apiServer<ProofsResponse>('/workers/proofs');

  return (
    <div className="flex flex-col gap-6">
      {/* The header carries the section's name; the list speaks for itself. */}
      {proofs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-brand-200 bg-white p-8 text-center">
          <p className="text-lg font-semibold text-ink-900">Nothing logged yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-600">
            When you finish a job, log it with a photo or a recording. It appears here, on your
            record, with a confirmation link for the person you worked with.
          </p>
          <Link
            href="/workspace"
            className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Log a job
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {proofs.map((item) => (
            <li key={item.id}>
              <ProofListItemView item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}