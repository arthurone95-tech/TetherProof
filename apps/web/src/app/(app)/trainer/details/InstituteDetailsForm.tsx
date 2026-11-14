'use client';

import { useActionState, useState } from 'react';
import { saveProfile } from '@/lib/actions';
import { EMPTY_FORM, type FormState } from '@/lib/form-state';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { FormSuccess } from '@/components/ui/FormSuccess';
import { SubmitButton } from '@/components/ui/SubmitButton';

export function InstituteDetailsForm({
  fullName,
  organizationName,
}: {
  fullName: string | null;
  organizationName: string | null;
}) {
  const [state, action] = useActionState(saveProfile, EMPTY_FORM as FormState);
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="mt-4 flex flex-col gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">Institute name</p>
          <p className="mt-1 text-base font-semibold text-ink-900">
            {organizationName?.trim() || 'Not set yet'}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">Your name</p>
          <p className="mt-1 text-base text-ink-900">{fullName ?? '—'}</p>
        </div>
        <div>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit details
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="mt-4 flex flex-col gap-4">
      <Field
        name="organizationName"
        label="Institute name"
        defaultValue={organizationName ?? ''}
        maxLength={200}
        required
        error={state.field === 'organizationName' ? state.error : undefined}
        hint="This is the name that appears on every credential you sign."
      />
      <Field
        name="fullName"
        label="Your name"
        defaultValue={fullName ?? ''}
        maxLength={160}
        required
        error={state.field === 'fullName' ? state.error : undefined}
      />
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-red-800">
          {state.error}
        </p>
      ) : null}
      <FormSuccess when={state.done === true}>Saved.</FormSuccess>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <SubmitButton pendingLabel="Saving…" className="sm:w-auto">
          Save
        </SubmitButton>
        <Button variant="secondary" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
