'use client';

import { useActionState } from 'react';
import { createSpec } from '@/lib/actions';
import { EMPTY_FORM, type FormState } from '@/lib/form-state';
import { Field } from '@/components/ui/Field';
import { FormSuccess } from '@/components/ui/FormSuccess';
import { SubmitButton } from '@/components/ui/SubmitButton';

/** Saves a reusable hiring filter. */
export function CreateSpecForm() {
  const [state, action] = useActionState(createSpec, EMPTY_FORM as FormState);

  return (
    <form action={action} className="mt-4 flex flex-col gap-4 border-t border-brand-100 pt-4">
      <Field
        name="requiredSkill"
        label="Skill"
        placeholder="Solar Panel Installation"
        required
        error={state.field === 'requiredSkill' ? state.error : undefined}
        hint="Matched against the skills workers have proven, not the wording on a CV."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="minProofThreshold"
          label="Minimum verified proofs"
          type="number"
          inputMode="numeric"
          min={1}
          max={500}
          step={1}
          defaultValue={1}
        />
        <Field
          name="maxDistanceKm"
          label="Within (km)"
          type="number"
          inputMode="numeric"
          min={1}
          max={20000}
          step={1}
          defaultValue={25}
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-red-800">
          {state.error}
        </p>
      ) : null}
      <FormSuccess when={state.done === true}>Search saved.</FormSuccess>
      <SubmitButton pendingLabel="Saving…" className="sm:w-auto">
        Save this search
      </SubmitButton>
    </form>
  );
}