'use client';

import { useActionState } from 'react';
import { sendOffer } from '@/lib/actions';
import { EMPTY_FORM, type FormState } from '@/lib/form-state';
import { Banner } from '@/components/ui/Banner';
import { FormSuccess } from '@/components/ui/FormSuccess';
import { SubmitButton } from '@/components/ui/SubmitButton';

/**
 * Invites one masked candidate.
 *
 * The only value posted is the opaque handle the search returned. There is no field
 * for a worker id anywhere in this form, so the interface cannot be used to act on
 * an identity the search deliberately withheld.
 *
 * When sending is blocked the form is replaced by an explanation rather than left
 * inert, because a disabled button with no reason is the most common way a product
 * tells a user nothing.
 */
export function OfferForm({
  candidateHandle,
  skillTag,
  disabledReason,
}: {
  candidateHandle: string;
  skillTag: string;
  disabledReason?: string;
}) {
  const [state, action] = useActionState(sendOffer, EMPTY_FORM as FormState);

  if (state.error && !state.field) {
    // The form is gone once it succeeded, so this only ever reports a refusal.
    return <Banner tone="problem">{state.error}</Banner>;
  }

  if (disabledReason) {
    return (
      <Banner tone="warning" title="Invitation not available">
        {disabledReason}
      </Banner>
    );
  }

  return (
    <form action={action} className="mt-4 flex flex-col gap-3 border-t border-brand-100 pt-4">
      <input type="hidden" name="candidateHandle" value={candidateHandle} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`note-${candidateHandle}`} className="text-sm font-medium text-ink-900">
          Message to this worker
        </label>
        <textarea
          id={`note-${candidateHandle}`}
          name="note"
          rows={2}
          maxLength={500}
          placeholder={`Optional. Introduce yourself and say why ${skillTag} matters for this role.`}
          className="w-full rounded-xl border border-brand-100 bg-white px-4 py-3 text-base text-ink-900 placeholder:text-ink-600/60"
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-red-800">
          {state.error}
        </p>
      ) : null}
      <FormSuccess when={state.done === true}>
        Invitation sent. You will find it under Invitations you have sent.
      </FormSuccess>
      <SubmitButton pendingLabel="Sending…" className="sm:w-auto">
        Send invitation
      </SubmitButton>
    </form>
  );
}