'use client';

import { useActionState } from 'react';
import { Award } from 'lucide-react';
import type { RosterStudent } from '@tetherproof/shared';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { FormSuccess } from '@/components/ui/FormSuccess';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { issueMilestone } from '@/lib/actions';
import { EMPTY_MILESTONE } from '@/lib/form-state';

const LEVELS = [
  { value: '1', label: '1 — Entry' },
  { value: '2', label: '2 — Experienced' },
  { value: '3', label: '3 — Advanced' },
] as const;

/**
 * Signs off a practical.
 *
 * The student is chosen from the institute's own roster and cannot be typed in: the
 * only thing the form can submit is an enrolment id the API issued, so there is no
 * shape of this form that could name somebody who is not enrolled.
 *
 * On success it says the milestone is *waiting* on the student rather than that it
 * was saved, because those are different states and an instructor who believed
 * otherwise would go looking for a credential on a student's record that is not
 * there yet.
 */
export function MilestoneIssuerForm({ students }: { students: RosterStudent[] }) {
  const [state, formAction] = useActionState(issueMilestone, EMPTY_MILESTONE);

  return (
    <Card title="Sign off a practical">
      <form action={formAction} className="flex flex-col gap-4">
        <Field
          name="enrolmentId"
          label="Student"
          select={students.map((student) => ({
            value: student.enrolmentId,
            label: student.fullName ?? 'Name not set',
          }))}
          error={state.field === 'enrolmentId' ? state.error : undefined}
          required
        />

        <Field
          name="milestoneTitle"
          label="Practical"
          placeholder="Refrigeration workshop practical 3"
          hint="What the student sat. This is what their record will say."
          error={state.field === 'milestoneTitle' ? state.error : undefined}
          maxLength={200}
          required
        />

        <Field
          name="skillTag"
          label="Skill"
          placeholder="Refrigeration Repair"
          hint="Matched against the capability blocks employers search, so use the wording you teach it under."
          error={state.field === 'skillTag' ? state.error : undefined}
          maxLength={160}
          required
        />

        <Field name="skillLevel" label="Level" select={LEVELS} defaultValue="1" />

        <Field
          name="note"
          label="Note (optional)"
          multiline
          rows={3}
          maxLength={1000}
          hint="Shown to the student with the credential."
          error={state.field === 'note' ? state.error : undefined}
        />

        <div className="flex flex-col gap-2">
          <SubmitButton pendingLabel="Recording…">
            <span className="inline-flex items-center gap-2">
              <Award aria-hidden="true" className="h-4 w-4" />
              Record this milestone
            </span>
          </SubmitButton>
          {state.error && !state.field ? (
            <p role="alert" className="text-sm font-semibold text-red-800">
              {state.error}
            </p>
          ) : null}
          {state.issued ? (
            <FormSuccess when>
              Recorded. {state.issued.studentName ?? 'The student'} now has{' '}
              <strong>{state.issued.milestoneTitle}</strong> waiting for their answer — it is theirs
              to accept, and it does not change their verified work.
            </FormSuccess>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
