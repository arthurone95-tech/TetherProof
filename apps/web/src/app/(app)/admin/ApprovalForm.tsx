'use client';

import { useActionState } from 'react';
import { decideEmployerApproval } from '@/lib/actions';
import { EMPTY_FORM, type FormState } from '@/lib/form-state';
import { FormSuccess } from '@/components/ui/FormSuccess';
import { SubmitButton } from '@/components/ui/SubmitButton';

/**
 * The decision controls for one employer account.
 *
 * Three submit buttons share the `status` name, so the value sent is whichever
 * was pressed — the browser reports the clicked submitter, and no hidden field
 * is left to disagree with what the reviewer actually did. The note is optional
 * for an approval and worth having for a rejection; the API caps it, so this
 * only bounds the box.
 */
export function ApprovalForm({ employerId }: { employerId: string }) {
  const [state, action] = useActionState(decideEmployerApproval, EMPTY_FORM as FormState);

  return (
    <form action={action} className="mt-4 flex flex-col gap-3 border-t border-brand-100 pt-4">
      <input type="hidden" name="employerId" value={employerId} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`note-${employerId}`} className="text-sm font-medium text-ink-900">
          Review note <span className="font-normal text-ink-500">(optional)</span>
        </label>
        <textarea
          id={`note-${employerId}`}
          name="note"
          rows={2}
          maxLength={200}
          placeholder="Why this decision? The employer can read this note."
          className="w-full rounded-xl border border-brand-100 bg-white px-4 py-3 text-base text-ink-900 placeholder:text-ink-600/60"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-red-800">
          {state.error}
        </p>
      ) : null}
      <FormSuccess when={state.done === true}>Decision recorded.</FormSuccess>

      <div className="flex flex-wrap gap-2">
        <SubmitButton
          name="status"
          value="approved"
          variant="primary"
          className="min-h-11 w-auto px-4 text-sm"
        >
          Approve
        </SubmitButton>
        <SubmitButton
          name="status"
          value="rejected"
          variant="danger"
          className="min-h-11 w-auto px-4 text-sm"
        >
          Reject
        </SubmitButton>
        <SubmitButton
          name="status"
          value="pending"
          variant="secondary"
          className="min-h-11 w-auto px-4 text-sm"
        >
          Back to review
        </SubmitButton>
      </div>
    </form>
  );
}
