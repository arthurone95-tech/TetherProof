'use client';

import { useActionState } from 'react';
import { Building2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { FormSuccess } from '@/components/ui/FormSuccess';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { redeemEnrolmentCode } from '@/lib/actions';
import { EMPTY_MILESTONE } from '@/lib/form-state';

/**
 * Joining an institute's roster.
 *
 * The student types a code the institute gave them. That direction is the point: the
 * alternative is an institute typing student addresses into a form, which would have
 * the platform holding a list of people who never asked to be in one, and would
 * leave the institute with a roster it could not show was current.
 *
 * A code that has been rotated simply does not work, and the message says so without
 * implying that the institute still exists or that the student is somehow wrong.
 */
export function EnrolWithInstitute() {
  const [state, formAction] = useActionState(redeemEnrolmentCode, EMPTY_MILESTONE);

  return (
    <Card title="Join a training provider">
      <p className="text-sm text-ink-600">
        If a school, bootcamp, or trade institute has given you an enrolment code, enter it here
        and they will be able to sign off on the practicals you complete. You can join more than
        one, and only you can see which.
      </p>

      <form action={formAction} className="mt-4 flex flex-col gap-3">
        <Field
          name="code"
          label="Enrolment code"
          placeholder="ABCD2345EFGH"
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          error={state.field === 'code' ? state.error : undefined}
          required
        />

        <div className="flex flex-col gap-2">
          <SubmitButton pendingLabel="Joining…" variant="secondary">
            <span className="inline-flex items-center gap-2">
              <Building2 aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
              Join with this code
            </span>
          </SubmitButton>

          {state.done && !state.error ? (
            <FormSuccess when>
              You are enrolled{state.enrolledWith ? ` with ${state.enrolledWith}` : ''}. They can
              now record a milestone for you.
            </FormSuccess>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
