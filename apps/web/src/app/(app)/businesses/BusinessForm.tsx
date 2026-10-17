'use client';

import { useActionState } from 'react';
import { Building2 } from 'lucide-react';
import { Field } from '@/components/ui/Field';
import { FormSuccess } from '@/components/ui/FormSuccess';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { createBusiness } from '@/lib/actions';
import { EMPTY_BUSINESS } from '@/lib/form-state';

/**
 * Creating a business.
 *
 * Deliberately does not say "you are now an employer". It creates a pending business and
 * says the capability arrives when it is reviewed, because promising hiring now and
 * delivering it after a review is how a person ends up distrusting the words on a button.
 */
export function BusinessForm() {
  const [state, formAction] = useActionState(createBusiness, EMPTY_BUSINESS);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <Field
        name="name"
        label="Business name"
        placeholder="Kojo Electrical Services"
        maxLength={200}
        error={state.field === 'name' ? state.error : undefined}
        required
      />
      <SubmitButton pendingLabel="Creating…" variant="secondary">
        <span className="inline-flex items-center gap-2">
          <Building2 aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
          Set up business
        </span>
      </SubmitButton>
      {state.error && !state.field ? (
        <p role="alert" className="text-sm font-semibold text-red-800">
          {state.error}
        </p>
      ) : null}
      {state.done ? <FormSuccess when>Business created and waiting for review.</FormSuccess> : null}
    </form>
  );
}
