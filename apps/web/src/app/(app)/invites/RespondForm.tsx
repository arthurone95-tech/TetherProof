'use client';

import { useActionState } from 'react';
import { respondToOffer } from '@/lib/actions';
import { EMPTY_FORM, type FormState } from '@/lib/form-state';
import { FormSuccess } from '@/components/ui/FormSuccess';
import { SubmitButton } from '@/components/ui/SubmitButton';

/**
 * The worker's answer to one invitation.
 *
 * Acceptance is the moment the worker's identity is released to the employer, so the
 * button says exactly what it does. Without that, a tap that feels like acknowledging
 * a message would quietly hand over something the worker may not have meant to.
 *
 * Both answers live in one form. Each button carries its own `response` value, so what
 * is recorded is the button that was pressed rather than a hidden field that could
 * disagree with it.
 *
 * A decision cannot be withdrawn, so this is not a toggle: there is no un-accept, and
 * the API refuses a second answer to the same invitation.
 */
export function RespondForm({ offerId, organization }: { offerId: string; organization: string | null }) {
  const [state, action] = useActionState(respondToOffer, EMPTY_FORM as FormState);
  const who = organization ?? 'This employer';

  return (
    <form action={action} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="offerId" value={offerId} />

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-red-800">
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <SubmitButton name="response" value="accepted" pendingLabel="Recording…" className="sm:flex-1">
          Accept and share my identity
        </SubmitButton>
        <SubmitButton
          name="response"
          value="declined"
          variant="secondary"
          pendingLabel="Recording…"
          className="sm:w-auto"
        >
          Decline
        </SubmitButton>
      </div>

      <p className="text-xs text-ink-600">
        Accepting tells {who} who you are and how to reach you. Declining does not.
      </p>

      <FormSuccess when={state.done === true}>
        Answer recorded. It now appears under Already answered.
      </FormSuccess>
    </form>
  );
}