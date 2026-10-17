import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { StudentCredentialsResponse } from '@tetherproof/shared';
import { apiServer, currentProfile } from '@/lib/server/api';
import { homeFor } from '@/lib/navigation';
import { EnrolWithInstitute } from './EnrolWithInstitute';
import { StudentCredentialList } from './StudentCredentialList';

export const metadata: Metadata = {
  title: 'My credentials — TetherProof',
};

/**
 * The worker's own micro-credentials.
 *
 * This is the second signature of a dual-backed credential, so it is the student's
 * page and not the institute's: an institute records a milestone, and the record
 * becomes a credential only when its subject decides to hold it.
 *
 * The page opens by saying what a credential is, because the honest risk here is a
 * student accepting something without knowing what it will look like. An
 * institutional endorsement is worth having and is not the same as work a customer
 * confirmed, and a student who cannot tell those apart could reasonably read one as
 * the other.
 *
 * Reached from a notification rather than a new tab: the tab row belongs to the four
 * tasks a worker came for, and this is not one of them until an institute has
 * something to answer.
 */
export default async function StudentCredentialsPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  // `trainee` **or** `worker`. This used to be `worker` alone, on the reasoning that "a
  // student is a worker whose institute recorded something" — which made it impossible for
  // somebody who had done no paid work to be a student at all. The API made the same change;
  // if only one side moved, a student would be able to read their credentials through the
  // endpoint but be redirected away from the page that shows them.
  if (!user.capabilities.includes('trainee') && !user.capabilities.includes('worker')) {
    redirect(homeFor(user));
  }

  const credentials = await apiServer<StudentCredentialsResponse>('/workers/credentials');

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-ink-900">My credentials</h1>
        <p className="text-sm text-ink-600">
          Milestones a training provider has signed off on, and the answer each one is waiting for.
        </p>
      </header>

      {credentials.awaiting.length > 0 ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-900">
          {credentials.awaiting.length === 1
            ? 'A milestone is waiting for your answer.'
            : `${credentials.awaiting.length} milestones are waiting for your answer.`}{' '}
          Nothing is on your record until you accept it.
        </p>
      ) : null}

      <StudentCredentialList credentials={credentials} />

      <EnrolWithInstitute />

      {credentials.declinedCount > 0 ? (
        <p className="text-xs text-ink-600">
          {credentials.declinedCount}{' '}
          {credentials.declinedCount === 1 ? 'milestone' : 'milestones'} declined. Kept on record
          rather than deleted, so a provider can see you answered rather than wondering whether
          they ever sent it.
        </p>
      ) : null}
    </div>
  );
}
