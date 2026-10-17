import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { CredentialListResponse, RosterResponse } from '@tetherproof/shared';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { apiServer, currentProfile } from '@/lib/server/api';
import { homeFor } from '@/lib/navigation';
import { MilestoneIssuerForm } from './MilestoneIssuerForm';
import { IssuedCredentialList } from './IssuedCredentialList';

export const metadata: Metadata = {
  title: 'Milestone issuer — TetherProof',
};

/**
 * The milestone issuer: `doc/02` §5.1.
 *
 * An instructor signs off on a practical for one of their own students. The page is
 * explicit about what that does and does not do, because the distinction is the
 * whole design and a screen that blurred it would be worse than no screen.
 *
 * Recording a milestone is not the same as verifying a skill. The credential waits
 * for the student's own answer, it is counted apart from their client-verified
 * proofs, and it carries the name of the institute and the instructor behind it. An
 * institute that issued to a hundred students has endorsed a hundred students; it
 * has not produced a hundred people whose work was confirmed by customers, and
 * nothing on this screen lets the two be confused.
 */
export default async function TrainerCredentialsPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  if (!user.capabilities.includes('training_provider')) redirect(homeFor(user));

  // Both reads, because the form's student picker and the list beneath it are two
  // views of the same institute and must not be allowed to disagree about who is on
  // the roster.
  const [roster, issued] = await Promise.all([
    apiServer<RosterResponse>('/trainers/roster'),
    apiServer<CredentialListResponse>('/trainers/credentials'),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <Banner tone="info" title="What signing off does">
        Recording a practical tells the student you have signed it off. It does not become part of
        their client-verified work, and it is not something you can put on their record without
        their answer — they hold it only once they accept.
      </Banner>

      {roster.students.length === 0 ? (
        <Card title="Sign off a practical">
          <p className="text-sm text-ink-600">
            Nobody is on your roster yet. Students join by redeeming the enrolment code on the
            roster page, and then they can be issued a milestone.
          </p>
        </Card>
      ) : (
        <MilestoneIssuerForm students={roster.students} />
      )}

      <IssuedCredentialList
        credentials={issued.credentials}
        awaitingCount={issued.awaitingCount}
        acceptedCount={issued.acceptedCount}
      />
    </div>
  );
}
