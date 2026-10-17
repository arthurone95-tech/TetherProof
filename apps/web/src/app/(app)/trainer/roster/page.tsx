import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { RosterResponse } from '@tetherproof/shared';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { apiServer, currentProfile } from '@/lib/server/api';
import { homeFor } from '@/lib/navigation';
import { unenrolStudent } from '@/lib/actions';
import { EnrolmentCodePanel } from './EnrolmentCodePanel';

export const metadata: Metadata = {
  title: 'Student roster — TetherProof',
};

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * The institute's roster.
 *
 * Enrolment runs through a code rather than a form full of student addresses, and
 * the page says why in one line rather than leaving a training director to wonder
 * where the "add student by email" box went. The answer is the privacy model: the
 * platform has no business holding a list of people who never asked to be on one,
 * so a student joins by redeeming a code they were given.
 *
 * That also means the roster is not a CRM. It carries a name, when they joined, and
 * how many of this institute's credentials they have accepted — and the API has no
 * endpoint here that could return an address, a phone number, or a location.
 */
export default async function TrainerRosterPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  if (!user.capabilities.includes('training_provider')) redirect(homeFor(user));

  const roster = await apiServer<RosterResponse>('/trainers/roster');

  return (
    <div className="flex flex-col gap-5">
      <EnrolmentCodePanel
        hasActiveCode={roster.hasActiveCode}
        organizationName={roster.organizationName}
      />

      <Card title="Enrolled students">
        {roster.students.length === 0 ? (
          <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/20 p-6 text-center">
            <p className="text-sm font-semibold text-ink-900">Nobody has joined yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-ink-600">
              Create an enrolment code above and share it with the students on your course. They
              redeem it from their own account, and they will appear here.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {roster.students.map((student) => (
              <li
                key={student.enrolmentId}
                className="flex items-center justify-between gap-3 rounded-xl border border-brand-100 bg-white p-3 shadow-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink-900">
                    {student.fullName ?? 'Name not set'}
                  </span>
                  <span className="block text-xs text-ink-600">
                    Joined {DATE_FORMATTER.format(new Date(student.enrolledAt))}
                    {student.credentialCount > 0 ? ` · ${student.credentialCount} accepted` : ''}
                    {student.pendingCount > 0 ? ` · ${student.pendingCount} awaiting` : ''}
                  </span>
                </span>
                {/*
                  Removing is a plain form rather than a control with its own client
                  state: there is nothing to optimistically update, and the row is
                  gone on the next render either way. Credentials the student already
                  accepted are kept — leaving the course does not un-take a practical
                  somebody sat, and deleting the endorsement would leave the institute
                  with no record of what it certified.
                */}
                <form action={unenrolStudent} className="shrink-0">
                  <input type="hidden" name="enrolmentId" value={student.enrolmentId} />
                  <SubmitButton variant="secondary" pendingLabel="Removing…" className="min-h-9 px-3 text-xs">
                    Remove
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Banner tone="info" title="What the roster can see">
        A name and an enrolment date. The roster holds no email address, phone number, or
        location for your students, and no other institute can see that they are on it.
      </Banner>
    </div>
  );
}
