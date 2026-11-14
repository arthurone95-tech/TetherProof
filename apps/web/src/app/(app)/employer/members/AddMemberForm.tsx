'use client';

import { useActionState } from 'react';
import { addEmployerMemberAction } from '@/lib/actions';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';

export function AddMemberForm({ businessId }: { businessId: string }) {
  const [state, formAction] = useActionState(addEmployerMemberAction, null);
  const error = state?.ok === false ? state.error : null;
  const added = state?.ok === true;

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="businessId" value={businessId} />
      <Field
        name="userId"
        label="Member account id"
        type="text"
        maxLength={64}
        placeholder="The colleague's account id"
        required
      />
      <SubmitButton pendingLabel="Adding…">Add member</SubmitButton>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-red-800">
          {error}
        </p>
      ) : null}
      {added ? (
        <p role="status" className="text-sm font-semibold text-emerald-800">
          Added.
        </p>
      ) : null}
    </form>
  );
}
